import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderApprovalTeal,
  renderClearTeal,
  checkSpend,
  ALLOWANCE_APP_KEYS,
} from '../src/index.js';

test('approval TEAL routes the methods and uses stateful/inner-txn opcodes', () => {
  const teal = renderApprovalTeal();
  assert.match(teal, /#pragma version 8/);
  assert.match(teal, /byte "spend"/);
  assert.match(teal, /byte "reclaim"/);
  assert.match(teal, /app_global_put/);
  assert.match(teal, /app_global_get/);
  assert.match(teal, /itxn_submit/); // inner-transaction payout
  assert.match(teal, /int UpdateApplication\n==\nbnz reject/); // updates blocked
  // every state key is referenced
  for (const k of Object.values(ALLOWANCE_APP_KEYS)) {
    assert.match(teal, new RegExp(`byte "${k}"`));
  }
});

test('clear program is the trivial approve', () => {
  assert.match(renderClearTeal(), /#pragma version 8\nint 1\nreturn/);
});

const state = (over = {}) => ({
  cap: 1_000_000,
  budget: 1_000_000,
  spent: 0,
  period: 0,
  expiry: 1000,
  wstart: 0,
  ...over,
});

test('checkSpend accepts an in-budget, in-cap spend', () => {
  assert.deepEqual(checkSpend({ amount: 400_000, currentRound: 10 }, state()), { ok: true });
});

test('checkSpend rejects invalid, over-cap, over-budget, and expired spends', () => {
  assert.equal(checkSpend({ amount: 0, currentRound: 10 }, state()).reason, 'amount_invalid');
  assert.equal(
    checkSpend({ amount: 1_500_000, currentRound: 10 }, state()).reason,
    'amount_exceeds_cap',
  );
  assert.equal(
    checkSpend({ amount: 400_000, currentRound: 10 }, state({ spent: 800_000 })).reason,
    'exceeds_budget',
  );
  assert.equal(
    checkSpend({ amount: 100_000, currentRound: 2000 }, state()).reason,
    'expired',
  );
});

test('checkSpend resets the window once the recurring period elapses', () => {
  // spent 900k of 1M, but the period (100) has elapsed since wstart -> fresh window.
  const s = state({ spent: 900_000, period: 100, wstart: 0, expiry: 10_000 });
  assert.equal(checkSpend({ amount: 500_000, currentRound: 50 }, s).reason, 'exceeds_budget'); // same window
  assert.deepEqual(checkSpend({ amount: 500_000, currentRound: 200 }, s), { ok: true }); // window reset
});
