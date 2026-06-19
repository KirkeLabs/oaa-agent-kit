import { test } from 'node:test';
import assert from 'node:assert/strict';
import algosdk from 'algosdk';
import { createAgent, createMandate, verifyPaymentProof } from '../src/index.js';

test('agent runs brain → tool → done', async () => {
  const brain = async ({ history }) =>
    history.length === 0
      ? { tool: 'echo', args: { msg: 'hi' } }
      : { done: true, result: history.at(-1).out };
  const tools = { echo: async ({ msg }) => msg.toUpperCase() };
  const agent = createAgent({ brain, tools });
  const { result, steps } = await agent.run('say hi');
  assert.equal(result, 'HI');
  assert.equal(steps, 1);
});

test('unknown tool is recorded but does not crash', async () => {
  let n = 0;
  const brain = async () =>
    n++ === 0 ? { tool: 'nope', args: {} } : { done: true, result: 'fin' };
  const agent = createAgent({ brain, tools: {} });
  const { result, history } = await agent.run('x');
  assert.equal(result, 'fin');
  assert.equal(history[0].error, 'unknown_tool');
});

test('agent stops at the step cap', async () => {
  const brain = async () => ({ tool: 'spin', args: {} });
  const agent = createAgent({ brain, tools: { spin: async () => 1 }, maxSteps: 3 });
  const out = await agent.run('loop');
  assert.equal(out.stopped, 'max_steps');
  assert.equal(out.steps, 3);
});

test('a built-in pay tool is always present', async () => {
  const agent = createAgent({ brain: async () => ({ done: true }) });
  assert.equal(typeof agent.tools.pay, 'function');
});

test('aggregate spend cap stops the agent paying beyond maxSpendMicroAlgos', async () => {
  const { createServer } = await import('node:http');
  // Mock 402 merchant: always 402 with a 0.4-ALGO charge, then 200 on any proof.
  const server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (!req.headers['x-payment'])
        return send(402, {
          accepts: [
            { network: 'algorand-testnet', amount: '400000', payTo: 'SVC', nonce: 'n' },
          ],
        });
      return send(200, { ok: true });
    });
  });
  const base = await new Promise((r) =>
    server.listen(0, () => r(`http://127.0.0.1:${server.address().port}`)),
  );
  try {
    const owner = String(algosdk.generateAccount().addr);
    const mandate = createMandate({
      owner,
      perTxMicroAlgos: 1_000_000,
      allowlist: 'ANY',
      expiryRound: 9_999_999_999,
      network: 'algorand-testnet',
    });
    // Account stub: every pay "settles" and returns a txid.
    const account = { address: owner, pay: async () => ({ txid: 'TX' }) };
    const agent = createAgent({
      brain: async ({ history }) =>
        history.length < 5
          ? { tool: 'pay', args: { url: base + '/scan', body: {}, allowInsecure: false } }
          : { done: true, result: 'fin' },
      tools: {},
      account,
      algod: {},
      mandate,
      maxSpendMicroAlgos: 1_000_000, // budget for two 0.4-ALGO payments, not three
      maxSteps: 6,
    });
    const out = await agent.run('spend repeatedly');
    // 0.4 + 0.4 = 0.8 ok; the third (1.2 > 1.0) is refused by the aggregate cap.
    assert.equal(agent.spent, 800_000);
    assert.ok(out.history.some((h) => /aggregate spend cap/.test(h.error || '')));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('verifyPaymentProof confirms a settled payment and rejects bad ones', () => {
  const proof = { network: 'algorand-testnet', txid: 'TX1', nonce: 'n1' };
  const onchain = { receiver: 'PAYEE', amount: 500000, note: 'n1', confirmedRound: 42 };
  const expected = { payTo: 'PAYEE', minAmount: 500000, nonce: 'n1', network: 'algorand-testnet' };
  assert.equal(verifyPaymentProof(proof, onchain, expected).ok, true);
  assert.equal(
    verifyPaymentProof(proof, { ...onchain, receiver: 'ATTACKER' }, expected).reason,
    'wrong_receiver',
  );
  assert.equal(
    verifyPaymentProof(proof, { ...onchain, confirmedRound: 0 }, expected).reason,
    'not_confirmed',
  );
  assert.equal(
    verifyPaymentProof(proof, { ...onchain, note: 'different' }, expected).reason,
    'nonce_mismatch',
  );
});

test('tool errors are captured in history', async () => {
  const brain = async ({ history }) =>
    history.length === 0 ? { tool: 'boom', args: {} } : { done: true, result: 'done' };
  const agent = createAgent({
    brain,
    tools: {
      boom: async () => {
        throw new Error('kaboom');
      },
    },
  });
  const { history } = await agent.run('x');
  assert.match(history[0].error, /kaboom/);
});
