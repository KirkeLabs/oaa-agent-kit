/**
 * logicsig.js — compile a mandate into an Algorand stateless LogicSig.
 *
 * The agent's account *is* this smart signature: its address is derived from
 * the compiled program, the owner funds that address, and the chain itself
 * rejects any spend that violates the mandate — over the per-tx cap, to a
 * non-allowlisted payee, after expiry, or any rekey / close-to-attacker.
 * No server, no trust in the agent's code: the limits are consensus-enforced.
 */

import algosdk from 'algosdk';
import { ZERO_ADDR, GENESIS_HASHES } from './mandate.js';

/**
 * Render the TEAL source enforcing a mandate. Deterministic from the mandate,
 * so the agent's address is reproducible by anyone who has the mandate.
 *
 * Network distinction: the mandate's network genesis hash is baked into the
 * program as a constant, so the SAME mandate compiles to a DIFFERENT address on
 * TestNet vs MainNet. This prevents accidental cross-network address reuse (and
 * the SDK additionally refuses, via `checkPayment`, to build a transaction
 * whose genesis hash does not match the mandate's network). NOTE: stateless
 * TEAL cannot READ the genesis at runtime (there is no `txn`/`global`
 * GenesisHash field), so this is an address-level + SDK-level binding, not a
 * consensus-level one — see docs/SECURITY.md. Do not fund an agent address on a
 * network it was not generated for.
 */
export function renderMandateTeal(mandate) {
  const genesisHash = GENESIS_HASHES[mandate.network];
  if (!genesisHash) throw new Error(`no genesis hash for network: ${mandate.network}`);
  const L = [];
  L.push('#pragma version 8');
  L.push('// oaa-agent-kit mandate — auto-generated. Do not hand-edit.');

  // Bake the network genesis hash into the program (no-op at runtime) so the
  // compiled address is network-specific.
  L.push(`byte b64 ${genesisHash}`);
  L.push('pop');

  // type == pay
  L.push('txn TypeEnum');
  L.push('int pay');
  L.push('==');

  // single, non-grouped transaction (no group-bundling games)
  L.push('global GroupSize');
  L.push('int 1');
  L.push('==');
  L.push('&&');

  // amount <= perTxMicroAlgos
  L.push('txn Amount');
  L.push(`int ${mandate.perTxMicroAlgos}`);
  L.push('<=');
  L.push('&&');

  // fee <= maxFee
  L.push('txn Fee');
  L.push(`int ${mandate.maxFee}`);
  L.push('<=');
  L.push('&&');

  // lastValid <= expiryRound
  L.push('txn LastValid');
  L.push(`int ${mandate.expiryRound}`);
  L.push('<=');
  L.push('&&');

  // no rekey
  L.push('txn RekeyTo');
  L.push('global ZeroAddress');
  L.push('==');
  L.push('&&');

  // closeRemainderTo == zero OR == owner
  L.push('txn CloseRemainderTo');
  L.push('global ZeroAddress');
  L.push('==');
  L.push('txn CloseRemainderTo');
  L.push(`addr ${mandate.owner}`);
  L.push('==');
  L.push('||');
  L.push('&&');

  // receiver allowed: owner ∪ allowlist. With an EMPTY allowlist this reduces
  // to "receiver == owner" (owner-only, the safe default). The payee clause is
  // omitted ONLY for an explicit `allowlist: 'ANY'` opt-in (permissionless).
  if (!mandate.anyPayee) {
    const payees = [mandate.owner, ...mandate.allowlist];
    payees.forEach((addr, i) => {
      L.push('txn Receiver');
      L.push(`addr ${addr}`);
      L.push('==');
      if (i > 0) L.push('||');
    });
    L.push('&&');
  }

  return L.join('\n') + '\n';
}

