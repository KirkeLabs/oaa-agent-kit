import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { payAndFetch } from '../src/index.js';

const PAYTO = 'KIRKELABS_TEST_RECEIVER';
const PRICE = '500000';

// A tiny mock OAA/x402 merchant: 402 until a valid X-Payment is presented.
function mockMerchant() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const proof = req.headers['x-payment'];
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (!proof) {
        return send(402, {
          x402Version: 1,
          accepts: [
            {
              scheme: 'exact',
              network: 'algorand',
              asset: 'ALGO',
              amount: PRICE,
              payTo: PAYTO,
              nonce: 'abc123',
            },
          ],
        });
      }
      const p = JSON.parse(Buffer.from(proof, 'base64').toString('utf8'));
      if (p.txid && p.nonce === 'abc123')
        return send(200, { paid: true, result: { ok: 1 } });
      return send(402, { error: 'payment_not_verified' });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, () =>
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}

test('agent pays a 402 and receives the result', async () => {
  const { base, close } = await mockMerchant();
  try {
    let seen = null;
    const payer = async (req) => {
      seen = req;
      return 'TX_MOCK_123';
    };
    const out = await payAndFetch(base + '/scan', {
      payer,
      body: { url: 'https://x.com' },
      allowInsecure: true, // local http test server
    });
    assert.equal(out.paid, true);
    assert.equal(seen.amount, PRICE);
    assert.equal(seen.payTo, PAYTO);
  } finally {
    await close();
  }
});

test('no payer surfaces the payment requirements', async () => {
  const { base, close } = await mockMerchant();
  try {
    await assert.rejects(
      () => payAndFetch(base + '/scan', { body: {}, allowInsecure: true }),
      (e) => e.paymentRequired && e.paymentRequired.amount === PRICE,
    );
  } finally {
    await close();
  }
});

test('a payer that refuses (out of mandate) aborts the call', async () => {
  const { base, close } = await mockMerchant();
  try {
    const payer = async () => {
      throw new Error('Refusing 402: amount_exceeds_per_tx_cap');
    };
    await assert.rejects(
      () => payAndFetch(base + '/scan', { payer, body: {}, allowInsecure: true }),
      /per_tx_cap/,
    );
  } finally {
    await close();
  }
});

test('payAndFetch (SSRF) refuses a private/metadata address', async () => {
  const payer = async () => 'TX';
  await assert.rejects(
    () => payAndFetch('https://10.0.0.5/x', { payer }),
    /private\/loopback/,
  );
  await assert.rejects(
    () => payAndFetch('https://169.254.169.254/latest/meta-data', { payer }),
    /private\/loopback/,
  );
});

test('payAndFetch honours an explicit host allowlist', async () => {
  const payer = async () => 'TX';
  await assert.rejects(
    () => payAndFetch('https://evil.example/x', { payer, allowedHosts: ['api.good.example'] }),
    /not in allowedHosts/,
  );
});

test('payAndFetch refuses a non-https endpoint by default', async () => {
  const payer = async () => 'TX';
  await assert.rejects(
    () => payAndFetch('http://api.example.com/x', { payer }),
    /non-https/,
  );
});
