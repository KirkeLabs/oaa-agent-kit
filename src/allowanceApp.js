/**
 * allowanceApp.js — EXPERIMENTAL stateful aggregate-budget contract.
 *
 * The stateless LogicSig mandate (see logicsig.js) bounds a SINGLE transaction.
 * It cannot enforce a cumulative or recurring budget, because a stateless
 * program has no memory. This Algorand **Application** does: it holds the budget
 * in its own app account and disburses payments via inner transactions, keeping
 * an on-chain `spent` counter so that aggregate (and optionally per-window)
 * limits are enforced by CONSENSUS — not by trusting the SDK.
 *
 * Payee policy mirrors the stateless mandate: by default the agent can ONLY pay
 * the owner; pass an allowlist of payees, or `payees: 'ANY'` to remove the
 * destination restriction (permissionless — same loud caveat as the mandate).
 *
 * Model:
 *   - The OWNER creates the app (agent address, per-tx cap, total budget,
 *     optional recurring period in rounds, expiry, payee policy) and funds the
 *     app account with the budget.
 *   - The AGENT (its own keypair, holding a little ALGO for fees) calls
 *     `spend(amount, receiver)`. The app checks sender==agent, receiver allowed,
 *     amount<=cap, round<=expiry, and (after resetting the window if the period
 *     elapsed) spent+amount<=budget, then inner-pays and increments spent.
 *   - The OWNER can rotate the agent (`setAgent`), `reclaim` the remaining
 *     balance (which re-arms the counter), and delete the app once empty.
 *
 * ⚠ EXPERIMENTAL & UNAUDITED. Stateful contracts are a large attack surface.
 * Do not hold material value on MainNet without an independent audit. The
 * stateless LogicSig mandate remains the default, simpler primitive.
 */

import algosdk from 'algosdk';

const MAX_UINT53 = Number.MAX_SAFE_INTEGER;
const MIN_BALANCE = 100_000; // app-account min balance (microAlgos)
const MAX_ALLOWLIST = 4; // fixed allowlist slots (l0..l3), unused = owner

// Global state keys (kept short; all fit in the declared global schema).
export const KEYS = Object.freeze({
  owner: 'o',
  agent: 'a',
  cap: 'c',
  budget: 'b',
  spent: 's',
  period: 'p',
  expiry: 'e',
  wstart: 'w',
  payeeMode: 'pm', // 0 = owner/allowlist, 1 = ANY
  l0: 'l0',
  l1: 'l1',
  l2: 'l2',
  l3: 'l3',
});

