# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/);
versioning: [SemVer](https://semver.org/).

## [0.6.0] — 2026-06-19

Hardening of the experimental `AllowanceApp` after two adversarial audits (an
AVM/TEAL opcode review and a threat-model/economic review). The app was a strict
payee-policy regression vs the stateless mandate; that and several other gaps are
now closed. **Behaviour change: `createAllowanceApp` now takes a `payees` policy
and enforces a destination restriction by default.**

### Security (AllowanceApp)

- **Payee policy (Critical fix).** `spend` previously paid ANY address — a
  compromised agent could drain the whole budget to a stranger. The app now
  enforces, on-chain, `receiver ∈ {owner} ∪ allowlist` by default; pass
  `payees: [addr, …]` (≤4) or the explicit, warned `payees: 'ANY'` to opt into a
  permissionless destination. Mirrors `createMandate`.
- **Creation invariants enforced on-chain** (and in JS): `cap>0`, `budget>0`,
  `cap<=budget`, `expiry>currentRound`, `period<=expiry` — prevents bricked/
  stranded deployments and the `wstart+period` overflow.
- **Delete no longer strands funds:** `DeleteApplication` is refused while the
  app account holds more than min-balance (reclaim first).
- **Agent rotation:** owner-only `setAgent(newAgent)` to retire a compromised
  agent key without redeploying.
- **`reclaim` re-arms** the counter (`spent=0`, `wstart=round`) so the app can be
  safely re-funded.
- **Adaptive fees** (congestion-safe) for `spend`/`reclaim`; `checkSpend` now
  mirrors the payee check, enforces 2^53 safe-integer bounds, and (given
  `appBalance`) the min-balance edge; `state()` returns addresses as base32.

> ⚠ Still EXPERIMENTAL & UNAUDITED. Prefer the stateless mandate unless you need
> consensus-enforced aggregate limits; independent audit before material value.

## [0.5.0] — 2026-06-19

### Added — EXPERIMENTAL stateful aggregate-budget app

- **`AllowanceApp` / `createAllowanceApp`** — an Algorand **Application** (stateful
  contract) that enforces a **cumulative** and optionally **recurring** budget
  **on-chain**, which the stateless LogicSig mandate cannot. The owner deploys it
  (agent address, per-tx cap, total budget, optional period in rounds, expiry)
  and funds the app account; the agent calls `spend(amount, receiver)` and the
  app checks `sender==agent`, `amount<=cap`, `round<=expiry`, and
  `spent+amount<=budget` (resetting the window if the period elapsed) before
  disbursing via an **inner transaction** and incrementing `spent`. The owner can
  `reclaim` the remaining balance at any time.
- **`checkSpend(...)`** — pure-JS mirror of the on-chain spend check.
- **`renderApprovalTeal` / `renderClearTeal` / `ALLOWANCE_APP_KEYS`** exported for
  review/tooling.

Verified on live TestNet: in-budget spends pay via inner txn; over-budget,
over-cap, and non-agent spends are **rejected by consensus** with `spent`
unchanged; owner reclaim sweeps the app account.

> ⚠ **Experimental and UNAUDITED.** Stateful contracts are a large attack
> surface. Do not hold material value on MainNet without an independent audit.
> The stateless LogicSig mandate remains the default, simpler primitive.

47 tests across the suite (was 42).

## [0.4.0] — 2026-06-19

Trust-minimised compile verification (roadmap item from the security review).

### Added

- **`assertMandateProgram(program, mandate)`** — local, no-network structural
  check that a compiled program is a v8 LogicSig embedding this mandate's owner
  key and network genesis hash. `compileMandate` now runs it **by default**
  (pass `{ verify: false }` to skip) and the address is always derived locally
  from the returned bytes, never from the node's claimed hash. Catches a
  malicious/MITM'd `algod` returning a substituted/weakened program for the
  address you are about to fund.
- **`verifyMandateAddress(mandate, [algodA, algodB, …])`** — compiles on two or
  more independent nodes and requires **byte-identical** programs (each passing
  the structural check) before returning the address; use before funding
  material value so no single node can redirect you.

### Notes

- Full local TEAL assembly (trusting no node at all) remains on the roadmap;
  AVM has no readable genesis field, so network binding stays address-level +
  SDK-level (see docs/SECURITY.md). 42 tests (was 38).

## [0.3.0] — 2026-06-19

Second hardening pass after two adversarial red-team reviews (a Halborn-style
smart-contract audit and a MiCA compliance review). **Behaviour change: agent
addresses now differ by network — see below.**

### Security (breaking)

- **Network binding (Critical).** The mandate TEAL now bakes the network genesis
  hash into the program as a constant, so the same mandate compiles to a
  **different address on TestNet vs MainNet** (previously identical, enabling
  cross-network address reuse / passport reuse). Agent addresses therefore change
  in this release. `checkPayment`/`AgentAccount.pay` additionally refuse to build
  a transaction whose genesis hash ≠ the mandate's network. NB: stateless TEAL
  cannot read the genesis at runtime, so this binding is address-level +
  SDK-level, not consensus-level — see docs/SECURITY.md "Network binding". Also:
  `verifyPassport({ network })` rejects a passport issued for another network.
  `GENESIS_HASHES` is exported.
- **uint64 safety.** `createMandate` rejects `perTxMicroAlgos`/`expiryRound`/
  `maxFee` above 2^53-1, and `checkPayment` rejects non-integer/oversized
  amounts and fees — so the JS validator and signed passport can never diverge
  from the on-chain uint64.

### Added

- **`verifyPaymentProof(proof, onchain, expected)`** — merchant-side helper that
  validates an x402 proof against the confirmed on-chain transaction (receiver,
  amount, note==nonce, confirmation, network). A bare `{txid,nonce}` proof is not
  self-authenticating.
- **`createAgent({ maxSpendMicroAlgos })`** — aggregate/velocity spend cap across
  an agent run (defence in depth, especially under `allowlist:'ANY'`); the agent
  exposes a `spent` accessor.
- **Passport hardening:** signed bytes are now domain-tagged (`OAA-PASSPORT-v1|
  <network>|…`) to prevent cross-context signature reuse; `verifyPassport` accepts
  an expected `network` and rejects mismatches; wallet signers receive a
  human-readable summary of what they're authorising (`passportSignMessage`).
- **`LEGAL.md`** — non-CASP / no-token-offering / Travel-Rule / AML & acceptable-use
  / jurisdiction notices; shipped in the package.

### Changed

- The x402 passport header is sent **only on the paid retry**, not the unpaid
  probe (less owner/agent metadata disclosure).
- Docs: removed absolute safety claims ("never", "cannot break", "bulletproof");
  added a Risk warning and an honest "limits of the safety model"; the flagship
  example uses the owner-only default. 38 tests (was 31).

## [0.2.0] — 2026-06-19

Security-hardening release following an independent audit. **Contains a
behaviour change to the payee policy — read before upgrading.**

### Security (breaking)

- **Payee policy is now owner-only by default (was: open).** An empty
  `allowlist` previously compiled to *no* receiver constraint, which — because
  the agent is a stateless LogicSig contract account — let any third party
  redirect the balance to an arbitrary address. The receiver clause is now
  **always** enforced: empty allowlist ⇒ `Receiver == owner`. To pay arbitrary
  addresses you must explicitly opt in with `allowlist: 'ANY'` (which logs a
  warning and is documented as a permissionless spend account). `createMandate`
  now accepts an address array **or** the string `'ANY'`.
- **`GroupSize == 1`** is now enforced in the TEAL and `checkPayment`
  (single, non-grouped transactions only).

### Fixed

- **Pera Wallet passports now verify.** `PeraConnector.signBytes` passed a
  base64 *string* to Pera's `signData` (which expects raw bytes), double-encoding
  the payload so `verifyPassport` always failed. Now passes raw bytes; added a
  round-trip regression test and the exported `peraSignDataPayload` helper.
- **CLI expiry no longer defaults to a stale round.** The hard-coded
  `expiryRound = 40000000` was already in the past on TestNet/MainNet (could
  strand funds). `mandate-teal`/`address` now resolve expiry from the live
  current round; new `--expiry-in <rounds>` option (default 1,000,000).
- **Pre-check parity with the chain.** `AgentAccount.buildPayment`/`pay` now
  thread the real fee, current round, and an expiry-capped `lastValid` into
  `checkPayment`; `makeAlgorandPayer` checks `req.network === mandate.network`
  and bounds the nonce/note size.

### Added

- `verifyPassportAddress(signed, algod)` — recomputes the LogicSig address from
  the passport's mandate and confirms it matches `agentAddress`.
- `buildPassport({ account, owner })` — derive `agentAddress`+`mandate` from an
  `AgentAccount` so they cannot disagree; rejects an owner ≠ `mandate.owner`.
- `payAndFetch` refuses non-`https` payment endpoints (localhost exempt; override
  with `allowInsecure`); `keygen --out <file>` writes the mnemonic to a `0600`
  file instead of stdout.

### Changed

- `algosdk` floored to `^3.6.0` (the tested version) for a fund-critical
  dependency. 31 tests (was 24).

## [0.1.0] — 2026-06-18

- Initial release. Toolkit for fundable, Algorand-connected agents that pay
  their own way over x402 within an on-chain LogicSig mandate.
- **Mandate** (`createMandate`, `checkPayment`) — per-tx cap, payee allowlist,
  expiry, fee cap, no-rekey, owner-only close; JS validator mirrors the TEAL.
- **LogicSig** (`renderMandateTeal`, `compileMandate`, `mandateAddress`) —
  on-chain enforcement; the agent account is a smart signature.
- **AgentAccount** — funded, mandate-bound account; pre-checks then LogicSig-
  signs and submits payments.
- **OAA passport** (`buildPassport`, `signPassport`, `verifyPassport`) — owner
  signature activates the agent; verifiable by `requireAgentIdentity` services.
- **x402** (`payAndFetch`, `makeAlgorandPayer`) — agent-side pay-on-402 handshake,
  refusing out-of-mandate charges before spending.
- **Pera Wallet** (`PeraConnector`, `LocalOwnerSigner`, `fundAgent`) — fund and
  activate agents from Pera; identical interface for Node/dev.
- **Agent loop** (`createAgent`) — pluggable brain + tools; `pay` is built in.
- CLI (`keygen`, `mandate-teal`, `address`, `init`), runnable example, docs
  (README, SECURITY, PERA). 24 tests; MIT licensed.
