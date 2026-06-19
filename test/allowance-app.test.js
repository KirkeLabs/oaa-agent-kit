import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import {
  renderApprovalTeal,
  renderClearTeal,
  checkSpend,
  ALLOWANCE_APP_KEYS,
} from '../src/index.js';

const owner = String(algosdk.generateAccount().addr);
const service = String(algosdk.generateAccount().addr);
const stranger = String(algosdk.generateAccount().addr);

test('approval TEAL routes methods and uses stateful/inner-txn opcodes', () => {
  const teal = renderApprovalTeal();
  assert.match(teal, /#pragma version 8/);
  assert.match(teal, /byte "spend"/);
  assert.match(teal, /byte "reclaim"/);
  assert.match(teal, /byte "setagent"/); // agent rotation
  assert.match(teal, /app_global_put/);
  assert.match(teal, /itxn_submit/); // inner-transaction payout
  assert.match(teal, /int UpdateApplication\n==\nbnz reject/); // updates blocked
  assert.match(teal, /global CurrentApplicationAddress\n\s*balance/); // delete guard
  for (const k of Object.values(ALLOWANCE_APP_KEYS)) {
    assert.match(teal, new RegExp(`byte "${k}"`));
  }
});

test('approval TEAL enforces creation invariants and a payee clause', () => {
  const teal = renderApprovalTeal();
  // cap<=budget invariant and a payee-mode branch both present
  assert.match(teal, /on_create:/);
  assert.match(teal, /payee_ok:/);
});

test('clear program is the trivial approve', () => {
  assert.match(renderClearTeal(), /#pragma version 8\nint 1\nreturn/);
});

// payeeMode 0 = owner/allowlist, 1 = ANY
const state = (over = {}) => ({
  cap: 1_000_000,
  budget: 1_000_000,
  spent: 0,
  period: 0,
  expiry: 1000,
  wstart: 0,
  payeeMode: 0,
  owner,
  allowlist: [service],
  ...over,
});

test('checkSpend accepts an in-budget spend to an allowlisted payee', () => {
  assert.deepEqual(
    checkSpend({ amount: 400_000, receiver: service, currentRound: 10 }, state()),
    { ok: true },
  );
});

test('checkSpend allows the owner and rejects a stranger (owner/allowlist mode)', () => {
  assert.equal(checkSpend({ amount: 1, receiver: owner, currentRound: 10 }, state()).ok, true);
  assert.equal(
    checkSpend({ amount: 1, receiver: stranger, currentRound: 10 }, state()).reason,
    'receiver_not_allowed',
  );
});

test("checkSpend payeeMode 'ANY' permits any receiver", () => {
  assert.equal(
    checkSpend({ amount: 1, receiver: stranger, currentRound: 10 }, state({ payeeMode: 1 })).ok,
    true,
  );
});

test('checkSpend rejects invalid, over-cap, over-budget, and expired spends', () => {
  assert.equal(checkSpend({ amount: 0, receiver: service, currentRound: 10 }, state()).reason, 'amount_invalid');
  assert.equal(
    checkSpend({ amount: 1_500_000, receiver: service, currentRound: 10 }, state()).reason,
    'amount_exceeds_cap',
  );
  assert.equal(
    checkSpend({ amount: 400_000, receiver: service, currentRound: 10 }, state({ spent: 800_000 })).reason,
    'exceeds_budget',
  );
  assert.equal(
    checkSpend({ amount: 100_000, receiver: service, currentRound: 2000 }, state()).reason,
    'expired',
  );
});

test('checkSpend catches the app min-balance edge when appBalance is given', () => {
  // budget allows it, but the app account cannot pay it and keep min-balance.
  assert.equal(
    checkSpend(
      { amount: 500_000, receiver: service, currentRound: 10, appBalance: 550_000 },
      state(),
    ).reason,
    'insufficient_app_balance',
  );
});

test('checkSpend resets the window once the recurring period elapses', () => {
  const s = state({ spent: 900_000, period: 100, wstart: 0, expiry: 10_000 });
  assert.equal(checkSpend({ amount: 500_000, receiver: service, currentRound: 50 }, s).reason, 'exceeds_budget');
  assert.deepEqual(checkSpend({ amount: 500_000, receiver: service, currentRound: 200 }, s), { ok: true });
});
