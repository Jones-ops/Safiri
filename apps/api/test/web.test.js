const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { seedCatalogue } = require('./helpers/seed-catalogue');

const BASE = 'https://safiri.example';

async function makeApp({ env = {}, catalogue = seedCatalogue() } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: BASE, SUPABASE_URL: 'https://proj.supabase.co', ...env });
  return buildApp(config, { supabase: null, catalogue, verifyToken: async () => null, profiles: {} });
}

const jsonLdOf = (body) =>
  [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

test('home lists destinations and every published package with all-in prices', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['cache-control'], /max-age=300/);
  assert.match(res.body, /Naivasha lakeside weekend/);
  assert.match(res.body, /KES 15,700 per person/);
  assert.match(res.body, /or 4 x 3,925/);
  assert.doesNotMatch(res.body, /flamingo/i, 'draft package is not public');
  assert.equal((res.body.match(/class="card"/g) || []).length, 8);
  await app.close();
});

test('package page: price, plan, payment schedule, refund tiers, verified providers', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/p/naivasha-lakeside-weekend' });
  assert.equal(res.statusCode, 200);
  for (const text of [
    'Day 1</strong>: Nairobi-Naivasha return shuttle',
    'Deposit to book</td><td>KES 3,925',
    'Instalment 3</td><td>KES 3,925',
    '30 days or more before travel: 100% back',
    '14 to 29 days before travel: 50% back',
    'Less than 14 days before travel: no refund',
    'Ziwa Shores Lodge',
    'Licence TRA/AC/2025/1187',
    'Open in the Safiri app',
  ]) {
    assert.ok(res.body.includes(text), `missing: ${text}`);
  }
  assert.match(res.body, /intent:\/\/p\/naivasha-lakeside-weekend#Intent;scheme=safiri;package=ke\.safiri\.app/);
  await app.close();
});

test('package JSON-LD is a Product + TouristTrip with an offer in KES', async () => {
  const app = await makeApp();
  const [ld] = jsonLdOf((await app.inject({ url: '/p/naivasha-lakeside-weekend' })).body);
  const trip = ld['@graph'].find((n) => Array.isArray(n['@type']) && n['@type'].includes('TouristTrip'));
  assert.deepEqual(trip['@type'], ['Product', 'TouristTrip']);
  assert.equal(trip.offers.price, 15700);
  assert.equal(trip.offers.priceCurrency, 'KES');
  assert.equal(trip.aggregateRating, undefined, 'no reviews yet, so no rating');
  assert.ok(ld['@graph'].some((n) => n['@type'] === 'LodgingBusiness' && n.name === 'Ziwa Shores Lodge'));
  assert.ok(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList'));
  assert.ok(ld['@graph'].some((n) => n['@type'] === 'FAQPage'));
  await app.close();
});

test('a reviewed package carries aggregateRating and reviews', async () => {
  const app = await makeApp();
  const [ld] = jsonLdOf((await app.inject({ url: '/p/naivasha-day-escape' })).body);
  const trip = ld['@graph'][0];
  assert.deepEqual(trip.aggregateRating, { '@type': 'AggregateRating', ratingValue: 5, reviewCount: 1, bestRating: 5, worstRating: 1 });
  assert.equal(trip.review[0].author.name, 'Verified traveller');
  await app.close();
});

test('destination page lists only its packages and its FAQ', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/d/diani' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Diani beach long weekend/);
  assert.doesNotMatch(res.body, /Maasai Mara budget safari/);
  assert.match(res.body, /Which SGR class is included\?/);
  await app.close();
});

test('Kiswahili pages: ?lang=sw and Accept-Language', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/d/naivasha?lang=sw' });
  assert.match(res.body, /<html lang="sw">/);
  assert.match(res.body, /Wakati mzuri wa kwenda/);
  assert.match(res.body, /Mwaka mzima\. Kiangazi/);
  const byHeader = await app.inject({ url: '/', headers: { 'accept-language': 'sw-KE,sw;q=0.9,en;q=0.8' } });
  assert.match(byHeader.body, /<html lang="sw">/);
  assert.match(byHeader.body, /hreflang="en"/);
  await app.close();
});

