# Security Policy

## Reporting a vulnerability

Please report security issues privately to **security@kirkelabs.com**.
Do **not** open a public issue for vulnerabilities affecting funds.

We aim to acknowledge reports within a few business days.

## Scope & threat model

This package handles keys and on-chain payments. The detailed threat model,
trust boundaries, and on-chain guarantees are documented in
[docs/SECURITY.md](./docs/SECURITY.md). Highlights:

- The stateless LogicSig **mandate** is the default primitive; the stateful
  **AllowanceApp** is experimental and unaudited.
- Off-chain (SDK) layer: treat the agent "brain" and all tool/merchant output as
  hostile input — see the agent-safety notes in [docs/SECURITY.md](./docs/SECURITY.md).
- Always start on TestNet; obtain an independent audit before holding material
  value on MainNet.

## Supported versions

Pre-1.0: only the latest published version receives security fixes.