/** Approval program TEAL (AVM v8). Deterministic; review before use. */
export function renderApprovalTeal() {
  const K = KEYS;
  return `#pragma version 8
// oaa-agent-kit AllowanceApp — auto-generated. EXPERIMENTAL. Review before use.

// ---- creation: ApplicationID == 0 ----
txn ApplicationID
int 0
==
bnz on_create

// ---- block UpdateApplication outright ----
txn OnCompletion
int UpdateApplication
==
bnz reject

// ---- DeleteApplication: owner only, and only when the app account is empty ----
txn OnCompletion
int DeleteApplication
==
bnz on_delete

// ---- only NoOp calls past this point ----
txn OnCompletion
int NoOp
==
assert

// ---- route by method (ApplicationArgs[0]) ----
txna ApplicationArgs 0
byte "spend"
==
bnz on_spend
txna ApplicationArgs 0
byte "reclaim"
==
bnz on_reclaim
txna ApplicationArgs 0
byte "setagent"
==
bnz on_setagent
b reject

// =====================================================================
on_create:
  // invariants: cap>0, budget>0, cap<=budget, expiry>Round, period<=expiry
  txna ApplicationArgs 1
  btoi
  int 0
  >
  assert
  txna ApplicationArgs 2
  btoi
  int 0
  >
  assert
  txna ApplicationArgs 1
  btoi
  txna ApplicationArgs 2
  btoi
  <=
  assert
  txna ApplicationArgs 4
  btoi
  global Round
  >
  assert
  txna ApplicationArgs 3
  btoi
  txna ApplicationArgs 4
  btoi
  <=
  assert
  // store state
  byte "${K.owner}"
  txn Sender
  app_global_put
  byte "${K.agent}"
  txna ApplicationArgs 0
  app_global_put
  byte "${K.cap}"
  txna ApplicationArgs 1
  btoi
  app_global_put
  byte "${K.budget}"
  txna ApplicationArgs 2
  btoi
  app_global_put
  byte "${K.period}"
  txna ApplicationArgs 3
  btoi
  app_global_put
  byte "${K.expiry}"
  txna ApplicationArgs 4
  btoi
  app_global_put
  byte "${K.payeeMode}"
  txna ApplicationArgs 5
  btoi
  app_global_put
  byte "${K.l0}"
  txna ApplicationArgs 6
  app_global_put
  byte "${K.l1}"
  txna ApplicationArgs 7
  app_global_put
  byte "${K.l2}"
  txna ApplicationArgs 8
  app_global_put
  byte "${K.l3}"
  txna ApplicationArgs 9
  app_global_put
  byte "${K.spent}"
  int 0
  app_global_put
  byte "${K.wstart}"
  global Round
  app_global_put
  int 1
  return

// =====================================================================
on_spend:
  // sender must be the agent
  txn Sender
  byte "${K.agent}"
  app_global_get
  ==
  assert

  // not past expiry
  global Round
  byte "${K.expiry}"
  app_global_get
  <=
  assert

  // window reset: if period>0 and Round >= wstart+period -> spent=0, wstart=Round
  byte "${K.period}"
  app_global_get
  int 0
  >
  bz skip_reset
  global Round
  byte "${K.wstart}"
  app_global_get
  byte "${K.period}"
  app_global_get
  +
  >=
  bz skip_reset
  byte "${K.spent}"
  int 0
  app_global_put
  byte "${K.wstart}"
  global Round
  app_global_put
  skip_reset:

  // payee policy: ANY mode skips; else receiver ∈ {owner} ∪ allowlist
  byte "${K.payeeMode}"
  app_global_get
  int 1
  ==
  bnz payee_ok
  txna ApplicationArgs 2
  byte "${K.owner}"
  app_global_get
  ==
  txna ApplicationArgs 2
  byte "${K.l0}"
  app_global_get
  ==
  ||
  txna ApplicationArgs 2
  byte "${K.l1}"
  app_global_get
  ==
  ||
  txna ApplicationArgs 2
  byte "${K.l2}"
  app_global_get
  ==
  ||
  txna ApplicationArgs 2
  byte "${K.l3}"
  app_global_get
  ==
  ||
  assert
  payee_ok:

  // amount = btoi(args[1]); amount <= cap
  txna ApplicationArgs 1
  btoi
  store 0
  load 0
  byte "${K.cap}"
  app_global_get
  <=
  assert

  // spent + amount <= budget
  byte "${K.spent}"
  app_global_get
  load 0
  +
  store 1
  load 1
  byte "${K.budget}"
  app_global_get
  <=
  assert

  // inner payment: app account -> receiver(args[2]) amount, fee pooled (0)
  itxn_begin
  int pay
  itxn_field TypeEnum
  txna ApplicationArgs 2
  itxn_field Receiver
  load 0
  itxn_field Amount
  int 0
  itxn_field Fee
  itxn_submit

  // persist new spent
  byte "${K.spent}"
  load 1
  app_global_put
  int 1
  return

// =====================================================================
on_reclaim:
  // owner only; close the app account back to owner, then re-arm the counter
  txn Sender
  byte "${K.owner}"
  app_global_get
  ==
  assert
  itxn_begin
  int pay
  itxn_field TypeEnum
  byte "${K.owner}"
  app_global_get
  itxn_field Receiver
  int 0
  itxn_field Amount
  byte "${K.owner}"
  app_global_get
  itxn_field CloseRemainderTo
  int 0
  itxn_field Fee
  itxn_submit
  byte "${K.spent}"
  int 0
  app_global_put
  byte "${K.wstart}"
  global Round
  app_global_put
  int 1
  return

// =====================================================================
on_setagent:
  // owner only; rotate the authorised agent
  txn Sender
  byte "${K.owner}"
  app_global_get
  ==
  assert
  byte "${K.agent}"
  txna ApplicationArgs 1
  app_global_put
  int 1
  return

// =====================================================================
on_delete:
  // owner only, and refuse while the app account still holds funds
  txn Sender
  byte "${K.owner}"
  app_global_get
  ==
  assert
  global CurrentApplicationAddress
  balance
  int ${MIN_BALANCE}
  <=
  assert
  int 1
  return

// =====================================================================
reject:
  int 0
  return
`;
}

/** Clear-state program (no local state used; always approve). */
export function renderClearTeal() {
  return `#pragma version 8
int 1
return
`;
}

const enc = (s) => new TextEncoder().encode(s);
const u64 = (n) => algosdk.encodeUint64(Number(n));
const pk = (addr) => algosdk.decodeAddress(String(addr)).publicKey;

