# @kirkelabs/oaa-agent-kit

[![License: MIT](https://img.shields.io/badge/license-MIT-00dc94?style=flat)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-00dc94?style=flat)](https://nodejs.org)
[![Algorand](https://img.shields.io/badge/Algorand-x402%20%2B%20OAA-00dc94?style=flat)](https://algorand.co)

**Give a small software helper its own pocket money and a job. It pays for what it needs, within limits the Algorand blockchain enforces on every transaction — a per-payment cap, an approved-payee policy, and an expiry.**

```bash
npx oaa-agent-kit init my-agent
```

> ⚠️ **Experimental, unaudited software, provided "as is."** The on-chain rules
> bound each individual transaction; they do **not** guarantee your total funds
> are safe. Read **[Risk warning](#risk-warning)** and **[LEGAL.md](./LEGAL.md)**
> before using real funds. Nothing here is financial advice.

---

## What is this, in one paragraph?

An **agent** is a little program that does a task for you — say, "fetch me a report" or "scan this website." Some of the tools an agent wants to use cost a tiny amount of money. This kit lets you create an agent that has **its own wallet**, hand it an **allowance** ("don't spend more than 1 coin at a time, only pay these approved places, and stop working after a certain date"), and let it pay its own way. Those allowance rules are checked by the Algorand network on every transaction — a payment that breaks them is rejected. You stay in control of the money the whole time.

If you've never touched crypto or a command line before, that's fine — the [Quick start](#quick-start-on-testnet-free--no-real-money) below uses **free play money** and walks through every step.

## How the safety model works (and its limits)

Here's *why* the limits hold, and — just as important — where they stop:

- **Your exposure is the amount you fund.** An agent's budget is whatever you send its address; there's no link to your main wallet and no "drain everything" path. Barring loss of your own seed phrase (see below), the funded balance is the ceiling on what's at stake.
- **The limits are enforced by the network, not by the agent's good behavior.** The agent's wallet is a **LogicSig** — an account with a rulebook compiled into it. Every payment is checked by Algorand consensus; one that breaks a rule (over the cap, wrong payee, past expiry, rekey, hostile close, or wrong network) is rejected.
- **By default the agent can pay only *you*.** With no allowlist, the only permitted destination is the owner. To let it pay services you list their addresses; to let it pay *any* address you must explicitly opt in with `allowlist: 'ANY'` — which makes it a **permissionless** account (see ["A note on `'ANY'`"](#a-note-on-paying-any-address)).
- **What this does *not* protect against:** anyone who obtains your **owner seed phrase** controls all your funds; under `allowlist: 'ANY'` funds can reach a third party; the enforcement logic (TEAL) is generated and **not formally verified or independently audited**; and a buggy "brain" can still spend the whole funded balance on approved payees. The rules cap each transaction — they are not a guarantee that your total is safe.
- **You start on a free test network.** No real money is involved until *you* deliberately switch to MainNet (there's a [checklist](#going-to-mainnet-real-money--checklist--cautions) first).

> Full technical threat model: [docs/SECURITY.md](./docs/SECURITY.md) · Regulatory & legal notices: [LEGAL.md](./LEGAL.md).

## Risk warning

Crypto-assets are volatile and largely unregulated. This is **experimental, unaudited developer software provided "as is," without warranty** (see [LICENSE](./LICENSE)). In particular: (i) if you set `allowlist: 'ANY'`, **any third party** who has the agent's public rules can direct its balance, in cap-sized payments, to an address of their choosing; (ii) the on-chain enforcement logic has **not** been formally verified or independently audited; (iii) **anyone with your owner seed phrase controls all your funds**; (iv) the per-transaction cap, payee policy and expiry constrain *individual* transactions and do **not** guarantee your aggregate funds are safe. **You may lose some or all of the funds you allocate.** Nothing in this project is financial, legal, or investment advice. See [LEGAL.md](./LEGAL.md).

## What you'll need

- **A computer** with **Node.js version 20 or newer** installed. Node is a free program that runs JavaScript. Get it from [nodejs.org](https://nodejs.org) (the "LTS" version is perfect). To check if you already have it, open a terminal and type `node --version`.
- **About 10 minutes.**
- **Either** a generated test account (the kit makes one for you — no wallet app needed), **or** the free [Pera Wallet](https://perawallet.app/) phone app if you'd like to fund an agent the way a normal person sends crypto.
- **No coding required** for the test-network walkthrough. Copy, paste, done.

## Key words in plain English

You'll meet these terms below. None of them are scary:

| Word | What it actually means |
|------|------------------------|
| **Agent** | A small program that does a task on your behalf and can pay for tools it needs. |
| **Owner** | You. The person who funds the agent and sets its rules. |
| **Mandate** | The agent's **allowance rules**: how much per payment, who it may pay, when it expires. |
| **Algorand** | A fast, low-fee blockchain (a shared, tamper-proof public ledger). It's where the agent's wallet and rules live. |
| **TestNet** | A free practice version of Algorand. The coins are **fake** and worth nothing — perfect for learning. |
| **MainNet** | The real Algorand network, where coins have real value. You only use this on purpose. |
| **ALGO / microALGO** | ALGO is Algorand's coin. Amounts in code are usually in **microALGO**: 1 ALGO = 1,000,000 microALGO. (So `1_000_000` in the examples = 1 ALGO.) |
| **Fee / gas** | A tiny charge (a fraction of a cent) the network takes to process a transaction. |
| **LogicSig** | A "smart" wallet that comes with a **rulebook baked in**. The network refuses any payment that breaks the rules. This is what makes the agent safe. |
| **x402** | A web standard for "pay-as-you-go" services: a website can reply *"402 — pay me this much and I'll give you the result."* Your agent can answer that automatically. |
| **OAA passport** | "Open Agent Access" ID card. A small signed note proving *"this agent really was activated by its owner."* Some services ask for it. |
| **Mnemonic / seed phrase** | 25 secret words that *are* the keys to an account. **Anyone with these words controls the account. Never share them.** |

---

## Quick start on TestNet (free — no real money)

This creates a working agent using **free play money**. Nothing here can cost you anything.

### 1. Install Node.js
Download and install the **LTS** version from [nodejs.org](https://nodejs.org). Then open a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac) and confirm:
```bash
node --version
```
You should see `v20.x.x` or higher.

### 2. Make a "dev" account and save the secret words
```bash
npx oaa-agent-kit keygen
```
This prints an **address** (public, shareable) and a **mnemonic** (25 secret words). **Copy the 25 words somewhere safe and private** — they're the only key to this account. (On TestNet it's play money, but it's good practice to treat the phrase as precious.)

### 3. Get free test ALGO
Go to the **TestNet dispenser**: **https://bank.testnet.algorand.network/**
Paste in the **address** from step 2 and request funds. Within seconds you'll have some free test ALGO. This is the money your *owner* account uses to fund the agent.

### 4. Scaffold a starter agent
```bash
npx oaa-agent-kit init my-agent
```
This creates a folder `my-agent` with everything pre-wired: `agent.js`, `package.json`, and a `.env.example` file.

### 5. Add your secret phrase
Go into the new folder, copy the example settings file, and paste your 25 words into it:
```bash
cd my-agent
cp .env.example .env
```
Open `.env` in any text editor and set:
```
OWNER_MNEMONIC="the twenty five words you saved in step 2"
NETWORK=algorand-testnet
```
(The `.env` file keeps your secret out of the code. Don't share it or commit it to GitHub.)

### 6. Install and run
```bash
npm install
node agent.js
```

### 7. What success looks like
The agent will:
1. Build its **mandate** (allowance rules),
2. Create its own **wallet address** and print it,
3. **Fund** that wallet from your owner account (this is the agent's whole budget),
4. **Activate** itself with an owner-signed passport,
5. Run its task.

You'll see the agent's address and the result of its run printed in the terminal. 🎉 You just funded and ran an autonomous agent that pays its own way — with hard, blockchain-enforced limits — for free.

> The starter agent's task points at a placeholder URL (`TARGET_URL`). Until you point it at a real x402 service, the "pay" step simply has nothing to buy — that's expected. Everything up to and including funding + activation is real and live on TestNet.

---

## How funding actually works (the mental model)

Picture three buckets of money:

```
   YOU (owner)                  THE AGENT'S WALLET                 A SERVICE
   your test ALGO     ─fund─▶   (a LogicSig: budget + rulebook)   the agent pays
                                          │                        for a tool/result
                                          │  each payment is checked
                                          ▼  against your rules by the network
                                   ✅ within rules → it happens
                                   ❌ breaks a rule → REJECTED
   leftovers ◀──── can only ever close back to YOU
```

1. **You fund the agent's address.** Whatever you send is the agent's **entire budget**. Full stop. It has no other money and no way to reach yours.
2. **The agent spends within the mandate.** Three rules ride along with every payment:
   - **Per-transaction cap** — the most it can pay in a *single* payment (e.g. 1 ALGO).
   - **Allowlist** — the *only* addresses it may pay. **Safe default: leave it empty and the agent can pay *only you*, the owner** — funds can never be redirected to a stranger. List specific service addresses to let it pay them. (To let it pay *any* address — e.g. arbitrary pay-as-you-go services whose address you don't know in advance — you must explicitly set `allowlist: 'ANY'`, which turns the agent into a *permissionless* spend account. See ["A note on `'ANY'`"](#a-note-on-paying-any-address) before you do.)
   - **Expiry** — a future point after which it can't pay at all.
3. **Leftovers come home.** A *close* of the account can only ever sweep the remaining balance **back to you, the owner** — the rules forbid closing it out to anyone else.

**Worked example.** You set the per-transaction cap to **1 ALGO** and fund the agent with **5 ALGO**. The agent can then make **at most five payments of 1 ALGO or less** to approved addresses before it simply runs out of money. It can't make a single 2-ALGO payment (over the cap → rejected). It can't pay an address you didn't approve (→ rejected). After the expiry date, it can't pay at all. The worst case is that all 5 test ALGO get spent on approved services — and not one microALGO more.

### A note on paying *any* address

The agent account is a **stateless smart contract** (LogicSig): its rules are public and enforced by the network, but so is the account itself. With a payee allowlist (or the owner-only default), that's exactly what you want — only approved destinations are reachable. But if you set `allowlist: 'ANY'` to let the agent pay arbitrary services, you remove the destination check entirely, which means **anyone** who sees the agent's published rules could also direct its balance (in cap-sized amounts, up to the funded total) to an address of their choosing. Your per-tx cap, expiry, and "leftovers only return to the owner" rules still hold — so your total exposure is still only what you funded — but the funds could go to someone other than you. **Use `'ANY'` only with small caps and short expiries, and prefer listing specific service addresses whenever you can.**

---

## Funding from Pera Wallet (no coding)

Prefer to fund an agent the way you'd send crypto to a friend? Use the free **[Pera Wallet](https://perawallet.app/)** app:

1. **Get the agent's address.** Run `npx oaa-agent-kit address --owner <your-address>` (or copy it from the agent's printout in step 7 above).
2. **Open Pera**, tap **Send**, paste the agent's address, and send it some ALGO. *On MainNet this is **real money** — see the checklist below first.*
3. **Activate the agent.** When prompted, approve the **activation signature** in Pera. This signs the agent's OAA passport — proof that you, the owner, authorized it. (Technical details: [docs/PERA.md](./docs/PERA.md).)

That's it. Funding an agent is just sending ALGO to its address; the rulebook is already baked into that address.

## How to stop or claw back the money

You're never locked in. To wind an agent down:

- **Stop funding it.** It can only spend what it already holds. Send no more, and its budget only shrinks.
- **Let the expiry pass.** After the mandate's expiry round, the agent can't make any payment at all.
- **Sweep the leftovers back to yourself.** Because the rules only ever allow the remaining balance to close **back to the owner**, you can recover whatever's unspent at any time.

There is no scenario in which stopping an agent requires anyone's permission but yours.

---

## Going to MainNet (real money) — checklist & cautions

TestNet is free and the default. **MainNet uses real ALGO with real value.** Before you switch (`network: 'algorand'`), go through this:

- [ ] **Start tiny.** Fund with a small amount you're completely fine losing while you learn.
- [ ] **Set a low per-transaction cap.** Match it to what a single service call should actually cost.
- [ ] **Use a tight allowlist.** On MainNet, prefer listing the *exact* addresses the agent may pay rather than leaving it open.
- [ ] **Set a sensible expiry.** Don't grant an open-ended mandate; pick a round/date when authority should lapse.
- [ ] **Audit the code and your config.** Read [docs/SECURITY.md](./docs/SECURITY.md). Understand what your agent's "brain" will actually do before you fund it.
- [ ] **Keep your mnemonic offline and secret.** It controls real money now.

This kit is infrastructure, not financial advice. The on-chain limits are strong, but *you* choose the numbers — choose conservatively.

---

## FAQ / troubleshooting

**Do I need to know how to code?**
No, for the TestNet walkthrough. You copy and paste commands. To customize what the agent *does* (its "brain"), you'd write a little JavaScript — but the safety limits work regardless.

**Can this drain my wallet?**
**It cannot reach your main wallet.** The agent has its *own* separate wallet and no access to yours; it can only spend what you deliberately send it, and the network rejects any payment over the per-payment cap, after expiry, or — unless you chose `allowlist: 'ANY'` — to an address you didn't approve. So your exposure is capped at the amount you fund the agent with. Two caveats in plain terms: under `allowlist: 'ANY'` those approved-payee limits are off (any address can be paid), and whoever holds **your** 25-word owner phrase controls your real wallet — so keep it secret. See the [Risk warning](#risk-warning).

**What's a mnemonic, and why the warnings?**
It's the 25 secret words that *are* the keys to an account. Anyone who has them controls that account's money. Keep them offline, never paste them into a website, never share them, never commit your `.env` file.

**It says "insufficient funds."**
The account trying to pay doesn't have enough ALGO. On TestNet, top up the **owner** account at https://bank.testnet.algorand.network/ and re-run. Remember Algorand accounts also need a small minimum balance (0.1 ALGO) to stay open, so fund a little above what you intend to spend.

**What does "402" mean?**
It's a web response meaning *"Payment Required."* A service replies with `402` and the price; your agent reads the terms, checks them against your mandate, pays if (and only if) they fit, and retries. That whole handshake is the `pay` tool, built in.

**The agent printed an address but "nothing happened" on the task.**
The starter agent points at a placeholder service URL. Funding and activation are real; the *payment* step only does something once you point it at a live x402 service. That's expected for the out-of-the-box demo.

---
---

# Developer reference

Everything below is for developers building on the kit. The plain-English guide above is all most users need.

## Install

```bash
npm i @kirkelabs/oaa-agent-kit        # library
# or scaffold a project:
npx oaa-agent-kit init my-agent
```

Requires Node.js ≥ 20. `@perawallet/connect` is an optional peer dependency (only needed for the browser/Pera flow).

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
  allowlist: [], // [] = OWNER-ONLY (safe default). List service addresses to
  // let the agent pay them, e.g. allowlist: ['SERVICE_ADDR']. Only use
  // allowlist: 'ANY' (permissionless — see Risk warning) if you accept that
  // anyone could then direct the agent's balance to any address.
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
- **Brain** — any `async ({task, history, scratch}) => action`. Rules today, an LLM tomorrow; the kit doesn't care.

## Public API

| Export | Purpose |
|--------|---------|
| `getAlgod(opts)` | An `Algodv2` client for a public node (TestNet by default). |
| `createMandate(opts)` | Build a frozen, validated mandate object. `allowlist` is an address array (empty ⇒ owner-only) or `'ANY'` (permissionless opt-in). |
| `checkPayment(txn, mandate, currentRound?)` | Pure JS validator mirroring the on-chain TEAL. |
| `remainingBudget(mandate, balance)` | Spendable budget (balance minus min-balance). |
| `renderMandateTeal` / `compileMandate` / `mandateAddress` | TEAL source, compiled program (structurally verified by default), agent address. |
| `assertMandateProgram(program, mandate)` / `verifyMandateAddress(mandate, [algodA, algodB])` | Trust-minimised compile checks — confirm the compiled program binds your owner/network, and that independent nodes agree on the address before you fund. |
| `AgentAccount` | The LogicSig account; `AgentAccount.create({algod, mandate})`, `.address`, `.pay(...)`. |
| `payAndFetch(url, opts)` / `makeAlgorandPayer(opts)` | The x402 agent-side handshake and on-chain payer. |
| `createAgent(opts)` | The brain-pluggable agent loop with a built-in `pay` tool. |
| `buildPassport` / `signPassport` / `verifyPassport` / `verifyPassportAddress` / `passportBytes` / `PASSPORT_SCHEMA` | OAA passport (agent identity). `verifyPassportAddress` confirms the stated address matches the mandate on-chain. |
| `LocalOwnerSigner` / `PeraConnector` / `peraSignDataPayload` / `fundAgent` | Owner signers (Node + browser) and the funding helper. |

## Pera Wallet

Pera _activates_ agents: the user funds the agent address and signs the agent passport from their wallet over WalletConnect. See [docs/PERA.md](./docs/PERA.md). In Node/CI use `LocalOwnerSigner`; in the browser swap in `PeraConnector` — same `{ address, signBytes, signTxns }` interface.

## CLI

```bash
oaa-agent-kit keygen                       # dev owner account (mnemonic)
oaa-agent-kit mandate-teal --owner <addr>  # print the LogicSig TEAL
oaa-agent-kit address --owner <addr>       # compute the agent address
oaa-agent-kit init [dir]                   # scaffold a starter agent
```

Mandate options for `mandate-teal` / `address`: `--per-tx <microAlgos>` (default 1000000), `--allow <a,b,c>`, `--expiry <round>` (default 40000000), `--max-fee <microAlgos>` (default 2000), `--network algorand|algorand-testnet` (default testnet).

## Limitations

- LogicSig mandates bound **single transactions** (per-tx cap, payee, expiry, no rekey/hostile close). The _aggregate_ budget is the funded balance; for richer running budgets/recurring allowances use a stateful app (on the roadmap).
- `compileMandate`/`AgentAccount.create`/funding/paying need an `algod` node (TestNet by default via AlgoNode).
- This is infrastructure, not financial advice. Audit before mainnet. Start on TestNet.

> The agent side of the agent economy. Pairs with `@kirkelabs/agent-readiness-scan` and `conversion-readiness-scan` (the merchant side that _charges_ agents).

## Licence

[MIT](./LICENSE) © 2026 Kirke Labs — a gift to the Algorand ecosystem. — [www.kirkelabs.com](https://www.kirkelabs.com)
