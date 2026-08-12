/**
 * The diagnostic commands (T-172, T-173, T-175, T-176).
 *
 * Each takes its dependencies as arguments. None constructs an adapter — that
 * is `composition.mjs`'s sole job (DR-5) — and none calls `process.exit`, which
 * only `cli/index.mjs` may do (TR-CLI-003).
 *
 * @module cli/commands
 */

import { loadConfig } from '../app/config/index.mjs';
import { blocks, validateSemantics } from '../app/config/semantic.mjs';
import { byPriority, computeTargets } from '../app/registry.mjs';
import { planShards } from '../app/shard-planner.mjs';
import { EXIT } from './exit-codes.mjs';

/**
 * `tpre doctor` — reports on the environment and **fixes nothing** (REC-03).
 *
 * ## Why it deliberately repairs nothing
 *
 * A doctor that fixes what it finds is a doctor whose output cannot be trusted
 * as a description of the system. The operator reads "created the missing
 * checkout" and now has no idea whether it was missing because of a
 * misconfiguration they should understand or because the runner is ephemeral.
 * Diagnosis and repair are different acts, and conflating them is how an
 * incident gets one step further from being explicable.
 *
 * It also reports **everything**, not just the failures, because "what does a
 * healthy environment look like" is the question an operator has when the
 * output is unfamiliar.
 *
 * @param {any} deps
 * @returns {any}
 */
export function doctorCommand(deps) {
  return {
    name: 'doctor',
    summary: 'Report on the environment. Fixes nothing.',
    async run() {
      const checks = await Promise.all(
        deps.checks.map((/** @type {any} */ check) => runCheck(check)),
      );
      const failed = checks.filter((check) => check.status === 'fail');

      return {
        code: failed.length === 0 ? EXIT.OK : EXIT.USAGE,
        output: { checks, healthy: failed.length === 0 },
      };
    },
  };
}

/**
 * @param {any} check
 * @returns {Promise<any>}
 */
