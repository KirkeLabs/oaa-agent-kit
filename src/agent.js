/**
 * agent.js — a minimal, brain-pluggable agent loop.
 *
 * You bring a `brain` (any function — rules, an LLM, whatever) and a set of
 * `tools`. The agent runs brain → tool → brain until the brain says it's done,
 * a step cap is hit, or the budget is exhausted. Paying for things is just a
 * built-in tool (`pay`) that goes through the mandate, so the agent can settle
 * x402 charges autonomously but never beyond its authority.
 *
 *   const agent = createAgent({ brain, tools, account, mandate, algod });
 *   const { result } = await agent.run('summarise https://example.com');
 *
 * brain signature:  async ({ task, history, scratch }) => ({ tool, args } | { done, result })
 * tool signature:   async (args, ctx) => any        // ctx = { pay, account, mandate, algod, log }
 */

import { payAndFetch, makeAlgorandPayer } from './x402.js';

export function createAgent({
  brain,
  tools = {},
  account,
  mandate,
  algod,
  passport,
  maxSteps = 12,
  maxSpendMicroAlgos,
  fetchPolicy = {},
  logger = () => {},
}) {
  if (typeof brain !== 'function')
    throw new Error('createAgent requires a brain function');

  // Aggregate spend cap (defence in depth). A stateless LogicSig only bounds a
  // SINGLE transaction; this caps cumulative spend (amount + fee) across the
  // whole run — most important under `allowlist:'ANY'`, where the chain does not
  // restrict payees. NOTE: this only governs spend that flows through THIS pay
  // tool / ctx.pay; a custom tool that calls account.pay or makeAlgorandPayer
  // directly bypasses it. The on-chain aggregate ceiling is the funded balance
  // (or an AllowanceApp). Do not pass `account` to untrusted tools.
  let spent = 0;
  const feePerTx = mandate ? Number(mandate.maxFee || 0) : 0;

  // Built-in tool: pay-and-fetch an OAA/x402 resource within the mandate.
  // fetchPolicy (allowInsecure, allowedHosts, timeoutMs, maxBytes,
  // maxAmountMicroAlgos) is forwarded to payAndFetch — set allowedHosts when the
  // brain is untrusted so it cannot point payments at arbitrary/internal hosts.
  const payTool = async ({ url, method, body }) => {
    const basePayer =
      account && algod && mandate
        ? makeAlgorandPayer({ algod, account, mandate })
        : undefined;
    const payer = basePayer
      ? async (req) => {
          const amt = (Number(req.amount) || 0) + feePerTx; // count fees too
          if (maxSpendMicroAlgos != null && spent + amt > maxSpendMicroAlgos) {
            throw new Error(
              `Refusing 402: aggregate spend cap exceeded ` +
                `(${spent}+${amt} > ${maxSpendMicroAlgos} microALGO, incl. fees)`,
            );
          }
          const txid = await basePayer(req);
          spent += amt;
          return txid;
        }
      : undefined;
    return payAndFetch(url, { payer, method, body, passport, ...fetchPolicy });
  };

  const allTools = { pay: payTool, ...tools };

  async function run(task) {
    const history = [];
    const scratch = {};
    for (let step = 0; step < maxSteps; step++) {
      const action = await brain({ task, history, scratch });
      if (!action || action.done) {
        logger({ type: 'done', step, result: action?.result });
        return { result: action?.result, history, steps: step };
      }
      const tool = allTools[action.tool];
      if (!tool) {
        history.push({ tool: action.tool, error: 'unknown_tool' });
        logger({ type: 'error', step, tool: action.tool, error: 'unknown_tool' });
        continue;
      }
      try {
        const out = await tool(action.args || {}, {
          pay: payTool,
          account,
          mandate,
          algod,
          passport,
          log: logger,
        });
        history.push({ tool: action.tool, args: action.args, out });
        logger({ type: 'tool', step, tool: action.tool, ok: true });
      } catch (e) {
        history.push({ tool: action.tool, args: action.args, error: e.message });
        logger({ type: 'tool', step, tool: action.tool, ok: false, error: e.message });
      }
    }
    return { result: undefined, history, steps: maxSteps, stopped: 'max_steps' };
  }

  return {
    run,
    tools: allTools,
    get spent() {
      return spent;
    },
  };
}
