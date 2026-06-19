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

import algosdk from 'algosdk';
import { checkPayment } from './mandate.js';
import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_000_000; // cap on a 402/result body we will buffer

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

/** Private / loopback / link-local / ULA / metadata ranges that must not be reachable. */
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  if (v === 6) {
    const ipl = ip.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      ipl === '::1' ||
      ipl === '::' ||
      ipl.startsWith('fe80') || // link-local
      ipl.startsWith('fc') ||
      ipl.startsWith('fd') || // ULA
      ipl.startsWith('::ffff:') // IPv4-mapped (re-checked below)
    );
  }
  return false;
}

/**
 * SSRF guard: scheme check + block requests to private/loopback/link-local/
 * metadata addresses, and (when given) restrict to an explicit host allowlist.
 * For hostnames we resolve and reject if ANY resolved address is private
 * (best-effort; not DNS-rebinding-proof — use `allowedHosts` for untrusted brains).
 */
async function assertSafeUrl(url, { allowInsecure, allowedHosts } = {}) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`payAndFetch: invalid URL: ${url}`);
  }
  if (!allowInsecure && !isSecureUrl(url))
    throw new Error(`payAndFetch refuses a non-https endpoint: ${url} (pass allowInsecure to override)`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
    if (!allowedHosts.includes(u.hostname) && !allowedHosts.includes(host))
      throw new Error(`payAndFetch: host not in allowedHosts: ${u.hostname}`);
    return; // explicit allowlist is authoritative
  }
  // Loopback/private/metadata are reachable ONLY with an explicit allowInsecure
  // (local testing) — never for a default, untrusted-brain-driven payment.
  if (net.isIP(host)) {
    const mapped = host.toLowerCase().startsWith('::ffff:') ? host.slice(7) : host;
    if ((isPrivateIp(host) || isPrivateIp(mapped)) && !allowInsecure)
      throw new Error(`payAndFetch refuses a private/loopback address: ${host}`);
    return;
  }
  if (host === 'localhost') {
    if (!allowInsecure)
      throw new Error('payAndFetch refuses localhost (pass allowInsecure for local testing)');
    return;
  }
  // Hostname: resolve and reject if it points anywhere internal.
  let addrs = [];
  try {
    addrs = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new Error(`payAndFetch: could not resolve host: ${host}`);
  }
  for (const a of addrs) {
    const mapped = a.toLowerCase().startsWith('::ffff:') ? a.slice(7) : a;
    if ((isPrivateIp(a) || isPrivateIp(mapped)) && !allowInsecure)
      throw new Error(`payAndFetch refuses a host resolving to a private address: ${host} -> ${a}`);
  }
}

/** Read a response body with a hard size cap, then JSON-parse it. */
async function readJsonCapped(res, maxBytes) {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes)
    throw new Error(`response too large (${len} > ${maxBytes} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`response too large (> ${maxBytes} bytes)`);
  return JSON.parse(buf.toString('utf8'));
}

export async function payAndFetch(
  url,
  {
    payer,
    fetchImpl = fetch,
    method = 'POST',
    body,
    passport,
    allowInsecure = false,
    allowedHosts,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxAmountMicroAlgos,
    confirm,
  } = {},
) {
  // SSRF + TLS guard before any request leaves the process.
  await assertSafeUrl(url, { allowInsecure, allowedHosts });

  const headers = { 'content-type': 'application/json' };
  const send = (extra) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    return Promise.resolve(
      fetchImpl(url, {
        method,
        headers: { ...headers, ...extra },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error', // never follow redirects (would leak proof/passport, enable SSRF)
        signal: ac.signal,
      }),
    ).finally(() => clearTimeout(timer));
  };

  // Do NOT disclose the passport (owner/agent addresses, caps, allowlist) on the
  // unpaid probe — only attach it to the paid retry, to the endpoint we're paying.
  const passportHeader = passport
    ? { 'x-agent-passport': Buffer.from(JSON.stringify(passport)).toString('base64') }
    : {};

  const first = await send();
  if (first.status !== 402) {
    if (first.ok) return readJsonCapped(first, maxBytes);
    throw new Error(`Unexpected response: HTTP ${first.status}`);
  }

  const env = await readJsonCapped(first, maxBytes);
  // Choose the cheapest acceptable term (a hostile merchant could order accepts[]
  // worst-first); ignore terms on the wrong network or above the optional ceiling.
  const candidates = (Array.isArray(env.accepts) ? env.accepts : [])
    .filter((r) => r && r.payTo != null && Number.isFinite(Number(r.amount)))
    .filter((r) => maxAmountMicroAlgos == null || Number(r.amount) <= Number(maxAmountMicroAlgos))
    .sort((a, b) => Number(a.amount) - Number(b.amount));
  const req = candidates[0];
  if (!req) throw new Error('Malformed 402 (no acceptable payment requirements)');
  if (typeof payer !== 'function') {
    const e = new Error('Payment required but no payer configured');
    e.paymentRequired = req;
    throw e;
  }

  // Optional human-in-the-loop / policy gate. Invoked with the selected payment
  // terms BEFORE any funds move; returning false (or throwing) aborts. Strongly
  // recommended under `allowlist:'ANY'` or with an untrusted brain.
  if (typeof confirm === 'function') {
    const ok = await confirm({
      url,
      payTo: req.payTo,
      amount: Number(req.amount),
      network: req.network,
    });
    if (!ok) throw new Error('Payment aborted: not confirmed by confirm() hook');
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
      const e = await readJsonCapped(second, maxBytes);
      // Merchant-controlled text — keep it short and single-line to avoid log injection.
      reason = String(e.reason || e.error || reason).replace(/[\r\n]+/g, ' ').slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`Payment not accepted: ${reason}`);
  }
  return readJsonCapped(second, maxBytes);
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
    if (!algosdk.isValidAddress(String(req.payTo)))
      throw new Error(`Refusing 402: invalid payTo address (${req.payTo})`);
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
