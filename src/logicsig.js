/**
 * logicsig.js — compile a mandate into an Algorand stateless LogicSig.
 *
 * The agent's account *is* this smart signature: its address is derived from
 * the compiled program, the owner funds that address, and the chain itself
 * rejects any spend that violates the mandate — over the per-tx cap, to a
 * non-allowlisted payee, after expiry, or any rekey / close-to-attacker.
 * No server, no trust in the agent's code: the limits are consensus-enforced.
 */

import algosdk from 'algosdk';
import { ZERO_ADDR } from './mandate.js';

/**
 * Render the TEAL source enforcing a mandate. Deterministic from the mandate,
 * so the agent's address is reproducible by anyone who has the mandate.
 */
export function renderMandateTeal(mandate) {
  const L = [];
  L.push('#pragma version 8');
  L.push('// oaa-agent-kit mandate — auto-generated. Do not hand-edit.');

  // type == pay
  L.push('txn TypeEnum');
  L.push('int pay');
  L.push('==');

  // single, non-grouped transaction (no group-bundling games)
  L.push('global GroupSize');
  L.push('int 1');
  L.push('==');
  L.push('&&');

  // amount <= perTxMicroAlgos
  L.push('txn Amount');
  L.push(`int ${mandate.perTxMicroAlgos}`);
  L.push('<=');
  L.push('&&');

  // fee <= maxFee
  L.push('txn Fee');
  L.push(`int ${mandate.maxFee}`);
  L.push('<=');
  L.push('&&');

  // lastValid <= expiryRound
  L.push('txn LastValid');
  L.push(`int ${mandate.expiryRound}`);
  L.push('<=');
  L.push('&&');

  // no rekey
  L.push('txn RekeyTo');
  L.push('global ZeroAddress');
  L.push('==');
  L.push('&&');

  // closeRemainderTo == zero OR == owner
  L.push('txn CloseRemainderTo');
  L.push('global ZeroAddress');
  L.push('==');
  L.push('txn CloseRemainderTo');
  L.push(`addr ${mandate.owner}`);
  L.push('==');
  L.push('||');
  L.push('&&');

  // receiver allowed: owner ∪ allowlist. With an EMPTY allowlist this reduces
  // to "receiver == owner" (owner-only, the safe default). The payee clause is
  // omitted ONLY for an explicit `allowlist: 'ANY'` opt-in (permissionless).
  if (!mandate.anyPayee) {
    const payees = [mandate.owner, ...mandate.allowlist];
    payees.forEach((addr, i) => {
      L.push('txn Receiver');
      L.push(`addr ${addr}`);
      L.push('==');
      if (i > 0) L.push('||');
    });
    L.push('&&');
  }

  return L.join('\n') + '\n';
}

/**
 * Compile a mandate to a LogicSigAccount via algod. Network call.
 * @param {algosdk.Algodv2} algod
 * @param {object} mandate
 * @returns {Promise<algosdk.LogicSigAccount>}
 */
export async function compileMandate(algod, mandate) {
  const teal = renderMandateTeal(mandate);
  const res = await algod.compile(teal).do();
  const program = new Uint8Array(Buffer.from(res.result, 'base64'));
  return new algosdk.LogicSigAccount(program);
}

/** The agent's on-chain address for a mandate (requires algod to compile). */
export async function mandateAddress(algod, mandate) {
  const lsa = await compileMandate(algod, mandate);
  return lsa.address();
}

export { ZERO_ADDR };
