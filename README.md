# @kirkelabs/oaa-agent-kit

[![License: MIT](https://img.shields.io/badge/license-MIT-00dc94?style=flat)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-00dc94?style=flat)](https://nodejs.org)
[![Algorand](https://img.shields.io/badge/Algorand-x402%20%2B%20OAA-00dc94?style=flat)](https://algorand.co)

**Create a fundable AI agent that works on your behalf and pays its own way on Algorand — without ever being able to spend more than you allow.**

```bash
npx oaa-agent-kit init my-agent
```

You fund an agent, hand it a job, and it autonomously pays for the tools/services it uses over **x402** — but only within an **on-chain LogicSig mandate** (per-transaction cap, payee allowlist, expiry). Activate and fund agents straight from **Pera Wallet**. **OAA (Open Agent Access)** tooling included. Free & open source.

> The agent side of the agent economy. Pairs with `@kirkelabs/agent-readiness-scan` and `conversion-readiness-scan` (the merchant side that _charges_ agents).

---

## Why this is safe by design

An autonomous agent holding a wallet is scary — unless its authority is bounded by the chain itself. Here it is:

- **The agent account is a LogicSig.** Its address is a smart signature compiled from your mandate. Consensus rejects any spend that breaks the rules — there's no "trust the agent's code."
- **You can only lose what you fund.** The aggregate budget _is_ the balance you send the agent address. Leftovers can only ever close back to **you**.
- **Per-transaction cap + payee allowlist + expiry** are enforced on-chain. The agent **cannot** rekey itself, drain to an attacker, overpay, pay strangers, or act after expiry.
- **TestNet by default.** Mainnet is an explicit choice.

See [docs/SECURITY.md](./docs/SECURITY.md) for the full threat model.

## Install

```bash
npm i @kirkelabs/oaa-agent-kit        # library
# or scaffold a project:
npx oaa-agent-kit init my-agent
```

Requires Node.js ≥ 20. `@perawallet/connect` is an optional peer dep (only for the browser/Pera flow).

## 60-second agent

```js
import {
  getAlgod,
  createMandate,
  AgentAccount,
  createAgent,
  LocalOwnerSigner,
  fundAgent,
  buildPassport,
  signPassport,
} from '@kirkelabs/oaa-agent-kit';

const algod = getAlgod({ network: 'algorand-testnet' });
const owner = new LocalOwnerSigner({ mnemonic: process.env.OWNER_MNEMONIC });

// 1) Mandate — the agent's authority, enforced on-chain.
const sp = await algod.getTransactionParams().do();
const mandate = createMandate({
  owner: owner.address,
  perTxMicroAlgos: 1_000_000, // ≤ 1 ALGO per payment
  allowlist: [], // [] = any payee; or restrict
  expiryRound: Number(sp.lastValid) + 1_000_000,
  network: 'algorand-testnet',
});

// 2) Agent account (LogicSig) + fund it. That funding is its whole budget.
const account = await AgentAccount.create({ algod, mandate });
await fundAgent(algod, owner, account.address, 5_000_000); // 5 ALGO

// 3) Activate — owner signs the agent's passport (Pera can sign this).
const passport = await signPassport(
  buildPassport({ agentAddress: account.address, owner: owner.address, mandate }),
  owner,
);

// 4) Give it a brain + run. Paying an x402 service is a built-in tool.
const brain = async ({ history }) =>
  history.length === 0
    ? {
        tool: 'pay',
        args: { url: 'https://api.example.com/scan', body: { url: 'https://site.com' } },
      }
    : { done: true, result: history.at(-1).out };

const agent = createAgent({ brain, account, mandate, algod, passport });
console.log(await agent.run('buy one report'));
```

## How it works

```
            ┌── you (Pera Wallet / owner) ──┐
            │  fund + sign passport         │
            ▼                               ▼
   ┌──────────────────┐   x402 402    ┌──────────────────┐
   │  agent (LogicSig │ ───────────▶  │  OAA service     │
   │  account, funded)│   pay ≤ cap   │  (charges agents)│
   │  + brain + tools │ ◀───────────  │  returns result  │
   └──────────────────┘   result      └──────────────────┘
        spends only within the on-chain mandate
```

- **Mandate** (`createMandate`) → **LogicSig** (`renderMandateTeal` / `compileMandate`) → **AgentAccount** (`AgentAccount.create`).
- **Passport** (`buildPassport`/`signPassport`/`verifyPassport`) — OAA identity; the owner's signature _activates_ the agent. Services that set `requireAgentIdentity` can verify it.
- **Pay** (`payAndFetch` / built-in `pay` tool) — handles the `402 → pay → retry` handshake, refusing anything outside the mandate before spending.
- **Brain** — any `async ({task, history}) => action`. Rules today, an LLM tomorrow; the kit doesn't care.

## Pera Wallet

Pera _activates_ agents: the user funds the agent address and signs the agent passport from their wallet over WalletConnect. See [docs/PERA.md](./docs/PERA.md). In Node/CI use `LocalOwnerSigner`; in the browser swap in `PeraConnector` — same interface.

## CLI

```bash
oaa-agent-kit keygen                       # dev owner account (mnemonic)
oaa-agent-kit mandate-teal --owner <addr>  # print the LogicSig TEAL
oaa-agent-kit address --owner <addr>       # compute the agent address
oaa-agent-kit init [dir]                   # scaffold a starter agent
```

## Limitations

- LogicSig mandates bound **single transactions** (per-tx cap, payee, expiry, no rekey/hostile close). The _aggregate_ budget is the funded balance; for richer running budgets/recurring allowances use a stateful app (on the roadmap).
- `compileMandate`/`AgentAccount.create`/funding/paying need an `algod` node (TestNet by default via AlgoNode).
- This is infrastructure, not financial advice. Audit before mainnet. Start on TestNet.

## Licence

[MIT](./LICENSE) © 2026 Kirke Labs — a gift to the Algorand ecosystem. — [www.kirkelabs.com](https://www.kirkelabs.com)