async function compilePrograms(algod) {
  const a = await algod.compile(renderApprovalTeal()).do();
  const c = await algod.compile(renderClearTeal()).do();
  return {
    approval: new Uint8Array(Buffer.from(a.result, 'base64')),
    clear: new Uint8Array(Buffer.from(c.result, 'base64')),
  };
}

function validateCreateParams({ capMicroAlgos, budgetMicroAlgos, periodRounds, expiryRound }) {
  const ints = { capMicroAlgos, budgetMicroAlgos, periodRounds, expiryRound };
  for (const [k, v] of Object.entries(ints)) {
    if (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > MAX_UINT53)
      throw new Error(`${k} must be a non-negative integer within the safe range`);
  }
  if (Number(capMicroAlgos) <= 0) throw new Error('capMicroAlgos must be > 0');
  if (Number(budgetMicroAlgos) <= 0) throw new Error('budgetMicroAlgos must be > 0');
  if (Number(capMicroAlgos) > Number(budgetMicroAlgos))
    throw new Error('capMicroAlgos must be <= budgetMicroAlgos');
  if (Number(periodRounds) > Number(expiryRound))
    throw new Error('periodRounds must be <= expiryRound');
}

let warnedAny = false;

/**
 * Deploy an AllowanceApp. Fund the returned `appAddress` with the budget
 * afterwards (use `fund`). `payees` is an array of allowed receiver addresses
 * (max 4; the owner is always allowed), or the string 'ANY' to remove the
 * destination restriction (permissionless — loud warning).
 * @returns {Promise<AllowanceApp>}
 */
export async function createAllowanceApp({
  algod,
  ownerSigner,
  agentAddress,
  capMicroAlgos,
  budgetMicroAlgos,
  periodRounds = 0,
  expiryRound,
  payees = [],
}) {
  if (!algosdk.isValidAddress(String(agentAddress)))
    throw new Error('agentAddress is invalid');
  validateCreateParams({ capMicroAlgos, budgetMicroAlgos, periodRounds, expiryRound });

  const anyPayee = payees === 'ANY';
  const list = anyPayee ? [] : payees;
  if (!anyPayee && !Array.isArray(list))
    throw new Error("payees must be an array of addresses or the string 'ANY'");
  if (!anyPayee && list.length > MAX_ALLOWLIST)
    throw new Error(`payees allowlist is limited to ${MAX_ALLOWLIST} addresses`);
  for (const a of list)
    if (!algosdk.isValidAddress(String(a)))
      throw new Error(`payees contains an invalid address: ${a}`);
  if (anyPayee && !warnedAny) {
    warnedAny = true;
    console.warn(
      "⚠ oaa-agent-kit: AllowanceApp payees:'ANY' lets the agent send the budget to " +
        'ANY address — a compromised agent can drain it to a stranger. Prefer an allowlist.',
    );
  }
  // Pad the allowlist to MAX_ALLOWLIST with the owner (redundant, fails safe).
  const slots = [...list];
  while (slots.length < MAX_ALLOWLIST) slots.push(ownerSigner.address);

  const { approval, clear } = await compilePrograms(algod);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: ownerSigner.address,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approval,
    clearProgram: clear,
    numGlobalInts: 7,
    numGlobalByteSlices: 6,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    appArgs: [
      pk(agentAddress),
      u64(capMicroAlgos),
      u64(budgetMicroAlgos),
      u64(periodRounds),
      u64(expiryRound),
      u64(anyPayee ? 1 : 0),
      ...slots.map(pk),
    ],
  });
  const [signed] = await ownerSigner.signTxns([txn]);
  const { txid } = await algod.sendRawTransaction(signed).do();
  const res = await algosdk.waitForConfirmation(algod, txid, 10);
  const appId = Number(res.applicationIndex ?? res['application-index']);
  return new AllowanceApp({ algod, appId });
}

export class AllowanceApp {
  constructor({ algod, appId }) {
    this.algod = algod;
    this.appId = Number(appId);
    this.appAddress = algosdk.getApplicationAddress(this.appId);
  }

  /** Adaptive flat fee covering this call + one inner txn, congestion-safe. */
  async _feeParams() {
    const sp = await this.algod.getTransactionParams().do();
    const min = Number(sp.minFee ?? sp.fee ?? 1000) || 1000;
    sp.flatFee = true;
    sp.fee = 2 * Math.max(1000, min);
    return sp;
  }

