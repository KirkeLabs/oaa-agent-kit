# Security model

`oaa-agent-kit` lets software agents hold and spend funds autonomously. That is
only acceptable if the agent's authority is **bounded by the chain**, not by the
agent's own (fallible, possibly-hijacked) code. This document states exactly
what an agent can and cannot do, and where the trust boundaries are.

## The core idea: the account _is_ the policy

The agent's Algorand address is the address of a **stateless LogicSig** compiled
from the mandate (`src/logicsig.js`). To move funds, a transaction must satisfy
the TEAL — evaluated by every node in consensus. There is no privileged code
path: even if the agent process is fully compromised, it can only produce
transactions the LogicSig already permits.

## What the mandate enforces on-chain

For every payment from the agent account:

| Rule                                 | TEAL check                                     |
| ------------------------------------ | ---------------------------------------------- |
| Payments only (no asset/app/key-reg) | `TypeEnum == pay`                              |
| Single, non-grouped transaction      | `GroupSize == 1`                               |
| Per-transaction cap                  | `Amount <= perTxMicroAlgos`                    |
| Fee cap (no fee-drain)               | `Fee <= maxFee`                                |
| Expiry                               | `LastValid <= expiryRound`                     |
| No self-rekey (no authority escape)  | `RekeyTo == ZeroAddress`                       |
| No hostile close                     | `CloseRemainderTo == ZeroAddress \|\| == owner`|
| Payee policy (always enforced)       | `Receiver ∈ {owner} ∪ allowlist`               |

`src/mandate.js#checkPayment` mirrors these in JS so the SDK refuses a bad spend
_before_ it is ever submitted — defence in depth, but the chain is the
authority.

### Network binding (important caveat)

A stateless LogicSig **cannot read the chain genesis at runtime** — there is no
`txn`/`global GenesisHash` field in the AVM. We therefore cannot make the TEAL
itself reject a wrong-network transaction. Instead:

- the network's genesis hash is **baked into the program as a constant**, so the
  same mandate compiles to a **different address on TestNet vs MainNet** (this
  removes the accidental-address-collision footgun); and
- `checkPayment` (and thus `AgentAccount.pay`) **refuses to build/submit** a
  transaction whose genesis hash does not match the mandate's network
  (`genesis_hash_mismatch`).

Residual risk: because the program cannot enforce the genesis on-chain, a party
who **bypasses this SDK** could still spend an agent address that was funded on a
network other than the one its mandate was generated for. **Mitigation: never
fund an agent address on a network it was not generated for**, and derive the
address per-network via the SDK rather than copying it between chains.

## Payee policy: owner-only by default

The payee check is **always** emitted. The default (empty allowlist) compiles to
`Receiver == owner` — the agent can spend **only back to the owner**. Adding
addresses widens the set to `{owner} ∪ allowlist`. There is **no** "open by
default": redirecting funds to a stranger is rejected by consensus unless you
opt in.

### `allowlist: 'ANY'` — explicit, permissionless mode

Some agents must pay services whose address isn't known ahead of time (e.g. an
x402 endpoint that names its `payTo` at request time). `allowlist: 'ANY'` omits
the receiver clause entirely. **This makes the account permissionless:** because
a stateless LogicSig is authorised by its (public, deterministic, on-chain-once-
spent) program, *anyone* who has that program can direct the balance — in
cap-sized payments, up to the funded total — to any address. The cap, fee,
expiry, rekey, close-to-owner, and single-tx rules still hold, so total exposure
is still bounded by the funded balance, but the funds may reach a third party.
Use `'ANY'` only with small caps and short expiries; prefer an explicit payee
list. `createMandate` emits a runtime warning when `'ANY'` is used.

## Budget = funded balance

There is no hidden credit. The agent's spending power is exactly the ALGO you
send its address, minus the 0.1 ALGO min-balance. Worst case (a totally rogue
agent, or — under `'ANY'` — a third party) it spends that balance **in cap-sized
payments to the allowed payees, or returns it to the owner** — it cannot exceed
the funded balance, cannot reach a payee outside the policy, and cannot escape
via rekey/close. To "revoke," stop funding it and/or let the expiry round pass;
sweep remaining funds back to the owner.

## Trust boundaries / responsibilities

- **You** choose the cap, allowlist, expiry, and how much to fund. Keep caps and
  funding small; prefer a tight allowlist for production.
- **The owner key** (your Pera Wallet / mnemonic) is the root of trust. The kit
  never transmits it; `LocalOwnerSigner` keeps it in-process (JS cannot reliably
  wipe it from memory — use it for dev/server only, prefer `PeraConnector` which
  leaves the key in Pera). Treat a dev mnemonic as disposable and TestNet-only.

## The off-chain (SDK) layer: treat the brain and all I/O as hostile

The on-chain mandate bounds **fund movement**. It does NOT sanitise everything
else, so at the SDK layer:

