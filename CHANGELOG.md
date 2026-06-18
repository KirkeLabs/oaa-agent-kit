# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/);
versioning: [SemVer](https://semver.org/).

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
