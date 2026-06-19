import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import { createMandate, assertMandateProgram, GENESIS_HASHES } from '../src/index.js';

const owner = String(algosdk.generateAccount().addr);
const mandate = () =>
  createMandate({ owner, perTxMicroAlgos: 1_000_000, expiryRound: 99, network: 'algorand-testnet' });

const ownerPk = algosdk.decodeAddress(owner).publicKey;
const ghBytes = new Uint8Array(Buffer.from(GENESIS_HASHES['algorand-testnet'], 'base64'));

// Build a synthetic program: version byte + (optionally) owner pubkey + genesis.
function synth({ version = 8, owner = true, genesis = true } = {}) {
  const parts = [Uint8Array.of(version)];
  if (owner) parts.push(ownerPk);
  if (genesis) parts.push(ghBytes);
  const len = parts.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

test('assertMandateProgram accepts a program binding owner + genesis on v8', () => {
  assert.deepEqual(assertMandateProgram(synth(), mandate()), { ok: true });
});

test('assertMandateProgram rejects a non-v8 program', () => {
  assert.equal(assertMandateProgram(synth({ version: 6 }), mandate()).reason, 'not_v8_program');
});

test('assertMandateProgram rejects a program that does not embed the owner', () => {
  assert.equal(
    assertMandateProgram(synth({ owner: false }), mandate()).reason,
    'owner_not_in_program',
  );
});

test('assertMandateProgram rejects a program for the wrong network (genesis absent)', () => {
  assert.equal(
    assertMandateProgram(synth({ genesis: false }), mandate()).reason,
    'genesis_not_in_program',
  );
});
