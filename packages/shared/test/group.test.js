const test = require('node:test');
const assert = require('node:assert/strict');
const { splitEqually, checkShares } = require('../src/group');
const { splitRequestSchema } = require('../src/schemas');

test('equal shares: friends get round equal amounts, the organiser takes the odd shillings', () => {
  assert.deepEqual(splitEqually(105100, 2), [52550, 52550]);
  assert.deepEqual(splitEqually(31400, 3), [10468, 10466, 10466]);
  for (let n = 1; n <= 10; n++) assert.equal(splitEqually(99999, n).reduce((a, b) => a + b, 0), 99999);
});

test('custom shares must add up and fit M-PESA', () => {
  assert.equal(checkShares([20000, 11400], 31400), null);
  assert.equal(checkShares([20000, 11000], 31400), 'shares_do_not_add_up');
  assert.equal(checkShares([31400, 0], 31400), 'invalid_share');
  assert.equal(checkShares([250001, 1], 250002), 'share_over_limit');
});

test('split requests: friends have distinct Kenyan numbers', () => {
  const ok = splitRequestSchema.safeParse({ organiserName: 'Otieno', friends: [{ name: 'Achieng', phone: '0711 000 111' }] });
  assert.ok(ok.success);
  assert.equal(ok.data.friends[0].phone, '254711000111');
  const dup = splitRequestSchema.safeParse({ organiserName: 'O', friends: [{ name: 'A', phone: '0711000111' }, { name: 'B', phone: '+254711000111' }] });
  assert.equal(dup.success, false);
  const count = splitRequestSchema.safeParse({ organiserName: 'O', friends: [{ name: 'A', phone: '0711000111' }], shares: [1] });
  assert.equal(count.success, false);
});
