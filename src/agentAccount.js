/**
 * agentAccount.js — the agent's funded, mandate-bound Algorand account.
 *
 * Backed by the mandate LogicSig: the address is the smart-signature address,
 * the owner funds it, and every payment is (a) pre-checked in JS against the
 * mandate and (b) ultimately enforced on-chain by the LogicSig. Belt and
 * braces — a buggy or hijacked agent still cannot exceed its mandate.
 */

import algosdk from 'algosdk';
import { checkPayment } from './mandate.js';
import { compileMandate } from './logicsig.js';

export class AgentAccount {
  /** @param {algosdk.LogicSigAccount} lsig @param {object} mandate */
  constructor(lsig, mandate) {
    this.lsig = lsig;
    this.mandate = mandate;
    this.address = String(lsig.address());
  }

  /** Compile the mandate and wrap it. Network call (algod.compile). */
  static async create({ algod, mandate }) {
    const lsig = await compileMandate(algod, mandate);
    return new AgentAccount(lsig, mandate);
  }

  /**
   * Build a payment txn and pre-check it against the mandate. Throws
   * MandateViolation before anything touches the network.
   */
  buildPayment({ to, microAlgos, note, suggestedParams }) {
    // Cap lastValid at the mandate expiry so a valid pre-check can never submit
    // a txn the chain will reject for expiry, and pin the real fee + current
    // round so the JS pre-check matches what the LogicSig will actually see.
    const fee = Number(suggestedParams.fee || suggestedParams.minFee || 1000);
    const currentRound = Number(suggestedParams.firstValid);
    const lastValid = Math.min(
      Number(suggestedParams.lastValid),
      this.mandate.expiryRound,
    );
    const check = checkPayment(
      {
        type: 'pay',
        amount: Number(microAlgos),
        fee,
        receiver: String(to),
        lastValid,
        groupSize: 1,
      },
      this.mandate,
      currentRound,
    );
    if (!check.ok) {
      const err = new Error(`MandateViolation: ${check.reason}`);
      err.code = check.reason;
      throw err;
    }
    const params = { ...suggestedParams, lastValid };
    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.address,
      receiver: String(to),
      amount: Number(microAlgos),
      note: note ? new TextEncoder().encode(String(note)) : undefined,
      suggestedParams: params,
    });
  }

  /** Build → mandate-check → LogicSig-sign → submit. Network call. */
  async pay({ algod, to, microAlgos, note }) {
    const suggestedParams = await algod.getTransactionParams().do();
    const txn = this.buildPayment({ to, microAlgos, note, suggestedParams });
    const signed = algosdk.signLogicSigTransactionObject(txn, this.lsig);
    const { txid } = await algod.sendRawTransaction(signed.blob).do();
    return { txid, amount: Number(microAlgos), to: String(to) };
  }

  /** Current spendable budget (balance minus min-balance). Network call. */
  async budget(algod) {
    const info = await algod.accountInformation(this.address).do();
    return Math.max(0, Number(info.amount) - 100_000);
  }
}