- **The agent's brain/tools are untrusted *for fund movement only*.** They can
  _propose_ spends; the mandate disposes. But a prompt-injected or malicious
  brain also chooses tool names, **tool arguments**, and the **URL/body** of
  every `pay` call. Validate tool arguments inside each tool; treat all tool
  output and fetched content as attacker-controlled; never put secrets or
  sensitive data where the brain can read them (`history`, `scratch`, the
  values `run()` returns are all LLM-visible).
- **SSRF:** `payAndFetch` refuses non-`https` and private/loopback/link-local/
  metadata destinations and does not follow redirects. When the brain is
  untrusted, also pass `fetchPolicy.allowedHosts` (an explicit payment-host
  allowlist) so it cannot point payments at arbitrary hosts.
- **Aggregate cap scope:** `createAgent({ maxSpendMicroAlgos })` counts amount +
  fee, but only for spend that flows through the built-in `pay` tool / `ctx.pay`.
  A custom tool that calls `account.pay`/`makeAlgorandPayer` directly bypasses
  it. **Do not hand `account` to untrusted tools.** The on-chain aggregate
  ceiling is the funded balance (or an `AllowanceApp`).
- **Merchant input:** the 402 response is attacker-controlled. The kit picks the
  cheapest acceptable term, validates `payTo`, binds the network, and bounds the
  nonce; pass `fetchPolicy.maxAmountMicroAlgos` to cap the price independent of
  the per-tx cap. A response timeout and body-size cap apply by default.
- **Passports are bearer credentials.** Send them only over TLS to the intended
  audience; set `audience` (and optionally `nonce`) and verify them at the
  relying party. Default validity is short (1 hour).
- **Indirect prompt injection.** Content the agent *fetches* (an x402 response, a
  scraped page, a tool result) can contain instructions crafted to hijack an LLM
  brain into paying an attacker or calling a dangerous tool. The chain still caps
  the loss, but to prevent it: don't feed raw fetched content back to the brain as
  trusted instructions; keep fetched data in a clearly-untrusted channel; pair an
  LLM brain with an allowlist (not `'ANY'`), a tight `maxSpendMicroAlgos`, and the
  `payAndFetch`/`fetchPolicy` **`confirm` hook** (a per-payment human-in-the-loop
  or policy gate, invoked before any funds move). For high value, keep the brain
  in a separate, low-privilege process from the owner key.
- **Trust the `algod` node.** `getTransactionParams`/`compile`/balance reads come
  from the configured node; a hostile node cannot exceed the on-chain mandate
  (consensus is the backstop) but can cause failed/again-able transactions. Use a
  node you trust, and `verifyMandateAddress` across independent nodes before
  funding material value.
- **DNS rebinding (residual).** The SSRF guard resolves and rejects hosts that
  point to private ranges, but does not pin the connection IP, so a
  resolve-public-then-connect-private rebinding is not fully prevented. Use
  `fetchPolicy.allowedHosts` for untrusted brains — it is the authoritative
  control.

## Known limitations

- **Aggregate/recurring budgets** need stateful logic — stateless LogicSigs
  reason per-transaction. Three levels are available: (1) the funded balance is
  the on-chain aggregate ceiling; (2) `createAgent({ maxSpendMicroAlgos })` caps
  cumulative spend in the SDK (defence in depth, not consensus); (3) the
  **experimental** `AllowanceApp` (a stateful Application) enforces a cumulative
  and optionally recurring budget **on-chain**. The app is a larger attack
  surface and is **unaudited** — prefer the stateless mandate unless you need
  consensus-enforced aggregate limits, and get an independent audit before
  holding material value with it.
- **Payment proofs must be verified on-chain.** The x402 proof is
  `{network, txid, nonce}`; a merchant MUST confirm the on-chain transaction
  (receiver, amount, note==nonce, confirmed, genesis) before releasing a
  resource — see `verifyPaymentProof`. A bare proof is not self-authenticating.
- **TEAL is generated, not formally verified.** Review `renderMandateTeal`
  output and test on TestNet before mainnet. Independent audit recommended
  before handling material value. Re-audit on any AVM/`#pragma` change.
- **Compilation trust.** `compileMandate` asks a remote `algod` to compile the
  TEAL, then derives the address **locally** from the returned bytes (never from
  the node's claimed hash) and, by default, runs `assertMandateProgram` to
  confirm the returned program is a v8 LogicSig that embeds this mandate's owner
  key and network genesis hash — catching a substituted/weakened program. For
  material value, additionally call `verifyMandateAddress(mandate, [algodA,
  algodB])` to require **byte-identical** compilation from two or more
  independent nodes before funding, so no single malicious/MITM'd node can
  redirect you to the wrong address. (Full local assembly — trusting no node at
  all — remains on the roadmap.)

## Reporting

Found an issue? Email security@kirkelabs.com. Please do not open public issues
for vulnerabilities affecting funds.
