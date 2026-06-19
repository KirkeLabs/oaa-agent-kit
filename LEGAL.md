# Legal, regulatory & acceptable-use notice

`@kirkelabs/oaa-agent-kit` is free, open-source developer software (MIT). This
notice explains what it is and is not, and your responsibilities as a user. It
is **not legal advice**; if you operate in a regulated context, take your own
advice.

## Nature of the software (non-custodial, no service)

This is a **self-custodial developer tool**. Kirke Labs:

- operates **no servers** in the funding, signing, or payment path;
- holds **no customer funds** and **no cryptographic keys** or seed phrases;
- executes **no transactions on behalf of any person**; and
- provides **no** custody, transfer, exchange, order-execution,
  order-reception/transmission, or other crypto-asset service.

All keys, funds, and transactions remain solely under the control of the user,
who is the sole operator of any agent they create.

## Regulatory status (EU/EEA — MiCA)

Kirke Labs does not provide crypto-asset services within the meaning of
**Article 3(1)(16) of Regulation (EU) 2023/1114 (MiCA)** and is not a
crypto-asset service provider (CASP). Distributing this software is not, in
itself, the provision of a regulated service.

**Operators are responsible for their own status.** Anyone who runs agents *on
behalf of third parties*, custodies third-party keys or funds, or otherwise
provides a crypto-asset service may themselves require authorisation as a CASP
and is solely responsible for determining and meeting their own obligations.

## No token offering

This software effects **no offer to the public** and **no admission to trading**
of any crypto-asset (MiCA Title II). It transacts only in the **native Algorand
coin (ALGO)** via payment transactions; the on-chain mandate restricts agents to
`pay` transactions and **cannot transfer Algorand Standard Assets**, including
any asset-referenced token (ART) or e-money token (EMT) under MiCA Titles III/IV.

## Travel Rule (Reg. (EU) 2023/1113)

Agents created with this software are **self-hosted (unhosted) wallets**.
Transfer-of-funds information obligations under the TFR fall on crypto-asset
service providers, not on self-hosted wallet software. Where you fund an agent
from, or direct payments to, a CASP (e.g. an exchange), you and the relevant
CASP are responsible for any applicable originator/beneficiary information
requirements.

## AML/CFT & sanctions — acceptable use

This software performs **no identity verification (KYC)** and **no sanctions or
address screening**. You **must not** use it to:

- send, receive, facilitate, or disguise the proceeds of crime;
- evade sanctions, or transact with any person or address subject to EU, UN,
  US (OFAC), UK, or other applicable sanctions; or
- breach any applicable AML/CFT, export-control, or financial-crime law.

`allowlist: 'ANY'` disables the payee restriction and **must not** be used to
make funds available to sanctioned persons. You are solely responsible for
screening counterparties and for your own compliance. The `keygen` command
generates unverified accounts for development convenience; treat generated keys
accordingly.

## No warranty; risk

The software is provided **"as is", without warranty of any kind** (see
[LICENSE](./LICENSE)). Crypto-assets are volatile and the software is
experimental and unaudited. The on-chain limits constrain *individual*
transactions and do not guarantee your total funds are safe. **You may lose some
or all of the funds you allocate.** Nothing in this project is financial, legal,
or investment advice. See the Risk warning in the [README](./README.md) and the
threat model in [docs/SECURITY.md](./docs/SECURITY.md).

## Jurisdiction

This software is published globally as open source and is **not targeted at any
specific jurisdiction**, nor is it an offer of or solicitation to use any
regulated service anywhere. You are responsible for determining whether your use
is lawful in your jurisdiction and for complying with all applicable laws.

## Reporting

Security issues: **security@kirkelabs.com** (please do not open public issues for
vulnerabilities affecting funds).
