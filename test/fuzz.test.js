import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import {
  createMandate,
  checkPayment,
  checkSpend,
  GENESIS_HASHES,
  payAndFetch,
} from '../src/index.js';

// Deterministic PRNG so failures are reproducible.
let _seed = 0x1234abcd;
const rnd = () => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const intIsh = () =>
  pick([
    0,
    1,
    Math.floor(rnd() * 2_000_000),
    -Math.floor(rnd() * 10),
    1.5,
    NaN,
    2 ** 60,
    '500000',
  ]);

const owner = String(algosdk.generateAccount().addr);
const payee = String(algosdk.generateAccount().addr);
const stranger = String(algosdk.generateAccount().addr);
const ZERO = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('fuzz: checkPayment never returns ok for an out-of-policy payment', () => {
  for (let i = 0; i < 1500; i++) {
    const network = pick(['algorand', 'algorand-testnet']);
    const allowlist = pick([[], [payee], 'ANY']);
    const cap = pick([1, 1000, 1_000_000]);
    const maxFee = pick([0, 1000, 2000]);
    const expiryRound = pick([1, 1000, 40_000_000]);
    const m = createMandate({ owner, perTxMicroAlgos: cap, allowlist, expiryRound, maxFee, network });

    const txn = {
      type: pick(['pay', 'pay', 'axfer', 'keyreg', undefined]),
      amount: intIsh(),
      fee: intIsh(),
      receiver: pick([owner, payee, stranger, ZERO, undefined]),
      rekeyTo: pick([undefined, ZERO, stranger]),
      closeRemainderTo: pick([undefined, ZERO, owner, stranger]),
      lastValid: pick([undefined, 1, 1000, 50_000_000]),
      groupSize: pick([undefined, 1, 2, 3]),
      genesisHash: pick([undefined, GENESIS_HASHES[network], 'wrong-hash']),
    };
    const currentRound = pick([undefined, 1, 1000, 50_000_000]);
    const r = checkPayment(txn, m, currentRound);

    assert.ok(r && typeof r.ok === 'boolean', `result shape (i=${i})`);
    if (r.ok) {
      assert.ok(typeof r.reason === 'undefined');
      // Re-derive every invariant the TEAL enforces; ok must satisfy ALL.
      const amt = Number(txn.amount ?? 0);
      const fee = Number(txn.fee ?? 0);
      const recv = txn.receiver == null ? '' : String(txn.receiver);
      const ctx = { i, txn: JSON.stringify(txn), cap, maxFee, expiryRound, network, allowlist };
      assert.equal(txn.type ?? 'pay', 'pay', `type ${JSON.stringify(ctx)}`);
      assert.ok(Number.isInteger(amt) && amt >= 0 && amt <= cap, `amount ${JSON.stringify(ctx)}`);
      assert.ok(Number.isInteger(fee) && fee >= 0 && fee <= maxFee, `fee ${JSON.stringify(ctx)}`);
      assert.ok(txn.groupSize == null || Number(txn.groupSize) === 1, `group ${JSON.stringify(ctx)}`);
      const allowed = m.anyPayee || recv === owner || m.allowlist.includes(recv);
      assert.ok(recv && allowed, `receiver ${JSON.stringify(ctx)}`);
      assert.ok(!txn.rekeyTo || String(txn.rekeyTo) === ZERO, `rekey ${JSON.stringify(ctx)}`);
      const close = txn.closeRemainderTo == null ? '' : String(txn.closeRemainderTo);
      assert.ok(!close || close === ZERO || close === owner, `close ${JSON.stringify(ctx)}`);
      if (txn.genesisHash != null)
        assert.equal(String(txn.genesisHash), GENESIS_HASHES[network], `genesis ${JSON.stringify(ctx)}`);
      if (txn.lastValid != null)
        assert.ok(Number(txn.lastValid) <= expiryRound, `lastValid ${JSON.stringify(ctx)}`);
      if (currentRound != null)
        assert.ok(Number(currentRound) <= expiryRound, `currentRound ${JSON.stringify(ctx)}`);
    }
  }
});

test('fuzz: checkSpend never returns ok for an out-of-policy app spend', () => {
  for (let i = 0; i < 1500; i++) {
    const cap = pick([1, 1000, 1_000_000]);
    const budget = pick([cap, cap * 5, 10_000_000]);
    const st = {
      cap,
      budget,
      spent: pick([0, 500_000, budget]),
      period: pick([0, 100]),
      expiry: pick([1, 1000, 40_000_000]),
      wstart: pick([0, 500]),
      payeeMode: pick([0, 1]),
      owner,
      allowlist: pick([[], [payee]]),
    };
    const args = {
      amount: intIsh(),
      receiver: pick([owner, payee, stranger, undefined]),
      currentRound: pick([undefined, 1, 1000, 50_000_000]),
      appBalance: pick([undefined, 100_000, 1_000_000, budget]),
    };
    const r = checkSpend(args, st);
    assert.ok(r && typeof r.ok === 'boolean', `shape (i=${i})`);
    if (r.ok) {
      const amt = Number(args.amount);
      const ctx = JSON.stringify({ i, args, st });
      assert.ok(Number.isInteger(amt) && amt > 0 && amt <= cap, `amt/cap ${ctx}`);
      if (Number(st.payeeMode) !== 1 && args.receiver != null) {
        const allowed = String(args.receiver) === owner || st.allowlist.map(String).includes(String(args.receiver));
        assert.ok(allowed, `payee ${ctx}`);
      }
      if (args.currentRound != null) assert.ok(Number(args.currentRound) <= st.expiry, `expiry ${ctx}`);
      // budget (accounting for a possible window reset)
      let eff = Number(st.spent);
      if (Number(st.period) > 0 && args.currentRound != null && Number(args.currentRound) >= Number(st.wstart) + Number(st.period)) eff = 0;
      assert.ok(eff + amt <= Number(budget), `budget ${ctx}`);
      if (args.appBalance != null) assert.ok(amt <= Number(args.appBalance) - 100_000, `minbal ${ctx}`);
    }
  }
});

test('fuzz: payAndFetch SSRF guard rejects every private/non-https target', async () => {
  const payer = async () => 'TX';
  const bad = [
    'http://api.example.com/x',
    'https://10.1.2.3/x',
    'https://192.168.0.1/x',
    'https://172.16.5.5/x',
    'https://169.254.169.254/meta',
    'https://[::1]/x',
    'https://127.0.0.1/x',
    'ftp://example.com/x',
    'not-a-url',
  ];
  for (const url of bad) {
    await assert.rejects(() => payAndFetch(url, { payer }), `should reject ${url}`);
  }
});
