import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/index.js';

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
