import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import {
  createMandate,
  buildPassport,
  signPassport,
  verifyPassport,
  peraSignDataPayload,
  PeraConnector,
  LocalOwnerSigner,
} from '../src/index.js';

test('peraSignDataPayload passes RAW bytes (not a base64 string) to signData', () => {
  const bytes = new TextEncoder().encode('{"a":1}');
  const payload = peraSignDataPayload(bytes);
  assert.equal(Array.isArray(payload), true);
  const { data, message } = payload[0];
  // Must be raw bytes — a base64 string here is the bug that breaks verification.
  assert.equal(typeof data, 'object');
  assert.equal(Buffer.isBuffer(data) || data instanceof Uint8Array, true);
  assert.deepEqual(new Uint8Array(data), bytes);
  assert.equal(typeof message, 'string');
});

// Regression guard for the double-encoding bug: a passport signed through the
// Pera path (signData over the raw bytes, as Pera actually does) MUST verify
// under verifyPassport/algosdk.verifyBytes. With the old base64-string payload
// this round-trip fails.
test('Pera-signed passport verifies (signData over raw bytes round-trips)', async () => {
  const key = LocalOwnerSigner.random(); // stands in for the key inside Pera
  // Fake @perawallet/connect client: signs the provided RAW data bytes the same
  // way algosdk.signBytes does (which is what Pera does under the hood).
  let receivedData = null;
  const fakeClient = {
    connect: async () => [key.address],
    signData: async (payload, signer) => {
      assert.equal(signer, key.address);
      receivedData = payload[0].data;
      const sig = await key.signBytes(new Uint8Array(payload[0].data));
      return [sig];
    },
  };

  const pera = new PeraConnector({ _client: fakeClient });
  await pera.connect();
  assert.equal(pera.address, key.address);

  const mandate = createMandate({
    owner: pera.address,
    perTxMicroAlgos: 1_000_000,
    expiryRound: 9999,
    network: 'algorand-testnet',
  });
  const agentAddress = String(algosdk.generateAccount().addr);
  const passport = buildPassport({ agentAddress, owner: pera.address, mandate });

  const signed = await signPassport(passport, pera);
  // signData received raw bytes, not a base64 string.
  assert.equal(Buffer.isBuffer(receivedData) || receivedData instanceof Uint8Array, true);
  assert.equal(verifyPassport(signed).ok, true);
});
