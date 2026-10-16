/**
 * Managing the catalogue. Admins (Safiri staff) see and change everything; an agency sees its
 * own packages and bookings, and may only package listings of providers it is linked to.
 * Every write runs as the acting user (asUser), so the audit log names them.
 */
const { addDays, slugify, todayInKenya } = require('@safiri/shared');
const { asUser } = require('../lib/roles');

const ERRORS = {
  not_found: 404,
  forbidden: 403,
  no_agency: 403,
  listing_not_allowed: 422,
  unpriceable: 422,
  slug_taken: 409,
  user_not_found: 404,
  destination_in_use: 409,
};

class ManageError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.status = ERRORS[code] || 400;
    this.details = details;
  }
}

const packageRow = (p) => ({
  id: p.id,
  slug: p.slug,
  status: p.status,
  title: p.title,
  summary: p.summary,
  nights: p.nights,
  agencyId: p.agency_id,
  agencyName: p.agency_name,
  destinationId: p.destination_id,
  destinationName: p.destination_name,
  marginBps: p.margin_bps,
  depositPct: p.deposit_pct,
  instalments: p.instalments,
  finalDueDays: p.final_due_days,
  graceDays: p.grace_days,
  cancelPolicy: p.cancel_policy,
  inclusions: p.inclusions,
  exclusions: p.exclusions,
  heroImage: p.hero_image,
  sw: p.sw || {},
  fromPriceKes: p.from_price_kes,
  publishedAt: p.published_at,
  updatedAt: p.updated_at,
  bookings: p.bookings === undefined ? undefined : Number(p.bookings),
});

const PACKAGE_SELECT = `
  select p.*, a.name as agency_name, d.name as destination_name,
         (select count(*) from bookings b where b.package_id = p.id and b.status in ('confirmed', 'fully_paid', 'completed')) as bookings
  from packages p join agencies a on a.id = p.agency_id join destinations d on d.id = p.destination_id`;

