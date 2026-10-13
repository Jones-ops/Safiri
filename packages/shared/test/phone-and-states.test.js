const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMsisdn, formatMsisdn, toE164 } = require('../src/phone');
const { canTransition, BOOKING_TRANSITIONS } = require('../src/constants');
const { msisdnSchema, consentsSchema } = require('../src/schemas');
const { en, sw, keyPaths } = require('../src/i18n');

test('normalises the ways Kenyans type numbers', () => {
  for (const input of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678', '0712-345-678']) {
    assert.equal(normalizeMsisdn(input), '254712345678', input);
  }
  assert.equal(normalizeMsisdn('0110123456'), '254110123456'); // 01 numbers
});

test('rejects numbers that are not Kenyan mobiles', () => {
  for (const input of ['', '0201234567', '071234567', '07123456789', '+255712345678', 'abc', null, undefined]) {
    assert.equal(normalizeMsisdn(input), null, String(input));
  }
});

test('formats for display and for Supabase', () => {
  assert.equal(formatMsisdn('254712345678'), '0712 345 678');
  assert.equal(toE164('0712345678'), '+254712345678');
});

test('zod phone schema outputs the stored form', () => {
  assert.equal(msisdnSchema.parse(' 0712 345 678 '), '254712345678');
  assert.equal(msisdnSchema.safeParse('12345').success, false);
});

test('booking consent is required', () => {
  assert.equal(consentsSchema.safeParse({ booking: true, analytics: false }).success, true);
  assert.equal(consentsSchema.safeParse({ booking: false, analytics: true }).success, false);
});

test('booking states only move the ways the plan allows', () => {
  assert.ok(canTransition('held', 'confirmed'));
  assert.ok(canTransition('held', 'expired'));
  assert.ok(canTransition('confirmed', 'fully_paid'));
  assert.ok(canTransition('fully_paid', 'completed'));
  assert.ok(canTransition('confirmed', 'cancelled'));
  assert.ok(!canTransition('expired', 'confirmed'));
  assert.ok(!canTransition('held', 'completed'));
  assert.ok(!canTransition('completed', 'cancelled'));
  for (const terminal of ['completed', 'expired', 'cancelled']) assert.deepEqual(BOOKING_TRANSITIONS[terminal], []);
});

test('English and Kiswahili have exactly the same keys', () => {
  const enKeys = keyPaths(en).sort();
  const swKeys = keyPaths(sw).sort();
  assert.deepEqual(swKeys.filter((k) => !enKeys.includes(k)), [], 'keys only in sw.json');
  assert.deepEqual(enKeys.filter((k) => !swKeys.includes(k)), [], 'keys missing from sw.json');
});

test('no empty strings in either language', () => {
  for (const [name, strings] of [['en', en], ['sw', sw]]) {
    for (const path of keyPaths(strings)) {
      const value = path.split('.').reduce((o, k) => o[k], strings);
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${name}:${path}`);
    }
  }
});
