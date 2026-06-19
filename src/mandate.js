/**
 * mandate.js — an agent's spending authority, enforced ON-CHAIN by a LogicSig
 * (see logicsig.js) and mirrored here as a pure JS validator so the SDK can
 * pre-check any transaction before it is ever submitted.
 *
 * A mandate is deliberately narrow. An agent funded under a mandate can ONLY:
 *   - send `pay` transactions (no asset/app/key-reg/rekey games),
 *   - up to `perTxMicroAlgos` per transaction,
 *   - to an address on `allowlist` (or back to the owner) — and with an EMPTY
 *     allowlist, ONLY back to the owner (safe by default),
 *   - with fee ≤ `maxFee`,
 *   - before `expiryRound`,
 *   - in a single (non-grouped) transaction,
 *   - never rekeying, and only ever closing remainder back to the owner.
 *
 * `allowlist: 'ANY'` is an explicit, deliberately loud opt-in that removes the
 * payee restriction entirely — the agent account becomes a PERMISSIONLESS
 * spend account (anyone holding the LogicSig program can direct ≤cap payments
 * to any address). Only use it when you understand that property.
 *
 * The aggregate budget is simply how much the owner funds the agent account
 * with: you can never lose more than you funded, and leftovers return to you.
 */

import algosdk from 'algosdk';

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let warnedAnyPayee = false;

export function createMandate({
  owner,
  perTxMicroAlgos,
  allowlist = [],
  expiryRound,
  maxFee = 2000,
  network = 'algorand-testnet',
}) {
  if (!isAddr(owner)) throw new Error('mandate.owner must be a valid Algorand address');
  const cap = Number(perTxMicroAlgos);
  if (!Number.isInteger(cap) || cap <= 0) {
    throw new Error('mandate.perTxMicroAlgos must be a positive integer (microAlgos)');
  }
  if (!Number.isInteger(Number(expiryRound)) || Number(expiryRound) <= 0) {
    throw new Error('mandate.expiryRound must be a positive integer (a future round)');
  }
  if (!['algorand', 'algorand-testnet'].includes(network)) {
    throw new Error("mandate.network must be 'algorand' or 'algorand-testnet'");
  }

  // Payee policy. Default ([]) = owner-only (safe). An explicit 'ANY' opt-in
  // removes the payee restriction and makes the account permissionless.
  const anyPayee = allowlist === 'ANY';
  const payees = anyPayee ? [] : allowlist;
  if (!anyPayee && !Array.isArray(payees)) {
    throw new Error("mandate.allowlist must be an array of addresses or the string 'ANY'");
  }
  for (const a of payees) {
    if (!isAddr(a))
      throw new Error(`mandate.allowlist contains an invalid address: ${a}`);
  }
  if (anyPayee && !warnedAnyPayee) {
    warnedAnyPayee = true;
    console.warn(
      "⚠ oaa-agent-kit: allowlist:'ANY' creates a PERMISSIONLESS spend account — " +
        'any address may receive ≤cap payments from it. Prefer an explicit payee list.',
    );
  }

  return Object.freeze({
    owner: String(owner),
    perTxMicroAlgos: cap,
    allowlist: Object.freeze(payees.map(String)),
    anyPayee,
    expiryRound: Number(expiryRound),
    maxFee: Number(maxFee),
    network,
  });
}

/**
 * Validate a proposed payment against the mandate. Mirrors the TEAL exactly.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkPayment(txn, mandate, currentRound) {
  const t = txn || {};
  const type = t.type || 'pay';
  if (type !== 'pay') return fail('type_not_pay');

  // Single, non-grouped transaction only (mirrors `global GroupSize == 1`).
  if (t.groupSize != null && Number(t.groupSize) !== 1) return fail('grouped_txn_forbidden');

  const amount = Number(t.amount ?? 0);
  if (!Number.isInteger(amount) || amount < 0) return fail('amount_invalid');
  if (amount > mandate.perTxMicroAlgos) return fail('amount_exceeds_per_tx_cap');

  const fee = Number(t.fee ?? 0);
  if (fee > mandate.maxFee) return fail('fee_exceeds_max');

  const receiver = norm(t.receiver);
  if (!receiver) return fail('receiver_missing');
  // Payee policy: 'ANY' permits any receiver; otherwise the receiver must be
  // the owner or on the allowlist. An EMPTY allowlist therefore means
  // owner-only — funds can never be redirected to a stranger.
  const allowed =
    mandate.anyPayee ||
    receiver === mandate.owner ||
    mandate.allowlist.includes(receiver);
  if (!allowed) return fail('receiver_not_allowlisted');

  if (t.rekeyTo && norm(t.rekeyTo) !== ZERO_ADDR) return fail('rekey_forbidden');

  const close = norm(t.closeRemainderTo);
  if (close && close !== ZERO_ADDR && close !== mandate.owner)
    return fail('close_to_non_owner');

  if (t.lastValid != null && Number(t.lastValid) > mandate.expiryRound) {
    return fail('lastValid_after_expiry');
  }
  if (currentRound != null && Number(currentRound) > mandate.expiryRound) {
    return fail('mandate_expired');
  }
  return { ok: true };
}

export function remainingBudget(mandate, accountMicroAlgos) {
  // Aggregate budget == funded balance, minus the 0.1 ALGO min-balance.
  return Math.max(0, Number(accountMicroAlgos) - 100_000);
}

function isAddr(a) {
  try {
    return algosdk.isValidAddress(String(a));
  } catch {
    return false;
  }
}
function norm(a) {
  return a == null ? '' : String(a);
}
function fail(reason) {
  return { ok: false, reason };
}

export { ZERO_ADDR };