function createManageService({ db, quotes }) {
  /** What this user may manage: everything (admin) or the agencies they own. */
  async function scopeFor(user) {
    const admin = user.roles.includes('admin');
    const { rows } = await db.query('select id, name, slug from agencies where owner_id = $1 order by name', [user.id]);
    return { admin, agencies: rows, agencyIds: rows.map((a) => a.id) };
  }

  const inScope = (scope, agencyId) => scope.admin || scope.agencyIds.includes(agencyId);

  async function findPackage(id, scope) {
    const { rows } = await db.query(`${PACKAGE_SELECT} where p.id = $1`, [id]);
    const p = rows[0];
    if (!p || !inScope(scope, p.agency_id)) throw new ManageError('not_found');
    return p;
  }

  async function packageItems(packageId) {
    const { rows } = await db.query(
      `select pi.id, pi.listing_id, pi.day, pi.qty, to_char(pi.start_time, 'HH24:MI') as start_time, l.title, l.kind, l.unit, pr.name as provider
       from package_items pi join listings l on l.id = pi.listing_id join providers pr on pr.id = l.provider_id
       where pi.package_id = $1 order by pi.day, pi.start_time nulls last, l.title`,
      [packageId],
    );
    return rows.map((i) => ({ id: i.id, listingId: i.listing_id, day: i.day, qty: i.qty, startTime: i.start_time, title: i.title, kind: i.kind, unit: i.unit, provider: i.provider }));
  }

  /** Listings this agency may package: active, verified, and linked to the agency (admins: all). */
  async function allowedListingIds(scope, agencyId, listingIds) {
    const { rows } = await db.query(
      `select l.id from listings l
       join providers pr on pr.id = l.provider_id and pr.verified_at is not null
       where l.id = any($1::uuid[]) and l.active
         and ($2 or exists (select 1 from agency_providers ap where ap.provider_id = pr.id and ap.agency_id = $3 and ap.status = 'active'))`,
      [listingIds, scope.admin, agencyId],
    );
    return new Set(rows.map((r) => r.id));
  }

  async function uniqueSlug(client, base, excludeId) {
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      const { rowCount } = await client.query('select 1 from packages where slug = $1 and id is distinct from $2', [candidate, excludeId]);
      if (!rowCount) return candidate;
    }
    throw new ManageError('slug_taken');
  }

  async function writeItems(client, packageId, items) {
    await client.query('delete from package_items where package_id = $1', [packageId]);
    for (const i of items) {
      await client.query(
        'insert into package_items (package_id, listing_id, day, qty, start_time) values ($1, $2, $3, $4, $5)',
        [packageId, i.listingId, i.day, i.qty, i.startTime || null],
      );
    }
  }

  async function savePackage(user, scope, input, existing) {
    const agencyId = existing ? existing.agency_id : scope.admin ? input.agencyId || scope.agencyIds[0] : scope.agencyIds[0];
    if (!agencyId) throw new ManageError('no_agency');
    if (!inScope(scope, agencyId)) throw new ManageError('forbidden');

    const wanted = [...new Set(input.items.map((i) => i.listingId))];
    const allowed = await allowedListingIds(scope, agencyId, wanted);
    const bad = wanted.filter((id) => !allowed.has(id));
    if (bad.length) throw new ManageError('listing_not_allowed', { listingIds: bad });

    const id = await asUser(db, user.id, async (client) => {
      const slug = existing ? existing.slug : await uniqueSlug(client, slugify(input.title), null);
      const values = [
        agencyId, input.destinationId, slug, input.title, input.summary || '', input.nights, input.marginBps, input.depositPct,
        input.instalments, input.finalDueDays, input.graceDays, JSON.stringify(input.cancelPolicy), input.inclusions, input.exclusions,
        input.heroImage || null, JSON.stringify(input.sw || {}), user.id,
      ];
      if (existing) {
        await client.query(
          `update packages set agency_id = $1, destination_id = $2, slug = $3, title = $4, summary = $5, nights = $6, margin_bps = $7,
             deposit_pct = $8, instalments = $9, final_due_days = $10, grace_days = $11, cancel_policy = $12, inclusions = $13,
             exclusions = $14, hero_image = $15, sw = $16, updated_by = $17 where id = $18`,
          [...values, existing.id],
        );
        await writeItems(client, existing.id, input.items);
        return existing.id;
      }
      const { rows } = await client.query(
        `insert into packages (agency_id, destination_id, slug, title, summary, nights, margin_bps, deposit_pct, instalments,
           final_due_days, grace_days, cancel_policy, inclusions, exclusions, hero_image, sw, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id, slug`,
        values,
      );
      await writeItems(client, rows[0].id, input.items);
      return rows[0].id;
    });

    const p = await findPackage(id, scope);
    await quotes.refreshFromPrices({ slug: p.slug }); // the display price, from the same engine as quotes
    return getPackage(id, scope);
  }

  async function getPackage(id, scope) {
    const p = await findPackage(id, scope);
    return { ...packageRow(p), items: await packageItems(id) };
  }

  return {
    scopeFor,
    getPackage,

    async listPackages(scope) {
      const { rows } = await db.query(
        `${PACKAGE_SELECT} where $1 or p.agency_id = any($2::uuid[]) order by p.status, p.updated_at desc`,
        [scope.admin, scope.agencyIds],
      );
      return rows.map(packageRow);
    },

    createPackage: (user, scope, input) => savePackage(user, scope, input, null),

    async updatePackage(user, scope, id, input) {
      const existing = await findPackage(id, scope);
      return savePackage(user, scope, input, existing);
    },

    /** Publishing needs a price (so every item is bookable and priced) and at least one item. */
    async setStatus(user, scope, id, status) {
      const p = await findPackage(id, scope);
      if (status === 'published') {
        await quotes.refreshFromPrices({ slug: p.slug });
        const fresh = await findPackage(id, scope);
        if (!fresh.from_price_kes) throw new ManageError('unpriceable');
      }
      await asUser(db, user.id, (client) =>
        client.query(
          `update packages set status = $2::publish_status,
             published_at = case when $2::text = 'published' then coalesce(published_at, now()) else published_at end,
             updated_by = $3 where id = $1`,
          [id, status, user.id],
        ));
      return getPackage(id, scope);
    },

    async listDestinations() {
      const { rows } = await db.query(
        `select d.id, d.slug, d.name, d.region, d.lat, d.lng, d.summary, d.best_time, d.getting_there, d.drive_hours, d.hero_image, d.faq, d.sw,
                (select count(*) from packages p where p.destination_id = d.id and p.status = 'published') as published
         from destinations d order by d.name`,
      );
      return rows.map((d) => ({
        id: d.id, slug: d.slug, name: d.name, region: d.region, lat: Number(d.lat), lng: Number(d.lng), summary: d.summary, bestTime: d.best_time,
        gettingThere: d.getting_there, driveHours: d.drive_hours == null ? null : Number(d.drive_hours), heroImage: d.hero_image, faq: d.faq, sw: d.sw,
        publishedPackages: Number(d.published),
      }));
    },

    /** Listings an agency may add to a package, with today's net price (admins: every bookable listing). */
    async listListings(scope, { destinationId, agencyId }) {
      const today = todayInKenya();
      const { rows } = await db.query(
        `select l.id, l.title, l.kind, l.unit, l.capacity, pr.id as provider_id, pr.name as provider, pr.type as provider_type,
                (select lp.net_kes from listing_prices lp where lp.listing_id = l.id and lp.season_start <= $4 and lp.season_end >= $4
                 order by lp.season_start desc limit 1) as net_kes
         from listings l join providers pr on pr.id = l.provider_id
         where l.active and pr.verified_at is not null and ($1::uuid is null or l.destination_id = $1)
           and ($2 or exists (select 1 from agency_providers ap where ap.provider_id = pr.id and ap.agency_id = $3 and ap.status = 'active'))
         order by pr.name, l.title`,
        [destinationId || null, scope.admin, agencyId || scope.agencyIds[0] || null, today],
      );
      return rows.map((l) => ({ id: l.id, title: l.title, kind: l.kind, unit: l.unit, capacity: l.capacity, providerId: l.provider_id, provider: l.provider, providerType: l.provider_type, netKes: l.net_kes }));
    },

    async listBookings(scope) {
      const { rows } = await db.query(
        `select b.id, b.ref, b.status, b.start_date::text as start_date, b.end_date::text as end_date, b.travellers, b.total_kes, b.paid_kes,
                b.is_group, b.phone, b.created_at, p.title, p.slug,
                (select count(*) from booking_items bi where bi.booking_id = b.id and bi.provider_status = 'declined') as declined,
                (select count(*) from booking_items bi where bi.booking_id = b.id and bi.provider_status = 'pending') as pending
         from bookings b join packages p on p.id = b.package_id
         where b.status <> 'draft' and ($1 or p.agency_id = any($2::uuid[]))
         order by b.start_date desc limit 200`,
        [scope.admin, scope.agencyIds],
      );
      return rows.map((b) => ({
        bookingId: b.id, ref: b.ref, status: b.status, startDate: b.start_date, endDate: b.end_date, travellers: b.travellers,
        totalKes: b.total_kes, paidKes: b.paid_kes, isGroup: b.is_group, phone: b.phone, createdAt: b.created_at, title: b.title, slug: b.slug,
        providerDeclined: Number(b.declined), providerPending: Number(b.pending),
      }));
    },

    // ---- admin only ----------------------------------------------------------------------
    async saveDestination(user, input, id = null) {
      const sw = JSON.stringify(input.sw || {});
      const faq = JSON.stringify(input.faq || []);
      return asUser(db, user.id, async (client) => {
        if (id) {
          const { rows } = await client.query(
            `update destinations set name = $2, region = $3, lat = $4, lng = $5, summary = $6, best_time = $7, getting_there = $8,
               drive_hours = $9, hero_image = $10, faq = $11, sw = $12 where id = $1 returning id, slug`,
            [id, input.name, input.region, input.lat, input.lng, input.summary || '', input.bestTime || '', input.gettingThere || '',
              input.driveHours ?? null, input.heroImage || null, faq, sw],
          );
          if (!rows[0]) throw new ManageError('not_found');
          return rows[0];
        }
        const base = slugify(input.name);
        let slug = base;
        for (let n = 2; (await client.query('select 1 from destinations where slug = $1', [slug])).rowCount; n++) slug = `${base}-${n}`;
        const { rows } = await client.query(
          `insert into destinations (slug, name, region, lat, lng, summary, best_time, getting_there, drive_hours, hero_image, faq, sw)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id, slug`,
          [slug, input.name, input.region, input.lat, input.lng, input.summary || '', input.bestTime || '', input.gettingThere || '',
            input.driveHours ?? null, input.heroImage || null, faq, sw],
        );
        return rows[0];
      });
    },

    async listProviders() {
      const { rows } = await db.query(
        `select pr.id, pr.name, pr.type, pr.licence_no, pr.verified_at, pr.auto_accept, pr.onboarding_step, pr.whatsapp_msisdn, d.name as destination,
                (select count(*) from listings l where l.provider_id = pr.id and l.active) as listings, pr.created_at
         from providers pr left join destinations d on d.id = pr.destination_id order by pr.verified_at nulls first, pr.created_at desc`,
      );
      return rows.map((p) => ({ id: p.id, name: p.name, type: p.type, licenceNo: p.licence_no, verifiedAt: p.verified_at, autoAccept: p.auto_accept,
        onboardingStep: p.onboarding_step, phone: p.whatsapp_msisdn, destination: p.destination, listings: Number(p.listings), createdAt: p.created_at }));
    },

    /** Verifying makes a provider bookable; unverifying hides their listings from the public. */
    async verifyProvider(user, id, verified) {
      const { rowCount } = await asUser(db, user.id, (client) =>
        client.query(
          `update providers set verified_at = case when $2::boolean then coalesce(verified_at, now()) else null end,
             verified_by = case when $2::boolean then $3::uuid end where id = $1`,
          [id, verified, user.id],
        ));
      if (!rowCount) throw new ManageError('not_found');
    },

    /** Links a provider to an agency so the agency can package its listings. */
    async linkProvider(user, agencyId, providerId, status) {
      await asUser(db, user.id, (client) =>
        client.query(
          `insert into agency_providers (agency_id, provider_id, status) values ($1, $2, $3)
           on conflict (agency_id, provider_id) do update set status = excluded.status`,
          [agencyId, providerId, status],
        ));
    },

    async setRoles(user, email, roles) {
      const { rows } = await asUser(db, user.id, (client) =>
        // ::text[] because pg does not decode arrays of custom enums (they arrive as "{a,b}" strings).
        client.query('update profiles set roles = $2::user_role[] where email = lower($1) returning user_id, roles::text[]', [email, roles]));
      if (!rows[0]) throw new ManageError('user_not_found');
      return rows[0];
    },

    async createAgency(user, { ownerEmail, name, licenceNo }) {
      return asUser(db, user.id, async (client) => {
        const owner = await client.query('select user_id from profiles where email = lower($1)', [ownerEmail]);
        if (!owner.rows[0]) throw new ManageError('user_not_found');
        const base = slugify(name);
        let slug = base;
        for (let n = 2; (await client.query('select 1 from agencies where slug = $1', [slug])).rowCount; n++) slug = `${base}-${n}`;
        const { rows } = await client.query(
          `insert into agencies (owner_id, name, slug, licence_no, verified_at) values ($1, $2, $3, $4, now()) returning id, slug`,
          [owner.rows[0].user_id, name, slug, licenceNo || null],
        );
        await client.query(
          `update profiles set roles = array(select distinct unnest(roles || '{agency}'::user_role[])) where user_id = $1`,
          [owner.rows[0].user_id],
        );
        return rows[0];
      });
    },

    /** Providers an agency works with (admins: everyone). */
    async listAgencyProviders(scope) {
      const { rows } = await db.query(
        `select pr.id, pr.name, pr.type, pr.licence_no, pr.verified_at, pr.whatsapp_msisdn, d.name as destination,
                (select count(*) from listings l where l.provider_id = pr.id and l.active) as listings,
                (select ap.status::text from agency_providers ap where ap.provider_id = pr.id and ap.agency_id = any($2::uuid[]) limit 1) as link
         from providers pr left join destinations d on d.id = pr.destination_id
         where $1 or exists (select 1 from agency_providers ap where ap.provider_id = pr.id and ap.agency_id = any($2::uuid[]))
         order by pr.verified_at nulls first, pr.name`,
        [scope.admin, scope.agencyIds],
      );
      return rows.map((p) => ({ id: p.id, name: p.name, type: p.type, licenceNo: p.licence_no, verifiedAt: p.verified_at, phone: p.whatsapp_msisdn, destination: p.destination, listings: Number(p.listings), link: p.link }));
    },

    /** What my agencies are owed (margin on completed trips) and have been paid. */
    async listPayouts(scope) {
      const { rows } = await db.query(
        `select a.id, a.name,
                coalesce((select sum(le.credit_kes - le.debit_kes) from ledger_entries le join bookings b on b.id = le.booking_id join packages p on p.id = b.package_id
                          where p.agency_id = a.id and le.account = 'agency_payable'), 0)::int as earned_kes,
                coalesce((select sum(po.amount_kes) from payouts po where po.agency_id = a.id and po.status = 'paid'), 0)::int as paid_kes
         from agencies a where $1 or a.id = any($2::uuid[]) order by a.name`,
        [scope.admin, scope.agencyIds],
      );
      const history = await db.query(
        `select po.id, po.agency_id, po.amount_kes, po.status, po.paid_at, po.created_at, po.mpesa_receipt from payouts po
         where po.agency_id is not null and ($1 or po.agency_id = any($2::uuid[])) order by po.created_at desc limit 50`,
        [scope.admin, scope.agencyIds],
      );
      return {
        agencies: rows.map((a) => ({ id: a.id, name: a.name, earnedKes: a.earned_kes, paidKes: a.paid_kes, owedKes: a.earned_kes - a.paid_kes })),
        history: history.rows.map((h) => ({ id: h.id, agencyId: h.agency_id, amountKes: h.amount_kes, status: h.status, paidAt: h.paid_at, createdAt: h.created_at, receipt: h.mpesa_receipt })),
      };
    },

    nextStart: () => addDays(todayInKenya(), 14),
  };
}

module.exports = { createManageService, ManageError };