  /** Read decoded global state (addresses returned as base32 strings). */
  async state() {
    const info = await this.algod.getApplicationByID(this.appId).do();
    const gs = info.params.globalState || info.params['global-state'] || [];
    const addrKeys = new Set([KEYS.owner, KEYS.agent, KEYS.l0, KEYS.l1, KEYS.l2, KEYS.l3]);
    const out = {};
    for (const { key, value } of gs) {
      const k = Buffer.from(key, 'base64').toString('utf8');
      const type = value.type ?? value['type'];
      if (type === 1) {
        const bytes = new Uint8Array(Buffer.from(value.bytes ?? value['bytes'], 'base64'));
        out[k] = addrKeys.has(k) && bytes.length === 32
          ? algosdk.encodeAddress(bytes)
          : bytes;
      } else {
        out[k] = Number(value.uint ?? value['uint']);
      }
    }
    return out;
  }

  /** Owner funds the app account (budget + min-balance + a little for headroom). */
  async fund(ownerSigner, microAlgos) {
    const sp = await this.algod.getTransactionParams().do();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: ownerSigner.address,
      receiver: this.appAddress,
      amount: Number(microAlgos),
      suggestedParams: sp,
    });
    const [signed] = await ownerSigner.signTxns([txn]);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    return { txid };
  }

  /**
   * Agent calls spend(amount, receiver). Enforced on-chain: sender==agent,
   * receiver allowed by the payee policy, amount<=cap, round<=expiry,
   * spent+amount<=budget (after window reset).
   */
  async spend(agentSigner, { microAlgos, receiver }) {
    const sp = await this._feeParams();
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: agentSigner.address,
      suggestedParams: sp,
      appIndex: this.appId,
      appArgs: [enc('spend'), u64(microAlgos), pk(receiver)],
      accounts: [String(receiver)],
    });
    const [signed] = await agentSigner.signTxns([txn]);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    return { txid };
  }

  /** Owner rotates the authorised agent (use if the agent key is compromised). */
  async setAgent(ownerSigner, newAgentAddress) {
    if (!algosdk.isValidAddress(String(newAgentAddress)))
      throw new Error('newAgentAddress is invalid');
    const sp = await this.algod.getTransactionParams().do();
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: ownerSigner.address,
      suggestedParams: sp,
      appIndex: this.appId,
      appArgs: [enc('setagent'), pk(newAgentAddress)],
    });
    const [signed] = await ownerSigner.signTxns([txn]);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    return { txid };
  }

  /** Owner reclaims the entire remaining balance and re-arms the counter. */
  async reclaim(ownerSigner) {
    const sp = await this._feeParams();
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: ownerSigner.address,
      suggestedParams: sp,
      appIndex: this.appId,
      appArgs: [enc('reclaim')],
      accounts: [ownerSigner.address],
    });
    const [signed] = await ownerSigner.signTxns([txn]);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    return { txid };
  }
}

/**
 * Pure JS mirror of the on-chain spend check — lets the SDK refuse a spend
 * before submitting. Pass current `state()` plus `currentRound`; optionally
 * `appBalance` to also catch the min-balance edge.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function checkSpend(
  { amount, receiver, currentRound, appBalance },
  { cap, budget, spent, period, expiry, wstart, payeeMode, owner, allowlist = [] },
) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > MAX_UINT53)
    return { ok: false, reason: 'amount_invalid' };
  for (const v of [cap, budget]) {
    if (Number(v) > MAX_UINT53) return { ok: false, reason: 'state_out_of_safe_range' };
  }
  if (currentRound != null && Number(currentRound) > Number(expiry))
    return { ok: false, reason: 'expired' };
  // payee policy (payeeMode 1 = ANY)
  if (Number(payeeMode) !== 1 && receiver != null) {
    const allowed = String(receiver) === String(owner) ||
      allowlist.map(String).includes(String(receiver));
    if (!allowed) return { ok: false, reason: 'receiver_not_allowed' };
  }
  if (amt > Number(cap)) return { ok: false, reason: 'amount_exceeds_cap' };
  let effectiveSpent = Number(spent);
  if (
    Number(period) > 0 &&
    currentRound != null &&
    Number(currentRound) >= Number(wstart) + Number(period)
  ) {
    effectiveSpent = 0; // window would reset on-chain
  }
  if (effectiveSpent + amt > Number(budget)) return { ok: false, reason: 'exceeds_budget' };
  if (appBalance != null && amt > Number(appBalance) - MIN_BALANCE)
    return { ok: false, reason: 'insufficient_app_balance' };
  return { ok: true };
}
