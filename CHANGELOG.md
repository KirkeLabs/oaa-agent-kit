# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/);
versioning: [SemVer](https://semver.org/).

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
