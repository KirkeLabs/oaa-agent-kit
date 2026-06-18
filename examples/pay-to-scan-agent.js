/**
 * examples/pay-to-scan-agent.js
 *
 * An agent that pays (over x402, on Algorand TestNet) for a report from an
 * OAA-gated service such as @kirkelabs/conversion-readiness-scan's paid API,
 * spending only within its mandate.
 *
 * Prereqs:
 *   1. npx oaa-agent-kit keygen          → set OWNER_MNEMONIC below / in env
 *   2. Fund the OWNER on TestNet:          https://bank.testnet.algorand.network/
 *   3. A running OAA/x402 endpoint URL in TARGET_URL (returns 402 with Algorand
 *      payment terms). For local testing, run the conversion-readiness-scan
 *      server: `KIRKE_PAYTO=<addr> npm run serve` and use http://localhost:8402.
 *
 * Run:  OWNER_MNEMONIC="..." TARGET_URL="https://api.example.com" node examples/pay-to-scan-agent.js
 */

import {
  getAlgod,
  createMandate,
  AgentAccount,
  createAgent,
  LocalOwnerSigner,
  fundAgent,
  buildPassport,
  signPassport,
} from '../src/index.js';

const network = process.env.NETWORK || 'algorand-testnet';
const targetUrl = process.env.TARGET_URL || 'http://localhost:8402/scan';
const algod = getAlgod({ network });

const owner = new LocalOwnerSigner({ mnemonic: process.env.OWNER_MNEMONIC });
console.log('Owner:', owner.address);

// Mandate: ≤ 1 ALGO per payment, any payee, expires ~1M rounds out.
const sp = await algod.getTransactionParams().do();
const mandate = createMandate({
  owner: owner.address,
  perTxMicroAlgos: 1_000_000,
  expiryRound: Number(sp.lastValid) + 1_000_000,
  network,
});

// The agent's own LogicSig account — fund it; that funding IS its budget.
const account = await AgentAccount.create({ algod, mandate });
console.log(
  'Agent address:',
  account.address,
  '(fund this; it can only spend within the mandate)',
);
await fundAgent(algod, owner, account.address, 5_000_000); // 5 ALGO budget

// Activate the agent: owner signs its passport (Pera Wallet can do this step).
const passport = await signPassport(
  buildPassport({ agentAddress: account.address, owner: owner.address, mandate }),
  owner,
);

// Brain: pay the target once, then return the report.
const brain = async ({ history }) =>
  history.length === 0
    ? {
        tool: 'pay',
        args: { url: targetUrl, body: { url: 'https://www.kirkelabs.com' } },
      }
    : { done: true, result: history.at(-1).out };

const agent = createAgent({ brain, account, mandate, algod, passport });
const { result } = await agent.run('buy one conversion-readiness report');
console.log('\nReport received:\n', JSON.stringify(result, null, 2));
