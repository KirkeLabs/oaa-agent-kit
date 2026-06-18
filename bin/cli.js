#!/usr/bin/env node
/**
 * oaa-agent-kit CLI
 *
 *   oaa-agent-kit keygen                 generate a dev Algorand owner account
 *   oaa-agent-kit mandate-teal [opts]    print the LogicSig TEAL for a mandate
 *   oaa-agent-kit address [opts]         compute the agent address (needs node)
 *   oaa-agent-kit init [dir]             scaffold a starter agent project
 *   oaa-agent-kit help
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import algosdk from 'algosdk';
import { createMandate, renderMandateTeal, mandateAddress } from '../src/index.js';
import { getAlgod } from '../src/index.js';

function parse(argv) {
  const o = { _: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--'))
      o[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
    else o._.push(a);
  }
  return o;
}

function mandateFromOpts(o) {
  return createMandate({
    owner: o.owner,
    perTxMicroAlgos: parseInt(o['per-tx'] || '1000000', 10),
    allowlist: o.allow
      ? o.allow
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    expiryRound: parseInt(o.expiry || '40000000', 10),
    maxFee: parseInt(o['max-fee'] || '2000', 10),
    network: o.network || 'algorand-testnet',
  });
}

async function main() {
  const cmd = process.argv[2];
  const o = parse(process.argv);

  if (cmd === 'keygen') {
    const a = algosdk.generateAccount();
    console.log(
      JSON.stringify(
        { address: String(a.addr), mnemonic: algosdk.secretKeyToMnemonic(a.sk) },
        null,
        2,
      ),
    );
    console.log(
      '\n⚠ Dev only. Fund on TestNet via https://bank.testnet.algorand.network/',
    );
    return;
  }

  if (cmd === 'mandate-teal') {
    if (!o.owner) return fail('--owner <address> is required');
    console.log(renderMandateTeal(mandateFromOpts(o)));
    return;
  }

  if (cmd === 'address') {
    if (!o.owner) return fail('--owner <address> is required');
    const algod = getAlgod({ network: o.network || 'algorand-testnet' });
    const addr = await mandateAddress(algod, mandateFromOpts(o));
    console.log(String(addr));
    return;
  }

  if (cmd === 'init') {
    const dir = resolve(o._[0] || 'my-agent');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), STARTER_PKG);
    await writeFile(join(dir, 'agent.js'), STARTER_AGENT);
    await writeFile(join(dir, '.env.example'), STARTER_ENV);
    await writeFile(join(dir, 'README.md'), STARTER_README);
    console.log(
      `Scaffolded an agent in ${dir}\n  cd ${dir} && npm install && cp .env.example .env && node agent.js`,
    );
    return;
  }

  help();
}

function help() {
  console.log(`
oaa-agent-kit — fundable Algorand agents that pay their own way (x402 + OAA)

Commands
  keygen                          generate a dev owner account (mnemonic)
  mandate-teal --owner <addr>     print the LogicSig TEAL for a mandate
  address --owner <addr>          compute the agent's on-chain address
  init [dir]                      scaffold a starter agent project

Mandate options (for mandate-teal / address)
  --owner <addr>        owner Algorand address (required)
  --per-tx <microAlgos> per-transaction cap          (default 1000000 = 1 ALGO)
  --allow <a,b,c>       payee allowlist (empty = any)
  --expiry <round>      mandate expiry round          (default 40000000)
  --max-fee <microAlgos>fee cap                       (default 2000)
  --network <net>       algorand | algorand-testnet   (default testnet)

MIT · Kirke Labs · free & open source
`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const STARTER_PKG = `{
  "name": "my-oaa-agent",
  "private": true,
  "type": "module",
  "dependencies": { "@kirkelabs/oaa-agent-kit": "^0.1.0" }
}
`;

const STARTER_ENV = `# Owner account (dev). Generate with: npx oaa-agent-kit keygen
OWNER_MNEMONIC="word1 word2 ... word25"
NETWORK=algorand-testnet
`;

const STARTER_AGENT = `import {
  getAlgod, createMandate, AgentAccount, createAgent,
  LocalOwnerSigner, fundAgent, buildPassport, signPassport,
} from '@kirkelabs/oaa-agent-kit';

const network = process.env.NETWORK || 'algorand-testnet';
const algod = getAlgod({ network });
const owner = new LocalOwnerSigner({ mnemonic: process.env.OWNER_MNEMONIC });

// 1) Mandate: at most 1 ALGO/tx, any payee, expires at a future round.
const sp = await algod.getTransactionParams().do();
const mandate = createMandate({
  owner: owner.address,
  perTxMicroAlgos: 1_000_000,
  expiryRound: Number(sp.lastValid) + 1_000_000,
  network,
});

// 2) Agent account (LogicSig) + fund it (this is the agent's whole budget).
const account = await AgentAccount.create({ algod, mandate });
console.log('Agent address:', account.address);
await fundAgent(algod, owner, account.address, 5_000_000); // 5 ALGO

// 3) Activate: owner signs the agent passport (Pera can do this in a browser).
const passport = await signPassport(
  buildPassport({ agentAddress: account.address, owner: owner.address, mandate }),
  owner,
);

// 4) A trivial brain: pay a 402-gated URL, then finish.
const brain = async ({ history }) =>
  history.length === 0
    ? { tool: 'pay', args: { url: process.env.TARGET_URL, body: { url: 'https://example.com' } } }
    : { done: true, result: history.at(-1).out };

const agent = createAgent({ brain, account, mandate, algod, passport });
console.log(await agent.run('buy one report'));
`;

const STARTER_README = `# my-oaa-agent

A starter agent built with @kirkelabs/oaa-agent-kit.

1. \`npx oaa-agent-kit keygen\` → put the mnemonic in \`.env\`
2. Fund the OWNER on TestNet: https://bank.testnet.algorand.network/
3. \`npm install && node agent.js\`

The agent gets its own LogicSig address, you fund it (that's its budget), and
it can only spend within the mandate (per-tx cap, allowlist, expiry).
`;

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
