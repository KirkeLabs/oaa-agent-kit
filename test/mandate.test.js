import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import { createMandate, checkPayment } from '../src/index.js';

const owner = String(algosdk.generateAccount().addr);
const payee = String(algosdk.generateAccount().addr);
const stranger = String(algosdk.generateAccount().addr);

const base = () =>
  createMandate({
    owner,
    perTxMicroAlgos: 1_000_000,
    allowlist: [payee],
    expiryRound: 1000,
    maxFee: 2000,
    network: 'algorand-testnet',
  });

test('createMandate validates inputs', () => {
  assert.throws(() =>
    createMandate({ owner: 'nope', perTxMicroAlgos: 1, expiryRound: 1 }),
  );
  assert.throws(() => createMandate({ owner, perTxMicroAlgos: 0, expiryRound: 1 }));
  assert.throws(() => createMandate({ owner, perTxMicroAlgos: 1, expiryRound: 0 }));
  assert.throws(() =>
    createMandate({ owner, perTxMicroAlgos: 1, expiryRound: 1, allowlist: ['bad'] }),
  );
});

test('accepts an in-mandate payment to an allowlisted payee', () => {
  const r = checkPayment(
    { amount: 500_000, fee: 1000, receiver: payee, lastValid: 500 },
    base(),
    400,
  );
  assert.equal(r.ok, true);
});

test('always allows returning funds to the owner', () => {
  const r = checkPayment(
    { amount: 999_999, fee: 1000, receiver: owner, lastValid: 500 },
    base(),
  );
  assert.equal(r.ok, true);
});

test('rejects over the per-tx cap', () => {
  const r = checkPayment({ amount: 1_000_001, receiver: payee }, base());
  assert.deepEqual(r, { ok: false, reason: 'amount_exceeds_per_tx_cap' });
});

test('rejects a non-allowlisted payee', () => {
  const r = checkPayment({ amount: 1, receiver: stranger }, base());
  assert.equal(r.reason, 'receiver_not_allowlisted');
});

test('rejects rekey, hostile close, expiry, fee, and non-pay', () => {
  assert.equal(
    checkPayment({ amount: 1, receiver: payee, rekeyTo: stranger }, base()).reason,
    'rekey_forbidden',
  );
  assert.equal(
    checkPayment({ amount: 1, receiver: payee, closeRemainderTo: stranger }, base())
      .reason,
    'close_to_non_owner',
  );
  assert.equal(
    checkPayment({ amount: 1, receiver: payee, lastValid: 2000 }, base()).reason,
    'lastValid_after_expiry',
  );
  assert.equal(
    checkPayment({ amount: 1, receiver: payee, fee: 5000 }, base()).reason,
    'fee_exceeds_max',
  );
  assert.equal(
    checkPayment({ type: 'axfer', amount: 1, receiver: payee }, base()).reason,
    'type_not_pay',
  );
  assert.equal(
    checkPayment({ amount: 1, receiver: payee }, base(), 2000).reason,
    'mandate_expired',
  );
});

test('empty allowlist is OWNER-ONLY (rejects a stranger)', () => {
  const m = createMandate({
    owner,
    perTxMicroAlgos: 10,
    expiryRound: 10,
    network: 'algorand-testnet',
  });
  assert.equal(m.anyPayee, false);
  assert.equal(checkPayment({ amount: 5, receiver: owner }, m).ok, true);
  assert.equal(
    checkPayment({ amount: 5, receiver: stranger }, m).reason,
    'receiver_not_allowlisted',
  );
});

test("allowlist:'ANY' permits any receiver (explicit opt-in)", () => {
  const m = createMandate({
    owner,
    perTxMicroAlgos: 10,
    allowlist: 'ANY',
    expiryRound: 10,
    network: 'algorand-testnet',
  });
  assert.equal(m.anyPayee, true);
  assert.equal(checkPayment({ amount: 5, receiver: stranger }, m).ok, true);
});

test('rejects a grouped transaction', () => {
  const r = checkPayment({ amount: 1, receiver: payee, groupSize: 2 }, base());
  assert.equal(r.reason, 'grouped_txn_forbidden');
});

test('rejects unsafe (> 2^53-1) uint64 mandate values', () => {
  assert.throws(
    () => createMandate({ owner, perTxMicroAlgos: 2 ** 53 + 2, expiryRound: 10 }),
    /safe-integer/,
  );
});

test('rejects a non-integer fee', () => {
  const r = checkPayment({ amount: 1, receiver: payee, fee: 'abc' }, base());
  assert.equal(r.reason, 'fee_invalid');
});

test('rejects a genesis-hash mismatch (wrong network)', () => {
  const r = checkPayment(
    { amount: 1, receiver: payee, genesisHash: 'not-the-testnet-hash' },
    base(),
  );
  assert.equal(r.reason, 'genesis_hash_mismatch');
});

test('closing remainder back to owner is allowed', () => {
  const r = checkPayment({ amount: 1, receiver: payee, closeRemainderTo: owner }, base());
  assert.equal(r.ok, true);
});
