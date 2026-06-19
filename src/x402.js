/**
 * x402.js — let an agent pay for what it uses (Open Agent Access + x402).
 *
 * `payAndFetch` performs the agent side of the handshake: call a resource, get
 * `402 Payment Required` with Algorand terms, settle from the mandate-bound
 * agent account, and retry with proof. It is the mirror of the merchant side in
 * `@kirkelabs/conversion-readiness-scan`.
 *
 * The actual settlement is delegated to a `payer(req)` so it is testable
 * offline; `makeAlgorandPayer` provides the real on-chain implementation, which
 * pre-checks the 402 terms against the mandate before paying.
 */

import { checkPayment } from './mandate.js';

/** True for https URLs, or http on localhost/loopback (dev/testing only). */
function isSecureUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:') return true;
    return (
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

export async function payAndFetch(
  url,
  { payer, fetchImpl = fetch, method = 'POST', body, passport, allowInsecure = false } = {},
) {
  // A 402 flow exchanges payment proofs over the wire; require TLS unless the
  // caller is explicitly testing against localhost (or opts in to insecure).
  if (payer && !allowInsecure && !isSecureUrl(url)) {
    throw new Error(
      `payAndFetch refuses a non-https payment endpoint: ${url} (pass allowInsecure to override)`,
    );
  }
  const headers = { 'content-type': 'application/json' };
  const send = (extra) =>
    fetchImpl(url, {
      method,
      headers: { ...headers, ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  // Do NOT disclose the passport (owner/agent addresses, caps, allowlist) on the
  // unpaid probe — only attach it to the paid retry, to the endpoint we're paying.
  const passportHeader = passport
    ? { 'x-agent-passport': Buffer.from(JSON.stringify(passport)).toString('base64') }
    : {};

  const first = await send();
  if (first.status !== 402) {
    if (first.ok) return first.json();
    throw new Error(`Unexpected response: HTTP ${first.status}`);
  }

  const env = await first.json();
  const req = env.accepts && env.accepts[0];
  if (!req) throw new Error('Malformed 402 (no payment requirements)');
  if (typeof payer !== 'function') {
    const e = new Error('Payment required but no payer configured');
    e.paymentRequired = req;
    throw e;
  }

  const txid = await payer(req);
  if (!txid) throw new Error('payer returned no txid');
  const proof = Buffer.from(
    JSON.stringify({ network: req.network, txid, nonce: req.nonce }),
  ).toString('base64');

  const second = await send({ 'x-payment': proof, ...passportHeader });
  if (!second.ok) {
    let reason = `HTTP ${second.status}`;
    try {
      const e = await second.json();
      reason = e.reason || e.error || reason;
    } catch {
      /* ignore */
    }
    throw new Error(`Payment not accepted: ${reason}`);
  }
  return second.json();
}

/**
 * MERCHANT-SIDE proof verification. A bare `{network, txid, nonce}` proof is NOT
 * sufficient on its own — it must be checked against the confirmed on-chain
 * transaction. Fetch that transaction (via your algod/indexer) and pass its
 * decoded fields here; this confirms the payment actually settled to you, for
 * the right amount, on the right chain, bound to your challenge nonce.
 *
 * @param {object} proof   decoded `{network, txid, nonce}` from the x-payment header
 * @param {object} onchain the confirmed txn as seen on-chain:
 *        `{ receiver, amount, note, confirmedRound, genesisHashB64 }`
 * @param {object} expected `{ payTo, minAmount, nonce, network }`
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function verifyPaymentProof(proof, onchain, expected) {
  const p = proof || {};
  const t = onchain || {};
  const e = expected || {};
  if (!p.txid) return { ok: false, reason: 'proof_missing_txid' };
  if (!(Number(t.confirmedRound) > 0)) return { ok: false, reason: 'not_confirmed' };
  if (e.network && p.network !== e.network) return { ok: false, reason: 'network_mismatch' };
  if (String(t.receiver) !== String(e.payTo)) return { ok: false, reason: 'wrong_receiver' };
  if (!(Number(t.amount) >= Number(e.minAmount ?? 0)))
    return { ok: false, reason: 'amount_too_low' };
  // The challenge nonce must match the proof AND the on-chain note (the binding).
  if (e.nonce != null) {
    const note = t.note == null ? '' : String(t.note);
    if (String(p.nonce) !== String(e.nonce) || note !== String(e.nonce))
      return { ok: false, reason: 'nonce_mismatch' };
  }
  return { ok: true };
}

/**
 * Build a payer that settles a 402 from the agent account, refusing anything
 * outside the mandate BEFORE spending. Network (submits a payment).
 */
export function makeAlgorandPayer({ algod, account, mandate }) {
  return async (req) => {
    // Bind the payment to the mandate's network — never settle a 402 that asks
    // to be paid on a different chain than the agent operates on.
    if (req.network && req.network !== mandate.network) {
      throw new Error(
        `Refusing 402: network mismatch (req ${req.network} ≠ mandate ${mandate.network})`,
      );
    }
    // The nonce becomes the on-chain note (≤ 1KB on Algorand); reject anything
    // oversized or non-string before it reaches transaction construction.
    const nonce = req.nonce == null ? undefined : String(req.nonce);
    if (nonce && new TextEncoder().encode(nonce).length > 1024) {
      throw new Error('Refusing 402: nonce too large for transaction note (>1KB)');
    }
    const amount = Number(req.amount);
    // Fast pre-check (amount/receiver/policy). The authoritative check against
    // the real fee, current round, and expiry happens inside account.pay().
    const pre = checkPayment(
      { type: 'pay', amount, receiver: req.payTo, groupSize: 1 },
      mandate,
    );
    if (!pre.ok)
      throw new Error(`Refusing 402: ${pre.reason} (amount ${amount} → ${req.payTo})`);
    const { txid } = await account.pay({
      algod,
      to: req.payTo,
      microAlgos: amount,
      note: nonce, // bind the on-chain payment to the challenge
    });
    return txid;
  };
}