async function runCheck(check) {
  try {
    const result = await check.run();

    return { name: check.name, status: result.ok ? 'pass' : 'fail', detail: result.detail };
  } catch (error) {
    // A check that throws is a failed check, not a failed doctor. The whole
    // point is to report on a broken environment, and a broken environment is
    // where a check is most likely to throw.
    return {
      name: check.name,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * `tpre validate-config` — schema, semantics, and the resolution trace.
 *
 * `--explain` prints the trace: per key, which layer won and with what. Six
 * layers means the effective value of any key is the outcome of a computation
 * nobody watched, and during an incident "why does this client use a
 * three-minute timeout" must be answerable in one command.
 *
 * One invalid config fails only that client (TR-CFG-042).
 *
 * @param {any} deps
 * @returns {any}
 */
export function validateConfigCommand(deps) {
  return {
    name: 'validate-config',
    summary: 'Validate a client config and optionally explain how each value was resolved.',
    options: { explain: { type: 'boolean' }, client: { type: 'string' } },
    async run(/** @type {any} */ { flags }) {
      const clients = await deps.readClients(flags.client);
      const results = clients.map((/** @type {any} */ client) => validateOne(client, deps.env));
      const failed = results.filter((/** @type {any} */ result) => result.blocked);

      return {
        code: failed.length === 0 ? EXIT.OK : EXIT.USAGE,
        output: {
          clients: results.map((/** @type {any} */ result) =>
            flags.explain === true ? result : omitTrace(result),
          ),
          blocked: failed.map((/** @type {any} */ result) => result.slug),
        },
      };
    },
  };
}

/**
 * @param {any} client
 * @param {any} env
 * @returns {any}
 */
function validateOne(client, env) {
  const loaded = loadConfig({ client: client.config, env });
  const semantic = validateSemantics(client.config, { filename: client.filename, env });

  return {
    slug: client.config?.slug ?? client.filename,
    // A load failure and a semantic failure are different things and are
    // reported apart: the first means the config cannot be used, the second
    // means it should not be merged.
    load_errors: loaded.ok === true ? [] : loaded.errors,
    findings: semantic,
    blocked: loaded.ok !== true || blocks(semantic),
    trace: loaded.ok === true ? loaded.trace : null,
  };
}

/**
 * @param {any} result
 * @returns {any}
 */
function omitTrace(result) {
  const { trace: _trace, ...rest } = result;

  return rest;
}

/**
 * `tpre project` — rebuild payloads from the ledger, with **zero network**
 * (RB-01).
 *
 * ## Why the absence of an acquisition adapter is the point
 *
 * This is the recovery tool. When a payload is wrong, `project` regenerates it
 * from state without re-harvesting — which is only a recovery if it cannot
 * reach a source. An implementation that quietly re-harvested would turn "fix
 * the payload" into "spend budget and possibly make it worse", and would do so
 * during an incident.
 *
 * The architecture test asserts no acquisition adapter appears in this
 * command's import closure, so the guarantee is structural rather than
 * remembered.
 *
 * @param {any} deps
 * @returns {any}
 */
export function projectCommand(deps) {
  return {
    name: 'project',
    summary: 'Rebuild payloads from the ledger. Never touches the network.',
    options: { client: { type: 'string' }, listing: { type: 'string' } },
    async run(/** @type {any} */ { flags }) {
      const targets = await deps.resolveTargets(flags);
      const results = [];

      for (const target of targets) {
        const read = await deps.state.readLedger(target.clientSlug, target.listingKey);

        if (read.outcome !== 'found') {
          // An unreadable ledger is not a first publish, and `project` must not
          // invent one. See IR-25.
          results.push({ ...target, ok: false, reason: read.reason ?? 'no ledger' });
          continue;
        }

        const artifacts = deps.project({ ledger: read.value, target });
        const written = await deps.publisher.stage({ ...target, artifacts: artifacts.files });

        results.push({ ...target, ok: true, ...written });
      }

      const failed = results.filter((/** @type {any} */ result) => !result.ok);

      return {
        code: exitFor(results.length, failed.length),
        output: { targets: results },
      };
    },
  };
}

/**
 * `tpre plan` — print the due set and shard assignment, with **zero side
 * effects** (TR-APP-030).
 *
 * Its verification is that a reviewer runs it twice and diffs the output. That
 * only works if it writes nothing at all — not a ledger, not a health record,
 * not a cache entry. A planner that recorded "I planned this" would produce a
 * different answer the second time, which is exactly the property an operator
 * is using it to check.
 *
 * @param {any} deps
 * @returns {any}
 */
export function planCommand(deps) {
  return {
    name: 'plan',
    summary: 'Print the due set and shard assignment. Writes nothing.',
    options: { shard: { type: 'string' }, shards: { type: 'string' }, all: { type: 'boolean' } },
    async run(/** @type {any} */ { flags }) {
      const shards = Number(flags.shards ?? 1);
      const index = Number(flags.shard ?? 0);
      const health = (await deps.health?.()) ?? {};
      const all =
        deps.clients === undefined ? await legacyTargets(deps) : await realTargets(deps, health);
      // A target that will not run still appears under `--all`, with its reason
      // (§28.3). A client that vanishes from the plan is indistinguishable from
      // one that was never configured, and "why is this one not updating" is
      // the question the plan exists to answer.
      const due = flags.all === true ? all : all.filter((/** @type {any} */ t) => t.due !== false);
      const plan = planShards(due, shards, health);
      const mine = plan.shards[index] ?? { targets: [], cost: 0 };

      return {
        code: EXIT.OK,
        output: {
          total: due.length,
          shard: { index, of: shards, cost: mine.cost, balance: plan.balance },
          targets: mine.targets,
          ...(flags.all === true
            ? { skipped: all.filter((/** @type {any} */ t) => t.due === false) }
            : {}),
        },
      };
    },
  };
}

/**
 * The due set, computed from configuration (DEL-67).
 *
 * `now` is read here and passed in, so `app/registry.mjs` stays pure and the
 * whole command stays free of side effects — reading a clock changes nothing.
 *
 * @param {any} deps
 * @param {Record<string, any>} health
 * @returns {Promise<any[]>}
 */
async function realTargets(deps, health) {
  return byPriority(
    computeTargets({
      clients: await deps.clients(),
      now: (await deps.now?.()) ?? Date.now(),
      health,
    }),
  );
}

/**
 * The pre-PH-17 shape, kept so a caller supplying only `dueSet` still works.
 *
 * @param {any} deps
 * @returns {Promise<any[]>}
 */
async function legacyTargets(deps) {
  return (await deps.dueSet?.()) ?? [];
}

/**
 * The exit code for a run over many targets.
 *
 * Partial failure is code 4 and a CI success: some targets working is a
 * materially different situation from none working, and collapsing them would
 * make a single broken client look identical to a total outage.
 *
 * @param {number} total
 * @param {number} failed
 * @returns {number}
 */
export function exitFor(total, failed) {
  if (failed === 0) return EXIT.OK;
  if (failed === total) return EXIT.ALL_FAILED;

  return EXIT.PARTIAL;
}