test('unknown or malformed slugs get a 404 page, not an error', async () => {
  const app = await makeApp();
  for (const url of ['/p/no-such-trip', '/p/%3Cscript%3E', '/d/atlantis']) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.match(res.body, /noindex/);
  }
  await app.close();
});

test('catalogue text is escaped in HTML and cannot break out of JSON-LD', async () => {
  const hostile = '<script>alert(1)</script> & "quotes"';
  const app = await makeApp({ catalogue: seedCatalogue({ overrides: { naivashaWeekend: { title: hostile } } }) });
  const res = await app.inject({ url: '/p/naivasha-lakeside-weekend' });
  assert.ok(!res.body.includes('<script>alert(1)</script>'));
  assert.ok(res.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
  const [ld] = jsonLdOf(res.body);
  assert.equal(ld['@graph'][0].name, hostile, 'JSON-LD still parses to the original text');
  await app.close();
});

test('a catalogue outage shows an error page with 503', async () => {
  const failing = { ...seedCatalogue(), listDestinations: async () => { throw new Error('db down'); } };
  const app = await makeApp({ catalogue: failing });
  const res = await app.inject({ url: '/' });
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /Something went wrong/);
  await app.close();
});

test('sitemap lists home, destinations and packages with Kiswahili alternates', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/sitemap.xml' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.equal((res.body.match(/<url>/g) || []).length, 1 + 4 + 8);
  assert.ok(res.body.includes(`<loc>${BASE}/p/amboseli-kilimanjaro-weekend</loc>`));
  assert.ok(res.body.includes(`hreflang="sw" href="${BASE}/d/diani?lang=sw"`));
  await app.close();
});

test('robots.txt keeps personal links out of search and points to the sitemap', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/robots.txt' });
  for (const line of ['Disallow: /pay/', 'Disallow: /i/', 'Disallow: /t/', `Sitemap: ${BASE}/sitemap.xml`]) {
    assert.ok(res.body.includes(line), line);
  }
  await app.close();
});

test('llms.txt describes every trip with its all-in price', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/llms.txt' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /^# Safiri\n\n> /);
  assert.ok(res.body.includes(`[Naivasha lakeside weekend](${BASE}/p/naivasha-lakeside-weekend): Naivasha, 2 nights. KES 15,700 per person, or 4 payments of KES 3,925.`));
  assert.ok(res.body.includes('Day trip. KES 8,100 per person.'));
  await app.close();
});

test('assetlinks.json: 404 until the signing key is configured, then the App Links statement', async () => {
  let app = await makeApp();
  assert.equal((await app.inject({ url: '/.well-known/assetlinks.json' })).statusCode, 404);
  await app.close();

  app = await makeApp({ env: { ANDROID_CERT_SHA256: 'aa:bb:cc, DD:EE:FF' } });
  const res = await app.inject({ url: '/.well-known/assetlinks.json' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(res.json(), [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'ke.safiri.app', sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'] },
  }]);
  await app.close();
});

test('trip, invite and pay links are app-only and never indexed', async () => {
  const app = await makeApp();
  for (const url of ['/t/abc', '/i/INVGR0UP10X', '/pay/123']) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    assert.match(res.body, /This link opens in the Safiri app/);
  }
  await app.close();
});

test('images use the Storage bucket with a small default and a large srcset', async () => {
  const app = await makeApp();
  const res = await app.inject({ url: '/d/amboseli' });
  assert.ok(res.body.includes('https://proj.supabase.co/storage/v1/object/public/public-images/photos/amboseli-kilimanjaro-640.jpg 640w'));
  assert.ok(res.body.includes('amboseli-kilimanjaro-1280.jpg 1280w'));
  await app.close();
});
