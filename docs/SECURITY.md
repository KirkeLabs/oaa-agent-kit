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
  never transmits it; `LocalOwnerSigner` keeps it in-process, `PeraConnector`
  leaves it in Pera. Treat a dev mnemonic as disposable and TestNet-only.
- **The agent's brain/tools** are untrusted from the wallet's perspective —
  that's the point. They can _propose_ spends; the mandate disposes.

## Known limitations

- **Aggregate/recurring budgets** need stateful logic (an app) — stateless
  LogicSigs reason per-transaction. v1 approximates the aggregate budget with
  the funded balance. A stateful "allowance app" is on the roadmap.
- **Replay across services**: payment nonces are bound by the _merchant_ (the
  402 issuer); this kit places the nonce in the tx note so a payment matches the
  challenge it was made for.
- **TEAL is generated, not formally verified.** Review `renderMandateTeal`
  output and test on TestNet before mainnet. Independent audit recommended
  before handling material value.

## Reporting

Found an issue? Email security@kirkelabs.com. Please do not open public issues
for vulnerabilities affecting funds.
