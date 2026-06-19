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
 * Model:
 *   - The OWNER creates the app (setting agent, per-tx cap, total budget,
 *     optional recurring period in rounds, and an expiry round) and funds the
 *     app account with the budget.
 *   - The AGENT (its own keypair, holding a little ALGO for fees) calls
 *     `spend(amount, receiver)`. The app checks sender==agent, amount<=cap,
 *     round<=expiry, and (after resetting the window if the period elapsed)
 *     spent+amount<=budget, then inner-pays the receiver and increments spent.
 *   - The OWNER can `reclaim` the remaining balance back to themselves at any
 *     time, and (after reclaiming) delete the app.
 *
 * ⚠ EXPERIMENTAL & UNAUDITED. Stateful contracts are a large attack surface.
 * Do not hold material value on MainNet without an independent audit.
 */

import algosdk from 'algosdk';

// Global state keys (kept short; all fit in the default global schema).
export const KEYS = Object.freeze({
  owner: 'o',
  agent: 'a',
  cap: 'c',
  budget: 'b',
  spent: 's',
  period: 'p',
  expiry: 'e',
  wstart: 'w',
});

/** Approval program TEAL (AVM v8). Deterministic; review before use. */
export function renderApprovalTeal() {
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

// ---- DeleteApplication: owner only ----
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

b reject

// =====================================================================
on_create:
  // args: [agent(32), cap(uint), budget(uint), period(uint), expiry(uint)]
  byte "${KEYS.owner}"
  txn Sender
  app_global_put
  byte "${KEYS.agent}"
  txna ApplicationArgs 0
  app_global_put
  byte "${KEYS.cap}"
  txna ApplicationArgs 1
  btoi
  app_global_put
  byte "${KEYS.budget}"
  txna ApplicationArgs 2
  btoi
  app_global_put
  byte "${KEYS.period}"
  txna ApplicationArgs 3
  btoi
  app_global_put
  byte "${KEYS.expiry}"
  txna ApplicationArgs 4
  btoi
  app_global_put
  byte "${KEYS.spent}"
  int 0
  app_global_put
  byte "${KEYS.wstart}"
  global Round
  app_global_put
  int 1
  return

// =====================================================================
on_spend:
  // sender must be the agent
  txn Sender
  byte "${KEYS.agent}"
  app_global_get
  ==
  assert

  // not past expiry
  global Round
  byte "${KEYS.expiry}"
  app_global_get
  <=
  assert

  // window reset: if period>0 and Round >= wstart+period -> spent=0, wstart=Round
  byte "${KEYS.period}"
  app_global_get
  int 0
  >
  bz skip_reset
  global Round
  byte "${KEYS.wstart}"
  app_global_get
  byte "${KEYS.period}"
  app_global_get
  +
  >=
  bz skip_reset
  byte "${KEYS.spent}"
  int 0
  app_global_put
  byte "${KEYS.wstart}"
  global Round
  app_global_put
  skip_reset:

  // amount = btoi(args[1]); amount <= cap
  txna ApplicationArgs 1
  btoi
  store 0            // scratch 0 = amount
  load 0
  byte "${KEYS.cap}"
  app_global_get
  <=
  assert

  // spent + amount <= budget
  byte "${KEYS.spent}"
  app_global_get
  load 0
  +
  store 1            // scratch 1 = new spent
  load 1
  byte "${KEYS.budget}"
  app_global_get
  <=
  assert

  // inner payment: app account -> receiver(args[2]) amount
  itxn_begin
  int pay
  itxn_field TypeEnum
  txna ApplicationArgs 2
  itxn_field Receiver
  load 0
  itxn_field Amount
  int 0
  itxn_field Fee     // fee pooled; outer call must cover it
  itxn_submit

  // persist new spent
  byte "${KEYS.spent}"
  load 1
  app_global_put
  int 1
  return

// =====================================================================
on_reclaim:
  // owner only; inner-pay the entire app balance back to owner (close out)
  txn Sender
  byte "${KEYS.owner}"
  app_global_get
  ==
  assert
  itxn_begin
  int pay
  itxn_field TypeEnum
  byte "${KEYS.owner}"
  app_global_get
  itxn_field Receiver
  int 0
  itxn_field Amount
  byte "${KEYS.owner}"
  app_global_get
  itxn_field CloseRemainderTo   // sweep everything back to owner
  int 0
  itxn_field Fee
  itxn_submit
  int 1
  return

// =====================================================================
on_delete:
  txn Sender
  byte "${KEYS.owner}"
  app_global_get
  ==
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

async function compilePrograms(algod) {
  const a = await algod.compile(renderApprovalTeal()).do();
  const c = await algod.compile(renderClearTeal()).do();
  return {
    approval: new Uint8Array(Buffer.from(a.result, 'base64')),
    clear: new Uint8Array(Buffer.from(c.result, 'base64')),
  };
}

/**
 * Deploy an AllowanceApp. The owner signer creates the app; fund the returned
 * `appAddress` with the budget afterwards (use `fundApp`).
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
}) {
  if (!algosdk.isValidAddress(String(agentAddress)))
    throw new Error('agentAddress is invalid');
  const u64 = (n) => algosdk.encodeUint64(Number(n));
  const { approval, clear } = await compilePrograms(algod);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: ownerSigner.address,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approval,
    clearProgram: clear,
    numGlobalInts: 6,
    numGlobalByteSlices: 2,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    appArgs: [
      algosdk.decodeAddress(String(agentAddress)).publicKey,
      u64(capMicroAlgos),
      u64(budgetMicroAlgos),
      u64(periodRounds),
      u64(expiryRound),
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

  /** Read decoded global state. */
  async state() {
    const info = await this.algod.getApplicationByID(this.appId).do();
    const gs = info.params.globalState || info.params['global-state'] || [];
    const out = {};
    for (const { key, value } of gs) {
      const k = Buffer.from(key, 'base64').toString('utf8');
      const v = value;
      const type = v.type ?? v['type'];
      out[k] = type === 1
        ? Buffer.from(v.bytes ?? v['bytes'], 'base64')
        : Number(v.uint ?? v['uint']);
    }
    return out;
  }

  /** Owner funds the app account with the budget (+ a little for fees/min-balance). */
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
   * Agent calls spend(amount, receiver). The agent signer pays the pooled fee
   * (2x min) so the inner payment is covered. Enforced on-chain: sender==agent,
   * amount<=cap, round<=expiry, spent+amount<=budget (after window reset).
   */
  async spend(agentSigner, { microAlgos, receiver }) {
    const sp = await this.algod.getTransactionParams().do();
    sp.flatFee = true;
    sp.fee = 2000; // cover this call + 1 inner txn
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: agentSigner.address,
      suggestedParams: sp,
      appIndex: this.appId,
      appArgs: [
        enc('spend'),
        algosdk.encodeUint64(Number(microAlgos)),
        algosdk.decodeAddress(String(receiver)).publicKey,
      ],
      accounts: [String(receiver)],
    });
    const [signed] = await agentSigner.signTxns([txn]);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
    return { txid };
  }

  /** Owner reclaims the entire remaining balance back to themselves. */
  async reclaim(ownerSigner) {
    const sp = await this.algod.getTransactionParams().do();
    sp.flatFee = true;
    sp.fee = 2000;
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
 * before submitting. `currentRound` and the current `spent`/`wstart` come from
 * `state()`.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function checkSpend(
  { amount, currentRound },
  { cap, budget, spent, period, expiry, wstart },
) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) return { ok: false, reason: 'amount_invalid' };
  if (currentRound != null && Number(currentRound) > Number(expiry))
    return { ok: false, reason: 'expired' };
  if (amt > Number(cap)) return { ok: false, reason: 'amount_exceeds_cap' };
  let effectiveSpent = Number(spent);
  if (
    Number(period) > 0 &&
    currentRound != null &&
    Number(currentRound) >= Number(wstart) + Number(period)
  ) {
    effectiveSpent = 0; // window would reset on-chain
  }
  if (effectiveSpent + amt > Number(budget))
    return { ok: false, reason: 'exceeds_budget' };
  return { ok: true };
}
