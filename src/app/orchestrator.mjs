/**
 * The target loop (DEL-71).
 *
 * ## The one place a failure does not end the run
 *
 * Everything before this loop is fail-fast, everything inside it is
 * fail-isolated, and everything after it is best-effort with a guaranteed
 * manifest. That partition is the structural property the whole application
 * layer is arranged around.
 *
 * ## Run-budget exhaustion defers, it never fails (TR-APP-005, SCHED-03)
 *
 * When the run budget goes, the current target finishes, every remaining target
 * is marked **`deferred`**, and the process exits 4.
 *
 * Marking them `failed` is the tempting shortcut and it is wrong twice: it
 * raises alerts for targets nothing went wrong with, and it pollutes the
 * success-rate metric with a scheduling decision. `deferred` says what actually
 * happened — we ran out of time before reaching it.
 *
 * ## No conditional keyed on a client (TR-APP-007)
 *
 * Nothing in this file branches on a slug, a source, or an adapter identity.
 * Behaviour differences come from capabilities and configuration only. The
 * moment one client gets a special case here, every future change has to be
 * evaluated against a list of exceptions nobody maintains.
 *
 * @module app/orchestrator
 */

import { seededOrder } from './shard-planner.mjs';
import { notRun, runTarget } from './target-runner.mjs';

/**
 * @typedef {object} RunResult
 * @property {string} runId
 * @property {any[]} outcomes
 * @property {number} startedAt
 * @property {number} finishedAt
 * @property {boolean} budgetExhausted
 */

/**
 * Executes a shard's targets.
 *
 * @param {ReadonlyArray<any>} targets
 * @param {object} ctx
 * @param {string} ctx.runId
 * @param {() => number} ctx.now
 * @param {(target: any) => Promise<any>} ctx.stages
 * @param {(target: any) => Promise<any>} [ctx.gate]
 * @param {(ms: number) => Promise<void>} [ctx.pace]
 * @param {number} [ctx.budgetTargetMs]
 * @param {number} [ctx.budgetRunMs]
 * @param {number} [ctx.interTargetDelayMs]
 * @param {{ info: (event: string, fields?: any) => void }} [ctx.logger]
 * @returns {Promise<RunResult>}
 */
export async function runShard(targets, ctx) {
  const startedAt = ctx.now();
  // Seeded by the run id, so no client is permanently first and an ordering
  // bug is reproducible from the manifest alone (TR-APP-003).
  const ordered = seededOrder(targets, ctx.runId);
  /** @type {any[]} */
  const outcomes = [];
  let budgetExhausted = false;

  for (const [index, target] of ordered.entries()) {
    if (budgetExhausted) {
      outcomes.push(notRun(target, 'deferred', 'the run budget was spent before this target ran'));
      continue;
    }

    if (index > 0) await pace(ctx);

    outcomes.push(
      await runTarget(target, {
        now: ctx.now,
        stages: ctx.stages,
        ...(ctx.gate === undefined ? {} : { gate: ctx.gate }),
        ...(ctx.budgetTargetMs === undefined ? {} : { budgetMs: ctx.budgetTargetMs }),
        ...(ctx.logger === undefined ? {} : { logger: ctx.logger }),
      }),
    );

    // Checked AFTER the target completes, never mid-target. Aborting a target
    // halfway leaves a partial harvest that looks like a stall, and a partial
    // harvest is the one thing the absence asymmetry must never be fed by
    // accident.
    if (spent(ctx, startedAt)) {
      budgetExhausted = true;
      ctx.logger?.info?.('run.budget_exhausted', {
        completed: index + 1,
        remaining: ordered.length - index - 1,
      });
    }
  }

  return {
    runId: ctx.runId,
    outcomes,
    startedAt,
    finishedAt: ctx.now(),
    budgetExhausted,
  };
}

/**
 * @param {any} ctx
 * @param {number} startedAt
 * @returns {boolean}
 */
function spent(ctx, startedAt) {
  return typeof ctx.budgetRunMs === 'number' && ctx.now() - startedAt >= ctx.budgetRunMs;
}

/**
 * The inter-target delay.
 *
 * Applied between targets rather than before the first, so a single-target run
 * does not pay for pacing it does not need. Jitter is the pacer's business
 * (TR-SEC-003), not this loop's.
 *
 * @param {any} ctx
 * @returns {Promise<void>}
 */
async function pace(ctx) {
  const delay = ctx.interTargetDelayMs ?? 0;

  if (delay > 0 && typeof ctx.pace === 'function') await ctx.pace(delay);
}

/**
 * Every target is accounted for (TR-APP-006).
 *
 * Asserted here rather than trusted, because the failure is invisible: a run
 * that quietly dropped a target produces a manifest that looks complete and a
 * client whose site silently stops updating.
 *
 * @param {ReadonlyArray<any>} targets
 * @param {ReadonlyArray<any>} outcomes
 * @returns {string[]}
 */
export function missingOutcomes(targets, outcomes) {
  const seen = new Set(outcomes.map((outcome) => `${outcome.clientSlug}/${outcome.listingKey}`));

  return targets
    .map((target) => `${target.clientSlug}/${target.listingKey}`)
    .filter((key) => !seen.has(key));
}
