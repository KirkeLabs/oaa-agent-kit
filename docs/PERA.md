# Pera Wallet interoperability

Pera Wallet can't run your agent's code — but it is exactly the right tool for
the two human-in-control moments: **funding** an agent and **activating** it.
Both are ordinary Pera actions over WalletConnect.

## The model

```
Pera Wallet (the owner)                 Agent (LogicSig account)
───────────────────────                 ────────────────────────
1. connect()                            (address derived from mandate)
2. fund agent address  ───pay──────────▶  budget = funded amount
3. sign agent passport ───signData─────▶  passport activates the agent
                                          → agent now works + pays within mandate
```

- **Funding** = a normal payment from Pera to the agent's address. That balance
  is the agent's entire budget (it can't exceed it; see SECURITY.md).
- **Activation** = the owner signs the **agent passport** (an OAA identity
  binding the agent address to the mandate). OAA-guarded services that set
  `requireAgentIdentity` verify this signature.

## Browser usage

`PeraConnector` implements the same `{ address, signBytes, signTxns }` interface
as `LocalOwnerSigner`, so all the kit's functions work unchanged.

```js
import {
  getAlgod,
  createMandate,
  AgentAccount,
  fundAgent,
  buildPassport,
  signPassport,
  PeraConnector,
} from '@kirkelabs/oaa-agent-kit';

const algod = getAlgod({ network: 'algorand-testnet' });

const owner = new PeraConnector({ chainId: 416002 }); // 416001 mainnet
await owner.connect(); // opens Pera

const sp = await algod.getTransactionParams().do();
const mandate = createMandate({
  owner: owner.address,
  perTxMicroAlgos: 1_000_000,
  expiryRound: Number(sp.lastValid) + 1_000_000,
  network: 'algorand-testnet',
});

const account = await AgentAccount.create({ algod, mandate });

// Fund from Pera (the user approves the payment in the wallet):
await fundAgent(algod, owner, account.address, 5_000_000);

// Activate from Pera (the user approves a signData request):
const passport = await signPassport(
  buildPassport({ agentAddress: account.address, owner: owner.address, mandate }),
  owner,
);

// Hand `account`, `mandate`, `passport` to your agent runtime (server or browser).
```

Install the peer dependency in your app:

```bash
npm i @perawallet/connect
```

## Notes

- **Passport signing** uses Pera's `signData` (arbitrary-bytes / ARC-60). Update
  `@perawallet/connect` if your version predates it.
- **Where the agent runs**: after funding + activation, the agent only needs its
  LogicSig (no owner key) to spend within the mandate — so it can run on a
  server, in a worker, or in the page. The owner key never leaves Pera.
- **Mainnet**: pass `chainId: 416001` and `network: 'algorand'`. Start on
  TestNet (`416002`) and only graduate after review.
