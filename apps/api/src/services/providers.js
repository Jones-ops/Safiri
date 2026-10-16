/**
 * Providers (lodges, guides, drivers, activities): onboarding from the app, booking requests
 * answered on WhatsApp (buttons), by SMS link or in the app, their calendar, prices and payouts.
 *
 * A confirmed booking sends each provider who does not auto-accept one request covering all
 * their items on that booking. Accept marks the items accepted and tells the traveller; decline
 * or silence for 24 hours alerts the agency to swap the provider.
 */
const { addDays, formatAmount, todayInKenya } = require('@safiri/shared');
const { translator } = require('../web/i18n');
const { asUser } = require('../lib/roles');

const ERRORS = { not_found: 404, forbidden: 403, date_in_use: 409, already_answered: 409, request_closed: 409 };
const REQUEST_HOURS = 24;

class ProviderError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.status = ERRORS[code] || 400;
    this.details = details;
  }
}

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};
const shortDate = (iso, lang) => `${Number(iso.slice(8, 10))} ${(MONTHS[lang] || MONTHS.en)[Number(iso.slice(5, 7)) - 1]}`;
const dateRange = (from, to, lang) => (from === to ? shortDate(from, lang) : `${shortDate(from, lang)} - ${shortDate(to, lang)}`);

function createProviderService({ db, notifier, requestCodes, baseUrl, log }) {
  const base = String(baseUrl || '').replace(/\/$/, '');

  /** One request = one provider's items on one booking. */
  async function requestRows(where, params) {
    const { rows } = await db.query(
      `select bi.booking_id, bi.provider_id, min(bi.id::text)::uuid as first_item_id,
              min(bi.date)::text as first_date, max(bi.date)::text as last_date, sum(bi.net_kes)::int as payout_kes,
              bool_and(bi.provider_status = 'pending') as all_pending, min(bi.provider_status::text) as status, min(bi.request_sent_at) as sent_at,
              b.ref, b.travellers, b.status as booking_status, b.phone as traveller_phone, b.user_id as traveller_user_id,
              coalesce(p.title, d.name) as title, p.agency_id,
              pr.name as provider_name, pr.owner_id, pr.whatsapp_msisdn, pr.auto_accept, coalesce(prof.language, 'en') as language,
              array_agg(distinct l.title) as listing_titles
       from booking_items bi
       join bookings b on b.id = bi.booking_id
       join providers pr on pr.id = bi.provider_id
       join listings l on l.id = bi.listing_id
       left join packages p on p.id = b.package_id
       left join quotes q on q.id = b.quote_id
       left join destinations d on d.id = coalesce(p.destination_id, q.destination_id)
       left join profiles prof on prof.user_id = pr.owner_id
       where ${where}
       group by bi.booking_id, bi.provider_id, b.id, p.id, d.id, pr.id, prof.language
       order by min(bi.date)`,
      params,
    );
    return rows;
  }

  const requestView = (r) => ({
    code: requestCodes.codeFor(r.first_item_id),
    bookingId: r.booking_id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    ref: r.ref,
    title: r.title,
    items: r.listing_titles,
    firstDate: r.first_date,
    lastDate: r.last_date,
    travellers: r.travellers,
    payoutKes: r.payout_kes,
    status: r.status,
    sentAt: r.sent_at,
    respondBy: r.sent_at ? new Date(new Date(r.sent_at).getTime() + REQUEST_HOURS * 3600 * 1000).toISOString() : null,
    bookingStatus: r.booking_status,
  });

  async function agencyOwner(agencyId) {
    if (!agencyId) return null;
    const { rows } = await db.query(
      `select a.owner_id, pr.phone, coalesce(pr.language, 'en') as language from agencies a join profiles pr on pr.user_id = a.owner_id where a.id = $1`,
      [agencyId],
    );
    return rows[0] || null;
  }

  /** Called when a booking confirms: one request per provider still pending. */
  async function sendRequests(bookingId) {
    const requests = await requestRows(`bi.booking_id = $1 and bi.provider_status = 'pending' and bi.request_sent_at is null`, [bookingId]);
    for (const r of requests) {
      const t = translator(r.language);
      const code = requestCodes.codeFor(r.first_item_id);
      const link = `${base}/r/${code}`;
      const vars = { ref: r.ref, dates: dateRange(r.first_date, r.last_date, r.language), guests: r.travellers, payout: formatAmount(r.payout_kes), items: r.listing_titles.join(', '), link };
      await notifier.notify({
        kind: 'provider_request',
        language: r.language,
        userId: r.owner_id,
        phone: r.whatsapp_msisdn,
        bookingId: r.booking_id,
        instalmentId: null,
        sms: t('sms.providerRequest', vars),
        whatsapp: { template: 'booking_request', params: [vars.ref, vars.dates, String(vars.guests), vars.payout, vars.items], buttons: [`accept:${code}`, `decline:${code}`] },
        push: { title: t('push.providerRequestTitle', vars), body: t('push.providerRequestBody', vars), data: { url: '/requests' } },
      });
      await db.query(`update booking_items set request_sent_at = now() where booking_id = $1 and provider_id = $2 and request_sent_at is null`, [r.booking_id, r.provider_id]);
    }
    return requests.length;
  }

  /** Accept or decline every pending item of this provider on this booking. */
  async function respond({ firstItemId, accept, actorUserId = null, requireOwner = null }) {
    const [r] = await requestRows(
      `(bi.booking_id, bi.provider_id) = (select booking_id, provider_id from booking_items where id = $1)`,
      [firstItemId],
    );
    if (!r) throw new ProviderError('not_found');
    if (requireOwner && r.owner_id !== requireOwner) throw new ProviderError('not_found');
    if (!['confirmed', 'fully_paid'].includes(r.booking_status)) throw new ProviderError('request_closed');
    if (!r.all_pending) throw new ProviderError('already_answered', { status: r.status });

    const status = accept ? 'accepted' : 'declined';
    const run = (client) => client.query(
      `update booking_items set provider_status = $3, responded_at = now() where booking_id = $1 and provider_id = $2 and provider_status = 'pending'`,
      [r.booking_id, r.provider_id, status],
    );
    if (actorUserId) await asUser(db, actorUserId, run);
    else await run(db);

    const travellerLang = (await db.query(`select coalesce(language, 'en') as l from profiles where user_id = $1`, [r.traveller_user_id])).rows[0]?.l || 'en';
    const vars = { ref: r.ref, provider: r.provider_name, dates: dateRange(r.first_date, r.last_date, travellerLang) };
    if (accept) {
      const t = translator(travellerLang);
      await notifier.notify({
        kind: `provider_accepted:${r.provider_id}`, language: travellerLang, userId: r.traveller_user_id, phone: r.traveller_phone, bookingId: r.booking_id, instalmentId: null,
        sms: t('sms.providerAccepted', vars), whatsapp: { template: 'booking_confirmed', params: [vars.ref, vars.provider] },
        push: { title: t('push.providerAcceptedTitle', vars), body: t('push.providerAcceptedBody', vars), data: { url: `/trip/${r.booking_id}` } },
      }).catch((err) => log.warn({ err }, 'accept notice failed'));
    } else {
      await alertAgency(r, 'provider_declined');
    }
    return { status, bookingId: r.booking_id };
  }

  async function alertAgency(r, kind) {
    const agency = await agencyOwner(r.agency_id);
    if (!agency) return;
    const t = translator(agency.language);
    const vars = { ref: r.ref, provider: r.provider_name, dates: dateRange(r.first_date, r.last_date, agency.language) };
    const key = kind === 'provider_declined' ? 'Declined' : 'NoReply';
    await notifier.notify({
      kind: `${kind}:${r.provider_id}`, language: agency.language, userId: agency.owner_id, phone: agency.phone, bookingId: r.booking_id, instalmentId: null,
      sms: t(`sms.provider${key}`, vars), whatsapp: { template: kind, params: [vars.ref, vars.provider, vars.dates] },
      push: { title: t(`push.provider${key}Title`, vars), body: t(`push.provider${key}Body`, vars), data: { url: '/bookings' } },
    }).catch((err) => log.warn({ err }, 'agency alert failed'));
  }

  /** Job: requests unanswered for 24 hours expire, and the agency is told to swap the provider. */
  async function expireRequests() {
    const stale = await requestRows(
      `bi.provider_status = 'pending' and bi.request_sent_at < now() - make_interval(hours => ${REQUEST_HOURS}) and b.status in ('confirmed', 'fully_paid')`,
      [],
    );
    for (const r of stale) {
      await db.query(`update booking_items set provider_status = 'expired' where booking_id = $1 and provider_id = $2 and provider_status = 'pending'`, [r.booking_id, r.provider_id]);
      await alertAgency(r, 'provider_no_reply');
    }
    return stale.length;
  }

  async function myProviders(userId) {
    const { rows } = await db.query(
      `select pr.id, pr.name, pr.type, pr.licence_no, pr.verified_at, pr.onboarding_step, pr.whatsapp_msisdn, pr.payout_msisdn, pr.location_name,
              d.name as destination, d.id as destination_id,
              coalesce(json_agg(json_build_object('id', l.id, 'title', l.title, 'kind', l.kind, 'unit', l.unit, 'capacity', l.capacity) order by l.title)
                       filter (where l.id is not null), '[]') as listings
       from providers pr
       left join destinations d on d.id = pr.destination_id
       left join listings l on l.provider_id = pr.id and l.active
       where pr.owner_id = $1 group by pr.id, d.id order by pr.created_at`,
      [userId],
    );
    return rows.map((p) => ({
      id: p.id, name: p.name, type: p.type, licenceNo: p.licence_no, verifiedAt: p.verified_at, onboardingStep: p.onboarding_step,
      whatsappPhone: p.whatsapp_msisdn, payoutPhone: p.payout_msisdn, locationName: p.location_name, destination: p.destination,
      destinationId: p.destination_id, listings: p.listings,
    }));
  }

  async function ownsListing(userId, listingId) {
    const { rows } = await db.query(
      `select l.id from listings l join providers pr on pr.id = l.provider_id where l.id = $1 and pr.owner_id = $2`,
      [listingId, userId],
    );
    if (!rows[0]) throw new ProviderError('not_found');
  }

  return {
    sendRequests,
    respond,
    expireRequests,
    myProviders,
    requestView,

    async requestByCode(code) {
      const itemId = requestCodes.idFrom(code);
      if (!itemId) return null;
      const [r] = await requestRows(`(bi.booking_id, bi.provider_id) = (select booking_id, provider_id from booking_items where id = $1)`, [itemId]);
      return r ? { ...requestView(r), firstItemId: r.first_item_id, language: r.language, ownerId: r.owner_id, ownerPhone: r.whatsapp_msisdn } : null;
    },

    /** The provider's open and recent requests, for the Requests tab. */
    async listRequests(userId) {
      const rows = await requestRows(
        `pr.owner_id = $1 and b.status in ('confirmed', 'fully_paid', 'completed', 'cancelled') and bi.date >= current_date - 30`,
        [userId],
      );
      return rows.map(requestView);
    },

    /** From the app: sign-up in a few steps, saved as one call once every step is done. */
    async onboard(user, input) {
      const providerId = await asUser(db, user.id, async (client) => {
        const { rows } = await client.query(
          `insert into providers (owner_id, type, name, destination_id, licence_no, whatsapp_msisdn, payout_msisdn, lat, lng, location_name, auto_accept, onboarding_step)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, 6) returning id`,
          [user.id, input.type, input.name, input.destinationId, input.licenceNo || null, input.whatsappPhone, input.payoutPhone, input.lat ?? null, input.lng ?? null, input.locationName || null],
        );
        const providerId = rows[0].id;
        const listing = await client.query(
          `insert into listings (provider_id, destination_id, kind, unit, title, capacity) values ($1, $2, $3, $4, $5, $6) returning id`,
          [providerId, input.destinationId, input.listing.kind, input.listing.unit, input.listing.title, input.listing.capacity],
        );
        const today = todayInKenya();
        await client.query(
          `insert into listing_prices (listing_id, season_start, season_end, net_kes) values ($1, $2, $3, $4)`,
          [listing.rows[0].id, addDays(today, -1), addDays(today, 730), input.listing.netKes],
        );
        await client.query(
          `insert into availability (listing_id, date, units_total)
           select $1, d::date, $2 from generate_series($3::date, $3::date + 180, interval '1 day') d`,
          [listing.rows[0].id, input.listing.capacity, today],
        );
        await client.query(
          `update profiles set roles = array(select distinct unnest(roles || '{provider}'::user_role[])) where user_id = $1`,
          [user.id],
        );
        return providerId;
      });
      return (await myProviders(user.id)).find((p) => p.id === providerId);
    },

    /** One month of a listing: what is held, booked or blocked each day. */
    async calendar(userId, listingId, month) {
      await ownsListing(userId, listingId);
      const { rows } = await db.query(
        `select date::text, units_total, units_held, units_booked, blocked from availability
         where listing_id = $1 and date >= $2::date and date < ($2::date + interval '1 month') order by date`,
        [listingId, `${month}-01`],
      );
      return rows.map((d) => ({ date: d.date, total: d.units_total, held: d.units_held, booked: d.units_booked, blocked: d.blocked }));
    },

    /** Block days (nothing for sale) or open them again. A day with a hold or booking stays as it is. */
    async blockDates(user, listingId, dates, blocked) {
      await ownsListing(user.id, listingId);
      if (blocked) {
        const busy = await db.query(
          `select date::text from availability where listing_id = $1 and date = any($2::date[]) and (units_held > 0 or units_booked > 0)`,
          [listingId, dates],
        );
        if (busy.rowCount) throw new ProviderError('date_in_use', { dates: busy.rows.map((r) => r.date) });
      }
      await asUser(db, user.id, (client) =>
        client.query(`update availability set blocked = $3 where listing_id = $1 and date = any($2::date[])`, [listingId, dates, blocked]));
    },

    async seasons(userId, listingId) {
      await ownsListing(userId, listingId);
      const { rows } = await db.query(
        `select id, season_start::text, season_end::text, net_kes from listing_prices where listing_id = $1 order by season_start`,
        [listingId],
      );
      return rows.map((s) => ({ id: s.id, seasonStart: s.season_start, seasonEnd: s.season_end, netKes: s.net_kes }));
    },

    /** Replaces the price seasons. Later seasons win where they overlap (the quote engine's rule). */
    async setSeasons(user, listingId, seasons) {
      await ownsListing(user.id, listingId);
      await asUser(db, user.id, async (client) => {
        await client.query('delete from listing_prices where listing_id = $1', [listingId]);
        for (const s of seasons) {
          await client.query(`insert into listing_prices (listing_id, season_start, season_end, net_kes) values ($1, $2, $3, $4)`, [listingId, s.seasonStart, s.seasonEnd, s.netKes]);
        }
      });
    },

    /** What each of my providers is owed and has been paid. */
    async payouts(userId) {
      const { rows } = await db.query(
        `select pr.id, pr.name, pr.payout_msisdn, pb.owed_kes,
                coalesce((select sum(amount_kes) from payouts po where po.provider_id = pr.id and po.status in ('scheduled', 'processing')), 0)::int as in_flight_kes
         from providers pr join private.provider_balances pb on pb.provider_id = pr.id where pr.owner_id = $1 order by pr.name`,
        [userId],
      );
      const history = await db.query(
        `select po.id, po.provider_id, po.amount_kes, po.status, po.paid_at, po.created_at, po.failure_reason, po.mpesa_receipt
         from payouts po join providers pr on pr.id = po.provider_id where pr.owner_id = $1 order by po.created_at desc limit 50`,
        [userId],
      );
      return {
        providers: rows.map((r) => ({ id: r.id, name: r.name, payoutPhone: r.payout_msisdn, owedKes: r.owed_kes - r.in_flight_kes, inFlightKes: r.in_flight_kes })),
        history: history.rows.map((h) => ({ id: h.id, providerId: h.provider_id, amountKes: h.amount_kes, status: h.status, paidAt: h.paid_at, createdAt: h.created_at, failureReason: h.failure_reason, receipt: h.mpesa_receipt })),
      };
    },
  };
}

module.exports = { createProviderService, ProviderError };
