/**
 * Server-side quotes. The app never computes a price: it sends what the traveller chose and
 * shows what comes back. Each quote is stored for 15 minutes and is the only thing a hold
 * (and later a payment) can be made from.
 *
 * Pricing: every dated line is priced from the listing_prices season that covers its date
 * (a later-starting season overrides an earlier one), per person, then packages/shared's
 * one rounding rule turns provider nets into the traveller price.
 */
const {
  DEFAULTS,
  addDays,
  driveTimeWarning,
  expandLines,
  instalmentPreview,
  priceBreakdown,
  todayInKenya,
} = require('@safiri/shared');

const QUOTE_MINUTES = 15;
const MAX_DAYS_AHEAD = 183; // about 6 months

class QuoteError extends Error {
  constructor(code, status = 422, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const LISTING_COLUMNS = `l.id, l.title, l.kind, l.unit, l.provider_id, l.destination_id,
  (l.active and p.verified_at is not null) as bookable`;

async function loadPackageTrip(db, slug, { allowDraft = false } = {}) {
  // Travellers quote published packages only; staff price drafts too (allowDraft, never from a request body).
  const { rows } = await db.query(
    `select p.id, p.destination_id, p.nights, p.margin_bps, p.deposit_pct, p.instalments, d.slug as destination_slug, d.drive_hours
     from packages p join destinations d on d.id = p.destination_id
     where p.slug = $1 and (p.status = 'published' or $2)`,
    [slug, allowDraft],
  );
  if (!rows[0]) throw new QuoteError('package_not_found', 404);
  const pkg = rows[0];
  const items = await db.query(
    `select pi.day, pi.qty, ${LISTING_COLUMNS}
     from package_items pi join listings l on l.id = pi.listing_id join providers p on p.id = l.provider_id
     where pi.package_id = $1 order by pi.day, l.title`,
    [pkg.id],
  );
  if (items.rows.some((i) => !i.bookable)) throw new QuoteError('package_unavailable', 409);
  return {
    packageId: pkg.id,
    destinationId: pkg.destination_id,
    destinationSlug: pkg.destination_slug,
    driveHours: pkg.drive_hours == null ? null : Number(pkg.drive_hours),
    nights: pkg.nights,
    marginBps: pkg.margin_bps,
    depositPct: pkg.deposit_pct,
    instalmentCount: pkg.instalments,
    items: items.rows.map((i) => ({ listing: i, day: i.day, qty: i.qty })),
  };
}

async function loadCustomTrip(db, { destinationSlug, nights, items }) {
  const { rows } = await db.query(`select id, slug, drive_hours from destinations where slug = $1`, [destinationSlug]);
  if (!rows[0]) throw new QuoteError('destination_not_found', 404);
  const destination = rows[0];
  const ids = [...new Set(items.map((i) => i.listingId))];
  const listings = await db.query(
    `select ${LISTING_COLUMNS} from listings l join providers p on p.id = l.provider_id where l.id = any($1::uuid[])`,
    [ids],
  );
  const byId = new Map(listings.rows.map((l) => [l.id, l]));
  const bad = ids.filter((id) => !byId.get(id)?.bookable || byId.get(id).destination_id !== destination.id);
  if (bad.length) throw new QuoteError('invalid_items', 422, { listingIds: bad });

  // Every item must fall inside the trip: stays end the night before the last day.
  for (const item of items) {
    const listing = byId.get(item.listingId);
    const lastDay = item.day + item.qty - 1;
    const limit = listing.unit === 'night' ? nights : nights + 1;
    if (listing.unit === 'night' && nights === 0) throw new QuoteError('stay_needs_nights', 422, { listingId: item.listingId });
    if (lastDay > limit) throw new QuoteError('item_outside_trip', 422, { listingId: item.listingId });
  }

  return {
    packageId: null,
    destinationId: destination.id,
    destinationSlug: destination.slug,
    driveHours: destination.drive_hours == null ? null : Number(destination.drive_hours),
    nights,
    // Custom trips are sold by the house agency at the default margin (an assumption in the plan).
    marginBps: DEFAULTS.AGENCY_MARGIN_BPS,
    depositPct: DEFAULTS.DEPOSIT_PCT,
    instalmentCount: DEFAULTS.INSTALMENT_COUNT,
    items: items.map((i) => ({ listing: byId.get(i.listingId), day: i.day, qty: i.qty })),
  };
}

/** Net price per unit for each listing and date, from the covering season. */
async function loadPrices(db, lines) {
  const ids = [...new Set(lines.map((l) => l.listing.id))];
  const dates = lines.map((l) => l.date).sort();
  const { rows } = await db.query(
    `select listing_id, season_start::text, season_end::text, net_kes from listing_prices
     where listing_id = any($1::uuid[]) and season_start <= $3::date and season_end >= $2::date`,
    [ids, dates[0], dates[dates.length - 1]],
  );
  return (listingId, date) => {
    const seasons = rows.filter((r) => r.listing_id === listingId && r.season_start <= date && r.season_end >= date);
    seasons.sort((a, b) => b.season_start.localeCompare(a.season_start));
    return seasons[0]?.net_kes ?? null;
  };
}

/** Free units per listing and date (a missing availability row means nothing to sell). */
async function loadFree(db, lines) {
  const { rows } = await db.query(
    `select a.listing_id, a.date::text, case when a.blocked then 0 else a.units_total - a.units_held - a.units_booked end as free
     from availability a
     join unnest($1::uuid[], $2::date[]) as need(listing_id, date) on need.listing_id = a.listing_id and need.date = a.date`,
    [lines.map((l) => l.listing.id), lines.map((l) => l.date)],
  );
  const free = new Map(rows.map((r) => [`${r.listing_id}|${r.date}`, r.free]));
  return (listingId, date) => free.get(`${listingId}|${date}`) ?? 0;
}

function createQuoteService(db, { now = () => new Date(), referrals = null } = {}) {
  /** Prices a trip without saving it (also used to refresh packages' display prices). */
  async function priceTrip(request) {
    if (!db) throw new QuoteError('not_configured', 503);
    const today = todayInKenya(now());
    const earliest = addDays(today, 1);
    const latest = addDays(today, MAX_DAYS_AHEAD);
    if (request.startDate < earliest || request.startDate > latest) {
      throw new QuoteError('date_out_of_range', 422, { earliest, latest });
    }

    const trip = request.packageSlug
      ? await loadPackageTrip(db, request.packageSlug, { allowDraft: Boolean(request.allowDraft) })
      : await loadCustomTrip(db, request);
    const { travellers, startDate } = request;
    const byRef = new Map(trip.items.map((i) => [i.listing.id, i.listing]));
    const lines = expandLines(
      trip.items.map((i) => ({ ref: i.listing.id, unit: i.listing.unit, day: i.day, qty: i.qty })),
      travellers,
    ).map((l) => ({ ...l, listing: byRef.get(l.ref), date: addDays(startDate, l.dayIndex) }));

    const priceOf = await loadPrices(db, lines);
    const missing = lines.filter((l) => priceOf(l.listing.id, l.date) == null);
    if (missing.length) throw new QuoteError('no_price', 409, { listingIds: [...new Set(missing.map((l) => l.listing.id))] });

    const perPerson = priceBreakdown({
      items: lines.map((l) => ({ label: l.listing.title, netKes: priceOf(l.listing.id, l.date), qty: l.perPersonQty })),
      marginBps: trip.marginBps,
      feeBps: DEFAULTS.PLATFORM_FEE_BPS,
    });

    // Two lines can need the same listing on the same date; check the total.
    const freeOf = await loadFree(db, lines);
    const needed = new Map();
    for (const l of lines) needed.set(`${l.listing.id}|${l.date}`, (needed.get(`${l.listing.id}|${l.date}`) || 0) + l.units);
    const isAvailable = (l) => freeOf(l.listing.id, l.date) >= needed.get(`${l.listing.id}|${l.date}`);

    return { trip, lines, perPerson, isAvailable, startDate, travellers, endDate: addDays(startDate, trip.nights) };
  }

  async function createQuote(request, { userId = null } = {}) {
    const priced = await priceTrip(request);
    const { trip, lines, perPerson, isAvailable, startDate, endDate, travellers } = priced;
    // A referral code takes a fixed amount off a new traveller's first booking (never the whole price).
    const referral = referrals ? await referrals.referralFor(request.referralCode, userId) : null;
    const discountKes = referral ? Math.min(referral.discountKes, perPerson.totalKes * travellers - 1) : 0;
    const totalKes = perPerson.totalKes * travellers - discountKes;

    // perPerson.lines is in the same order as lines. A line's net (what that provider receives)
    // is the unit net x per-person quantity x travellers.
    const items = lines.map((l, i) => ({
      listing_id: l.listing.id,
      provider_id: l.listing.provider_id,
      date: l.date,
      units: l.units,
      net_kes: perPerson.lines[i].netKes * l.perPersonQty * travellers,
      title: l.listing.title,
      kind: l.listing.kind,
    }));

    const { rows } = await db.query(
      `insert into quotes (user_id, package_id, destination_id, start_date, end_date, travellers, items, breakdown,
                           per_person_kes, total_kes, expires_at, referral_id, discount_kes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(mins => $11), $12, $13)
       returning id, expires_at`,
      [
        userId, trip.packageId, trip.destinationId, startDate, endDate, travellers, JSON.stringify(items),
        JSON.stringify({
          perPerson: { netKes: perPerson.netKes, marginKes: perPerson.marginKes, feeKes: perPerson.feeKes, totalKes: perPerson.totalKes },
          marginBps: trip.marginBps,
          feeBps: DEFAULTS.PLATFORM_FEE_BPS,
          nights: trip.nights,
        }),
        perPerson.totalKes, totalKes, QUOTE_MINUTES, referral?.referralId || null, discountKes,
      ],
    );

    const unavailable = lines.filter((l) => !isAvailable(l));
    const preview = instalmentPreview({ totalKes, depositPct: trip.depositPct, instalmentCount: trip.instalmentCount });
    const perPersonPreview = instalmentPreview({ totalKes: perPerson.totalKes, depositPct: trip.depositPct, instalmentCount: trip.instalmentCount });
    // What the app sees: all-in prices only. Provider nets and margins stay on the server.
    return {
      id: rows[0].id,
      expiresAt: rows[0].expires_at.toISOString(),
      packageSlug: request.packageSlug || null,
      destinationSlug: trip.destinationSlug,
      startDate,
      endDate,
      nights: trip.nights,
      travellers,
      perPersonKes: perPerson.totalKes,
      totalKes,
      discountKes,
      referralApplied: Boolean(referral),
      instalments: preview ? { times: preview.times, amountKes: preview.amountKes, schedule: preview.schedule } : null,
      // The "or 4 x 3,925" line under the per-person price, so the app never divides money itself.
      perPersonInstalments: perPersonPreview ? { times: perPersonPreview.times, amountKes: perPersonPreview.amountKes } : null,
      lines: lines.map((l) => ({ listingId: l.listing.id, title: l.listing.title, kind: l.listing.kind, date: l.date, units: l.units, available: isAvailable(l) })),
      available: unavailable.length === 0,
      unavailable: [...new Map(unavailable.map((l) => [`${l.listing.id}|${l.date}`, { listingId: l.listing.id, title: l.listing.title, date: l.date }])).values()],
      driveTimeWarning: driveTimeWarning(trip.driveHours, trip.nights),
    };
  }

  /**
   * Keeps packages.from_price_kes (the display price on Explore and the web) equal to what a
   * quote would charge one traveller sharing a room, for a trip starting in 14 days.
   */
  async function refreshFromPrices({ slug = null } = {}) {
    // Drafts are priced too, so agencies see the display price before publishing.
    const { rows } = await db.query(`select slug, from_price_kes from packages where $1::text is null or slug = $1`, [slug]);
    const startDate = addDays(todayInKenya(now()), 14);
    let changed = 0;
    for (const p of rows) {
      try {
        const { perPerson } = await priceTrip({ packageSlug: p.slug, startDate, travellers: 2, allowDraft: true });
        if (perPerson.totalKes !== p.from_price_kes) {
          await db.query(`update packages set from_price_kes = $2 where slug = $1`, [p.slug, perPerson.totalKes]);
          changed += 1;
        }
      } catch (err) {
        if (!(err instanceof QuoteError)) throw err; // an unpriceable package keeps its last price
      }
    }
    return changed;
  }

  return { createQuote, priceTrip, refreshFromPrices };
}

module.exports = { createQuoteService, QuoteError };
