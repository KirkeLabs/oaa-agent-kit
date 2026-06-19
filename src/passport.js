/**
 * passport.js — OAA agent identity & activation.
 *
 * An agent passport is a signed statement: "I, the owner, authorize this agent
 * account to act on my behalf under this mandate, until this expiry." The
 * owner's signature is what *activates* the agent — and that signer can be a
 * Pera Wallet (see peraConnector.js). OAA-guarded services that set
 * `requireAgentIdentity` can ask for and verify this passport.
 */

import algosdk from 'algosdk';
import { mandateAddress } from './logicsig.js';

export const PASSPORT_SCHEMA = 'https://openagentaccess.org/schema/agent-passport/v1';

/**
 * Build a passport. Prefer passing the `account` (an AgentAccount) so the
 * `agentAddress` and `mandate` are guaranteed to belong together; passing them
 * separately is supported but the caller is then responsible for consistency
 * (use `verifyPassportAddress` to check it on-chain).
 */
export function buildPassport({
  account,
  agentAddress = account?.address,
  owner,
  mandate = account?.mandate,
  purpose = 'general',
  issuedAt = Date.now(),
  expiresAt,
}) {
  if (!mandate) throw new Error('buildPassport requires a mandate (or an account)');
  if (!algosdk.isValidAddress(String(agentAddress)))
    throw new Error('agentAddress is invalid');
  if (!algosdk.isValidAddress(String(owner))) throw new Error('owner is invalid');
  if (String(owner) !== String(mandate.owner))
    throw new Error('passport owner does not match mandate.owner');
  const exp = expiresAt ?? issuedAt + 24 * 60 * 60 * 1000;
  return {
    schema: PASSPORT_SCHEMA,
    agentAddress: String(agentAddress),
    owner: String(owner),
    purpose,
    issuedAt,
    expiresAt: exp,
    mandate: {
      owner: mandate.owner,
      perTxMicroAlgos: mandate.perTxMicroAlgos,
      allowlist: [...mandate.allowlist],
      anyPayee: !!mandate.anyPayee,
      expiryRound: mandate.expiryRound,
      maxFee: mandate.maxFee,
      network: mandate.network,
    },
  };
}

/**
 * On-chain binding check for relying parties: recompute the LogicSig address
 * from the passport's mandate and confirm it equals `passport.agentAddress`.
 * Async (needs algod to compile). Use alongside `verifyPassport` when you must
 * trust that the stated address truly corresponds to the stated mandate.
 */
export async function verifyPassportAddress(signed, algod) {
  try {
    const { passport } = signed || {};
    if (!passport?.mandate || !passport?.agentAddress)
      return { ok: false, reason: 'missing_fields' };
    const derived = String(await mandateAddress(algod, passport.mandate));
    return derived === String(passport.agentAddress)
      ? { ok: true }
      : { ok: false, reason: 'address_mandate_mismatch' };
  } catch (e) {
    return { ok: false, reason: `verify_error:${e.message}` };
  }
}

/** Deterministic bytes for signing/verifying (stable, sorted-key JSON). */
export function passportBytes(passport) {
  return new TextEncoder().encode(canonical(passport));
}

/**
 * Sign a passport with the owner. `ownerSigner` = { address, signBytes(bytes) }.
 * LocalOwnerSigner (dev) and PeraConnector (Pera Wallet) both implement it.
 */
export async function signPassport(passport, ownerSigner) {
  if (String(ownerSigner.address) !== passport.owner) {
    throw new Error('ownerSigner.address does not match passport.owner');
  }
  const sig = await ownerSigner.signBytes(passportBytes(passport));
  return { passport, signer: passport.owner, signature: toB64(sig) };
}

/** Verify a signed passport: owner signature valid and not expired. */
export function verifyPassport(signed, { now = Date.now() } = {}) {
  try {
    const { passport, signature, signer } = signed || {};
    if (!passport || !signature) return { ok: false, reason: 'missing_fields' };
    if (signer !== passport.owner) return { ok: false, reason: 'signer_owner_mismatch' };
    if (now > passport.expiresAt) return { ok: false, reason: 'passport_expired' };
    const ok = algosdk.verifyBytes(
      passportBytes(passport),
      fromB64(signature),
      passport.owner,
    );
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch (e) {
    return { ok: false, reason: `verify_error:${e.message}` };
  }
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
function toB64(u8) {
  return Buffer.from(u8).toString('base64');
}
function fromB64(s) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}
