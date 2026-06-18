import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import { createMandate, renderMandateTeal } from '../src/index.js';

const owner = String(algosdk.generateAccount().addr);
const payee = String(algosdk.generateAccount().addr);

test('TEAL encodes the mandate constraints', () => {
  const m = createMandate({
    owner,
    perTxMicroAlgos: 1_234_567,
    allowlist: [payee],
    expiryRound: 42_000,
    maxFee: 2000,
    network: 'algorand-testnet',
  });
  const teal = renderMandateTeal(m);
  assert.match(teal, /#pragma version 8/);
  assert.match(teal, /int pay/);
  assert.match(teal, /int 1234567/); // per-tx cap
  assert.match(teal, /int 42000/); // expiry
  assert.match(teal, /int 2000/); // max fee
  assert.match(teal, new RegExp(`addr ${owner}`)); // owner (close + receiver)
  assert.match(teal, new RegExp(`addr ${payee}`)); // allowlisted payee
  assert.match(teal, /txn RekeyTo\nglobal ZeroAddress\n==/); // rekey guard
  assert.match(teal, /txn CloseRemainderTo/); // close guard
  assert.match(teal, /\|\|/); // allowlist OR chain / close OR owner
});

test('empty allowlist omits the receiver constraint', () => {
  const m = createMandate({
    owner,
    perTxMicroAlgos: 10,
    expiryRound: 10,
    network: 'algorand-testnet',
  });
  const teal = renderMandateTeal(m);
  assert.doesNotMatch(teal, /txn Receiver/);
});

test('TEAL is deterministic for a given mandate', () => {
  const m = createMandate({
    owner,
    perTxMicroAlgos: 5,
    expiryRound: 5,
    network: 'algorand-testnet',
  });
  assert.equal(renderMandateTeal(m), renderMandateTeal(m));
});
