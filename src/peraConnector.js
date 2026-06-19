/**
 * peraConnector.js — owner signers.
 *
 * An "owner signer" funds and activates an agent. Two implementations share one
 * interface — `{ address, signBytes(bytes), signTxns(txns) }`:
 *
 *   - LocalOwnerSigner: an in-process Algorand account (dev / server / CI).
 *   - PeraConnector:     Pera Wallet over WalletConnect (browser). This is how
 *                        "Pera activates an agent" — the user funds the agent
 *                        address and signs the agent passport from their wallet.
 *
 * @perawallet/connect is an OPTIONAL peer dependency, imported lazily so this
 * package runs in Node without it.
 */

import algosdk from 'algosdk';

export class LocalOwnerSigner {
  /** @param {{mnemonic?:string, secretKey?:Uint8Array}} opts */
  constructor({ mnemonic, secretKey } = {}) {
    let acct;
    if (mnemonic) acct = algosdk.mnemonicToSecretKey(mnemonic);
    else if (secretKey) acct = { sk: secretKey, addr: addrFromSk(secretKey) };
    else acct = algosdk.generateAccount();
    this._sk = acct.sk;
    this.address = String(acct.addr);
  }
  static random() {
    return new LocalOwnerSigner({});
  }
  get mnemonic() {
    return algosdk.secretKeyToMnemonic(this._sk);
  }
  async signBytes(bytes) {
    return algosdk.signBytes(bytes, this._sk);
  }
  /** Sign payment/other txns (array of algosdk.Transaction) → signed blobs. */
  async signTxns(txns) {
    return txns.map((t) => t.signTxn(this._sk));
  }
}

/**
 * Pera Wallet adapter (browser). Usage:
 *   const owner = new PeraConnector();
 *   await owner.connect();              // opens Pera, returns address
 *   await fundAgent(algod, owner, agentAddress, 5e6);
 *   const signed = await signPassport(passport, owner);
 *
 * Requires `@perawallet/connect` installed in the host app.
 */
/**
 * Build the ARC-60 `signData` payload for a passport. Pera expects `data` to be
 * the RAW bytes (a Uint8Array), which it base64-encodes and MX-prefixes before
 * signing with the same scheme as `algosdk.signBytes` — so the result verifies
 * under `algosdk.verifyBytes` over the same raw bytes. Passing an already-base64
 * string here would double-encode and break `verifyPassport`.
 */
export function peraSignDataPayload(bytes, message = 'Activate OAA agent') {
  return [{ data: Buffer.from(bytes), message }];
}

export class PeraConnector {
  constructor({ chainId, _client } = {}) {
    this._chainId = chainId; // 416001 mainnet, 416002 testnet
    this._pera = _client || null; // allow injection for testing
    this.address = null;
  }
  async _client() {
    if (this._pera) return this._pera;
    let mod;
    try {
      mod = await import('@perawallet/connect');
    } catch {
      throw new Error(
        'PeraConnector requires the optional peer dependency `@perawallet/connect` (browser).',
      );
    }
    const PeraWalletConnect = mod.PeraWalletConnect || mod.default?.PeraWalletConnect;
    this._pera = new PeraWalletConnect(this._chainId ? { chainId: this._chainId } : {});
    return this._pera;
  }
  async connect() {
    const pera = await this._client();
    const accounts = await pera.connect();
    this.address = accounts[0];
    return this.address;
  }
  async reconnect() {
    const pera = await this._client();
    const accounts = await pera.reconnectSession();
    if (accounts && accounts[0]) this.address = accounts[0];
    return this.address;
  }
  async disconnect() {
    if (this._pera) await this._pera.disconnect();
    this.address = null;
  }
  /** Sign arbitrary bytes (passport activation) via Pera's signData (ARC-60). */
  async signBytes(bytes) {
    const pera = await this._client();
    if (typeof pera.signData !== 'function') {
      throw new Error(
        'This Pera version lacks signData; update @perawallet/connect to sign passports.',
      );
    }
    const out = await pera.signData(peraSignDataPayload(bytes), this.address);
    const sig = out[0];
    return sig instanceof Uint8Array ? sig : new Uint8Array(Buffer.from(sig, 'base64'));
  }
  /** Sign Algorand transactions via Pera (funding, etc.). */
  async signTxns(txns) {
    const pera = await this._client();
    const groups = txns.map((txn) => [{ txn }]);
    return pera.signTransaction(groups);
  }
}

/**
 * Build + sign + submit a funding payment from the owner to the agent address.
 * The aggregate budget of the mandate == what you fund here.
 */
export async function fundAgent(algod, ownerSigner, agentAddress, microAlgos, note) {
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: ownerSigner.address,
    receiver: String(agentAddress),
    amount: Number(microAlgos),
    note: note ? new TextEncoder().encode(note) : undefined,
    suggestedParams: sp,
  });
  const [signed] = await ownerSigner.signTxns([txn]);
  const { txid } = await algod.sendRawTransaction(signed).do();
  return { txid };
}

function addrFromSk(sk) {
  // last 32 bytes of an ed25519 secret key are the public key
  const pk = sk.slice(32);
  return algosdk.encodeAddress(pk);
}
