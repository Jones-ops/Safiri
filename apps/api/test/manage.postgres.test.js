/**
 * Catalogue management on a real Postgres: an agency creates, prices and publishes a package
 * and sees its bookings; an admin manages roles, destinations, providers and agencies; travellers
 * and other agencies are kept out.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

let pg;
let db;
let app;
const users = {};

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 5 });
  for (const [name, phone] of [['wanjiru', '254700000001'], ['agency', '254700000021'], ['ziwa', '254700000101']]) {
    users[name] = (await db.query('select user_id from profiles where phone = $1', [phone])).rows[0].user_id;
  }
  // Make Wanjiru the platform admin, with an email the roles route can find.
  await db.query(`update profiles set email = 'admin@safiri.example' where user_id = $1`, [users.wanjiru]);
  await db.query(`update profiles set roles = '{traveller,admin}' where user_id = $1`, [users.wanjiru]);
  await db.query(`update profiles set email = 'otieno@safiri.example' where phone = '254700000002'`);
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign' });
  app = await buildApp(config, {
    supabase: null, db, profiles: {}, catalogue: {},
    verifyToken: async (token) => (users[token] ? { sub: users[token] } : null),
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const as = (who) => ({ authorization: `Bearer ${who}` });
const get = (url, who) => app.inject({ url, headers: as(who) });
const send = (method, url, who, payload) => app.inject({ method, url, headers: as(who), payload });

let draft;

test('roles gate the routes: travellers are refused, agencies and admins are not', async () => {
  assert.equal((await get('/v1/manage/me', 'ziwa')).statusCode, 403, 'a provider is not staff');
  assert.equal((await app.inject({ url: '/v1/manage/me' })).statusCode, 401);
  const agency = (await get('/v1/manage/me', 'agency')).json();
  assert.equal(agency.admin, false);
  assert.equal(agency.agencies.length, 1);
  assert.equal(agency.agencies[0].slug, 'safiri-getaways');
  const admin = (await get('/v1/manage/me', 'wanjiru')).json();
  assert.equal(admin.admin, true);
  assert.equal((await get('/v1/manage/providers', 'agency')).statusCode, 403, 'admin only');
});

test('an agency creates a draft package from linked listings; the display price matches a quote', async () => {
  const listings = (await get('/v1/manage/listings', 'agency')).json().listings;
  const lodge = listings.find((l) => l.title === 'Lake-view room, breakfast included');
  const shuttle = listings.find((l) => l.title === 'Nairobi-Naivasha return shuttle');
  const boat = listings.find((l) => l.title === 'Boat ride to Crescent Island');
  assert.equal(lodge.netKes, 4500, 'listings come with today\'s net price');
  const destinationId = (await get('/v1/manage/destinations', 'agency')).json().destinations.find((d) => d.slug === 'naivasha').id;

  const res = await send('POST', '/v1/manage/packages', 'agency', {
    destinationId, title: 'Naivasha Lakeside Weekend', summary: 'Two nights by the lake.', nights: 2, marginBps: 1500, depositPct: 25,
    instalments: 3, finalDueDays: 7, graceDays: 2,
    cancelPolicy: [{ days_before: 30, refund_pct: 100 }, { days_before: 14, refund_pct: 50 }, { days_before: 0, refund_pct: 0 }],
    inclusions: ['Shuttle', '2 nights', 'Boat ride'], exclusions: ['Lunch'],
    items: [{ listingId: shuttle.id, day: 1, qty: 1, startTime: '07:00' }, { listingId: lodge.id, day: 1, qty: 2 }, { listingId: boat.id, day: 2, qty: 1, startTime: '10:00' }],
  });
  assert.equal(res.statusCode, 201, res.body);
  draft = res.json();
  assert.equal(draft.status, 'draft');
  assert.equal(draft.slug, 'naivasha-lakeside-weekend-2', 'the seeded package already has the plain slug');
  assert.equal(draft.fromPriceKes, 15700, 'the plan\'s worked example, priced by the quote engine');
  assert.equal(draft.items.length, 3);
  assert.equal(draft.items[0].startTime, '07:00');

  // Travellers cannot quote (or see) a draft.
  const quote = await app.inject({ method: 'POST', url: '/v1/quotes', payload: { packageSlug: draft.slug, startDate: '2027-03-06', travellers: 2 } });
  assert.equal(quote.statusCode, 404, 'drafts are not public');
  const audit = await db.query(`select actor from audit_log where entity = 'packages' and entity_id = $1 and action = 'INSERT'`, [draft.id]);
  assert.equal(audit.rows[0].actor, users.agency, 'the audit log names the agency user, not the service role');
});

test('editing replaces the items and reprices; publishing makes it public and bookable', async () => {
  const listings = (await get('/v1/manage/listings', 'agency')).json().listings;
  const lodge = listings.find((l) => l.title === 'Lake-view room, breakfast included');
  const { id, ...fields } = draft;
  const edited = await send('PUT', `/v1/manage/packages/${id}`, 'agency', {
    destinationId: fields.destinationId, title: fields.title, summary: fields.summary, nights: 1, marginBps: 2000, depositPct: 30,
    instalments: 2, finalDueDays: 7, graceDays: 2, cancelPolicy: fields.cancelPolicy, inclusions: ['1 night'], exclusions: [],
    items: [{ listingId: lodge.id, day: 1, qty: 1 }],
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().items.length, 1);
  assert.equal(edited.json().fromPriceKes, 5700, '4,500 + 20% margin + 5% fee, rounded up to 50');

  const published = await send('POST', `/v1/manage/packages/${id}/publish`, 'agency');
  assert.equal(published.json().status, 'published', published.body);
  assert.ok(published.json().publishedAt);
  const quote = await app.inject({ method: 'POST', url: '/v1/quotes', payload: { packageSlug: draft.slug, startDate: '2027-03-06', travellers: 2 } });
  assert.equal(quote.statusCode, 201, 'now bookable');
  assert.equal(quote.json().perPersonKes, 5700, 'travellers are charged exactly the display price');
  const live = await db.query(`select status from packages where id = $1`, [id]);
  assert.equal(live.rows[0].status, 'published');

  const unpublished = await send('POST', `/v1/manage/packages/${id}/unpublish`, 'agency');
  assert.equal(unpublished.json().status, 'unpublished');
  const gone = await app.inject({ method: 'POST', url: '/v1/quotes', payload: { packageSlug: draft.slug, startDate: '2027-03-06', travellers: 2 } });
  assert.equal(gone.statusCode, 404);
});

test('an agency may only package listings of providers it is linked to', async () => {
  const flamingo = (await db.query(`select id from listings where title = 'Lakeside cottage'`)).rows[0].id; // unverified provider
  const destinationId = draft.destinationId;
  const res = await send('POST', '/v1/manage/packages', 'agency', {
    destinationId, title: 'Flamingo', nights: 1, marginBps: 1500, depositPct: 25, instalments: 1, finalDueDays: 7, graceDays: 2,
    cancelPolicy: [{ days_before: 0, refund_pct: 0 }], inclusions: [], exclusions: [], items: [{ listingId: flamingo, day: 1, qty: 1 }],
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error, 'listing_not_allowed');
});

test('an agency sees the bookings on its packages, with provider responses', async () => {
  const res = await get('/v1/manage/bookings', 'agency');
  assert.equal(res.statusCode, 200);
  const refs = res.json().bookings.map((b) => b.ref).sort();
  assert.ok(refs.includes('SAF-C0NF01') && refs.includes('SAF-GR0UP1'));
  assert.ok(!refs.includes('SAF-D7RAFT'), 'drafts are noise');
  const confirmed = res.json().bookings.find((b) => b.ref === 'SAF-C0NF01');
  assert.equal(confirmed.providerPending, 0);
});

test('another agency cannot see or edit this one\'s packages', async () => {
  const other = await db.query(`select user_id from profiles where phone = '254700000003'`);
  await db.query(`update profiles set roles = '{traveller,agency}' where user_id = $1`, [other.rows[0].user_id]);
  await db.query(`insert into agencies (owner_id, name, slug, verified_at) values ($1, 'Other Tours', 'other-tours', now())`, [other.rows[0].user_id]);
  users.other = other.rows[0].user_id;
  assert.equal((await get('/v1/manage/packages', 'other')).json().packages.length, 0);
  assert.equal((await get(`/v1/manage/packages/${draft.id}`, 'other')).statusCode, 404);
  assert.equal((await send('POST', `/v1/manage/packages/${draft.id}/publish`, 'other')).statusCode, 404);
});

test('admins manage roles, destinations, providers and agencies', async () => {
  const roles = await send('POST', '/v1/manage/roles', 'wanjiru', { email: 'otieno@safiri.example', roles: ['traveller', 'admin'] });
  assert.equal(roles.statusCode, 200, roles.body);
  assert.deepEqual(roles.json().roles, ['traveller', 'admin']);
  assert.equal((await send('POST', '/v1/manage/roles', 'wanjiru', { email: 'nobody@safiri.example', roles: ['admin'] })).statusCode, 404);

  const dest = await send('POST', '/v1/manage/destinations', 'wanjiru', { name: 'Lake Nakuru', region: 'Nakuru County', lat: -0.37, lng: 36.08, driveHours: 3 });
  assert.equal(dest.statusCode, 201, dest.body);
  assert.equal(dest.json().slug, 'lake-nakuru');
  const patched = await send('PATCH', `/v1/manage/destinations/${dest.json().id}`, 'wanjiru', { name: 'Lake Nakuru', region: 'Nakuru County', lat: -0.37, lng: 36.08, summary: 'Flamingos and rhinos.' });
  assert.equal(patched.statusCode, 200);
  const saved = await db.query(`select summary, drive_hours from destinations where slug = 'lake-nakuru'`);
  assert.equal(saved.rows[0].summary, 'Flamingos and rhinos.');
  assert.equal(saved.rows[0].drive_hours, null, 'a PATCH is a full replacement: the earlier drive time was not re-sent');

  const providers = (await get('/v1/manage/providers', 'wanjiru')).json().providers;
  const flamingo = providers.find((p) => p.name === 'Flamingo Point Cottages');
  assert.equal(flamingo.verifiedAt, null);
  assert.equal((await send('POST', `/v1/manage/providers/${flamingo.id}/verify`, 'wanjiru', { verified: true })).statusCode, 204);
  const verified = (await get('/v1/manage/providers', 'wanjiru')).json().providers.find((p) => p.id === flamingo.id);
  assert.ok(verified.verifiedAt, 'now bookable');

  const agency = await send('POST', '/v1/manage/agencies', 'wanjiru', { ownerEmail: 'otieno@safiri.example', name: 'Otieno Travels' });
  assert.equal(agency.statusCode, 201, agency.body);
  const link = await send('POST', `/v1/manage/agencies/${agency.json().id}/providers/${flamingo.id}`, 'wanjiru', { status: 'active' });
  assert.equal(link.statusCode, 204);
  const otienoRoles = (await db.query(`select roles from profiles where email = 'otieno@safiri.example'`)).rows[0].roles;
  assert.ok(otienoRoles.includes('agency') && otienoRoles.includes('admin'), 'agency role added, others kept');
  assert.equal((await send('POST', '/v1/manage/agencies', 'agency', { ownerEmail: 'otieno@safiri.example', name: 'X' })).statusCode, 403);
});
