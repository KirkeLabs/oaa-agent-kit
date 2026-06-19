import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import {
  createMandate,
  buildPassport,
  signPassport,
  verifyPassport,
  LocalOwnerSigner,
} from '../src/index.js';

function setup() {
  const owner = LocalOwnerSigner.random();
  const agentAddress = String(algosdk.generateAccount().addr);
  const mandate = createMandate({
    owner: owner.address,
    perTxMicroAlgos: 1_000_000,
    expiryRound: 9999,
    network: 'algorand-testnet',
  });
  const passport = buildPassport({ agentAddress, owner: owner.address, mandate });
  return { owner, agentAddress, mandate, passport };
}

test('owner can sign and the passport verifies', async () => {
  const { owner, passport } = setup();
  const signed = await signPassport(passport, owner);
  assert.equal(verifyPassport(signed).ok, true);
});

test('tampering with the mandate breaks the signature', async () => {
  const { owner, passport } = setup();
  const signed = await signPassport(passport, owner);
  signed.passport.mandate.perTxMicroAlgos = 999_999_999; // try to widen authority
  assert.equal(verifyPassport(signed).reason, 'bad_signature');
});

test('a different signer is rejected', async () => {
  const { passport } = setup();
  const attacker = LocalOwnerSigner.random();
  await assert.rejects(() => signPassport(passport, attacker)); // address mismatch guard
});

test('expired passports are rejected', async () => {
  const { owner, agentAddress, mandate } = setup();
  const passport = buildPassport({
    agentAddress,
    owner: owner.address,
    mandate,
    issuedAt: 1,
    expiresAt: 2,
  });
  const signed = await signPassport(passport, owner);
  assert.equal(verifyPassport(signed, { now: 1000 }).reason, 'passport_expired');
});

test('signBytes/verifyBytes round-trip via algosdk', async () => {
  const owner = LocalOwnerSigner.random();
  const msg = new TextEncoder().encode('hello agent');
  const sig = await owner.signBytes(msg);
  assert.equal(algosdk.verifyBytes(msg, sig, owner.address), true);
});

test('buildPassport rejects an owner that does not match the mandate', () => {
  const { agentAddress, mandate } = setup();
  const otherOwner = String(algosdk.generateAccount().addr);
  assert.throws(
    () => buildPassport({ agentAddress, owner: otherOwner, mandate }),
    /owner does not match mandate/,
  );
});

test('buildPassport derives address+mandate from an account (consistent)', async () => {
  const { owner, agentAddress, mandate } = setup();
  // Minimal AgentAccount-shaped object: { address, mandate }.
  const account = { address: agentAddress, mandate };
  const passport = buildPassport({ account, owner: owner.address });
  assert.equal(passport.agentAddress, agentAddress);
  assert.equal(passport.mandate.owner, owner.address);
  assert.equal(passport.mandate.anyPayee, false);
  const signed = await signPassport(passport, owner);
  assert.equal(verifyPassport(signed).ok, true);
});
