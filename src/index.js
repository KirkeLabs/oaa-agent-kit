/**
 * @kirkelabs/oaa-agent-kit — public API.
 *
 * Build a fundable, Algorand-connected agent that works on your behalf and pays
 * for what it uses over x402, spending only within an on-chain LogicSig mandate.
 * Pera Wallet-interoperable; OAA tooling included. MIT.
 *
 *   import {
 *     createMandate, AgentAccount, createAgent,
 *     LocalOwnerSigner, PeraConnector, fundAgent,
 *     buildPassport, signPassport, verifyPassport,
 *     payAndFetch, getAlgod,
 *   } from '@kirkelabs/oaa-agent-kit';
 */

import algosdk from 'algosdk';

export { createMandate, checkPayment, remainingBudget, ZERO_ADDR } from './mandate.js';
export { renderMandateTeal, compileMandate, mandateAddress } from './logicsig.js';
export { AgentAccount } from './agentAccount.js';
export { payAndFetch, makeAlgorandPayer } from './x402.js';
export { createAgent } from './agent.js';
export {
  buildPassport,
  signPassport,
  verifyPassport,
  verifyPassportAddress,
  passportBytes,
  PASSPORT_SCHEMA,
} from './passport.js';
export {
  LocalOwnerSigner,
  PeraConnector,
  peraSignDataPayload,
  fundAgent,
} from './peraConnector.js';

/** Convenience: an Algod client for a public node. */
export function getAlgod({
  network = 'algorand-testnet',
  server,
  token = '',
  port = '',
} = {}) {
  const url =
    server ||
    (network === 'algorand'
      ? 'https://mainnet-api.algonode.cloud'
      : 'https://testnet-api.algonode.cloud');
  return new algosdk.Algodv2(token, url, port);
}

export { algosdk };
