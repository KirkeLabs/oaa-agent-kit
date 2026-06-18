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

export async function payAndFetch(
  url,
  { payer, fetchImpl = fetch, method = 'POST', body, passport } = {},
) {
  const headers = { 'content-type': 'application/json' };
  if (passport)
    headers['x-agent-passport'] = Buffer.from(JSON.stringify(passport)).toString(
      'base64',
    );
  const send = (extra) =>
    fetchImpl(url, {
      method,
      headers: { ...headers, ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

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

  const second = await send({ 'x-payment': proof });
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
 * Build a payer that settles a 402 from the agent account, refusing anything
 * outside the mandate BEFORE spending. Network (submits a payment).
 */
export function makeAlgorandPayer({ algod, account, mandate }) {
  return async (req) => {
    const amount = Number(req.amount);
    const pre = checkPayment(
      { type: 'pay', amount, receiver: req.payTo, fee: mandate.maxFee },
      mandate,
    );
    if (!pre.ok)
      throw new Error(`Refusing 402: ${pre.reason} (amount ${amount} → ${req.payTo})`);
    const { txid } = await account.pay({
      algod,
      to: req.payTo,
      microAlgos: amount,
      note: req.nonce, // bind the on-chain payment to the challenge
    });
    return txid;
  };
}
