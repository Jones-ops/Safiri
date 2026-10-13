/**
 * Slice 1 done-when: "every public page shows zero errors in the Schema.org validator".
 * The validator's errors are unknown types and properties a type doesn't accept; this test
 * checks every JSON-LD node on every public page against the schema.org vocabulary
 * (test/fixtures/schemaorg-subset.json, from `npm run schema:refresh`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vocab = require('./fixtures/schemaorg-subset.json');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { seedCatalogue } = require('./helpers/seed-catalogue');
const data = require('../../../supabase/seed/data');

function allowedProperties(type) {
  const seen = new Set();
  const props = new Set();
  const walk = (t) => {
    if (seen.has(t)) return;
    seen.add(t);
    const def = vocab.types[t];
    if (!def) throw new Error(`schema.org type "${t}" is not in the fixture: add it to scripts/refresh-schema-vocab.js`);
    def.properties.forEach((p) => props.add(p));
    def.parents.forEach(walk);
  };
  walk(type);
  return props;
}

/** Returns a list of "path: problem" strings, like the validator's error list. */
function validate(node, path = '$', errors = []) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => validate(n, `${path}[${i}]`, errors));
    return errors;
  }
  if (!node || typeof node !== 'object') return errors;
  const types = node['@type'] ? [].concat(node['@type']) : null;
  if (types) {
    let allowed;
    try {
      allowed = new Set(types.flatMap((t) => [...allowedProperties(t)]));
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
      return errors;
    }
    for (const key of Object.keys(node)) {
      if (key.startsWith('@')) continue;
      if (!allowed.has(key)) errors.push(`${path}: "${key}" is not a property of ${types.join(' + ')}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== '@context') validate(value, `${path}.${key}`, errors);
  }
  return errors;
}

const pagesToCheck = [
  '/',
  '/?lang=sw',
  ...Object.values(data.destinations).map((d) => `/d/${d.slug}`),
  ...Object.values(data.packages).filter((p) => p.status !== 'draft').map((p) => `/p/${p.slug}`),
  '/p/naivasha-day-escape?lang=sw',
];

test('the validator itself catches the mistake the plan review found', () => {
  const errors = validate({ '@type': 'TouristTrip', name: 'x', aggregateRating: {} });
  assert.deepEqual(errors, ['$: "aggregateRating" is not a property of TouristTrip']);
});

test('every public page has valid JSON-LD with zero schema.org errors', async () => {
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: 'https://safiri.example', SUPABASE_URL: 'https://proj.supabase.co' });
  const app = await buildApp(config, { supabase: null, catalogue: seedCatalogue(), verifyToken: async () => null, profiles: {} });
  for (const url of pagesToCheck) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
    const blocks = [...res.body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    assert.ok(blocks.length > 0, `${url}: no JSON-LD`);
    for (const [, json] of blocks) {
      const doc = JSON.parse(json);
      assert.equal(doc['@context'], 'https://schema.org', url);
      assert.deepEqual(validate(doc['@graph'] || doc), [], url);
    }
  }
  await app.close();
});