/** Find a byte subsequence; -1 if absent. */
function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Trust-minimised structural check on a compiled program. `algod.compile` runs
 * on a REMOTE node; a malicious/MITM'd node could return a different (weaker)
 * program for the address you are about to fund. This verifies — locally, with
 * no further network calls — that the returned program is a v8 LogicSig that
 * actually embeds THIS mandate's owner key and network genesis hash. It does not
 * prove full semantic equivalence (use `verifyMandateAddress` across independent
 * nodes for that), but it catches a substituted program that doesn't bind your
 * owner/network.
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function assertMandateProgram(program, mandate) {
  const p = program instanceof Uint8Array ? program : new Uint8Array(program);
  if (p.length === 0 || p[0] !== 8) return { ok: false, reason: 'not_v8_program' };
  let ownerPk;
  try {
    ownerPk = algosdk.decodeAddress(String(mandate.owner)).publicKey;
  } catch {
    return { ok: false, reason: 'bad_owner' };
  }
  if (indexOfBytes(p, ownerPk) < 0) return { ok: false, reason: 'owner_not_in_program' };
  const gh = GENESIS_HASHES[mandate.network];
  if (!gh) return { ok: false, reason: 'unknown_network' };
  const ghBytes = new Uint8Array(Buffer.from(gh, 'base64'));
  if (indexOfBytes(p, ghBytes) < 0) return { ok: false, reason: 'genesis_not_in_program' };
  return { ok: true };
}

/**
 * Compile a mandate to a LogicSigAccount via algod. Network call. By default the
 * returned program is structurally verified against the mandate (see
 * `assertMandateProgram`); pass `{ verify: false }` to skip. The address is
 * always derived locally from the returned bytes, never taken from the node.
 * @param {algosdk.Algodv2} algod
 * @param {object} mandate
 * @param {{verify?: boolean}} [opts]
 * @returns {Promise<algosdk.LogicSigAccount>}
 */
export async function compileMandate(algod, mandate, { verify = true } = {}) {
  const teal = renderMandateTeal(mandate);
  const res = await algod.compile(teal).do();
  const program = new Uint8Array(Buffer.from(res.result, 'base64'));
  if (verify) {
    const check = assertMandateProgram(program, mandate);
    if (!check.ok) {
      const err = new Error(`MandateCompileError: ${check.reason}`);
      err.code = check.reason;
      throw err;
    }
  }
  return new algosdk.LogicSigAccount(program);
}

/** The agent's on-chain address for a mandate (requires algod to compile). */
export async function mandateAddress(algod, mandate) {
  const lsa = await compileMandate(algod, mandate);
  return lsa.address();
}

/**
 * Trust-minimised address derivation: compile the mandate on TWO OR MORE
 * INDEPENDENT algod endpoints and confirm they return byte-identical programs
 * (each also passing the structural check), so no single malicious/MITM'd node
 * can make you fund the wrong address. Use this before funding material value.
 * @param {object} mandate
 * @param {algosdk.Algodv2[]} algods independent clients (≥2 recommended)
 * @returns {Promise<{ok:true,address:string,sources:number} | {ok:false,reason:string}>}
 */
export async function verifyMandateAddress(mandate, algods) {
  if (!Array.isArray(algods) || algods.length < 2)
    return { ok: false, reason: 'need_at_least_two_independent_algods' };
  const teal = renderMandateTeal(mandate);
  let firstHex = null;
  let address = null;
  for (const algod of algods) {
    let program;
    try {
      const res = await algod.compile(teal).do();
      program = new Uint8Array(Buffer.from(res.result, 'base64'));
    } catch (e) {
      return { ok: false, reason: `compile_failed:${e.message}` };
    }
    const check = assertMandateProgram(program, mandate);
    if (!check.ok) return { ok: false, reason: check.reason };
    const hex = Buffer.from(program).toString('hex');
    if (firstHex == null) {
      firstHex = hex;
      address = String(new algosdk.LogicSigAccount(program).address());
    } else if (hex !== firstHex) {
      return { ok: false, reason: 'program_mismatch_across_nodes' };
    }
  }
  return { ok: true, address, sources: algods.length };
}

export { ZERO_ADDR };
