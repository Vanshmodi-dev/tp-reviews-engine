/**
 * The run manifest (DEL-72).
 *
 * ## What a manifest is for
 *
 * It is the artifact an engineer reads at 09:00 when a client says their
 * reviews look wrong. Everything in it earns its place by answering a question
 * somebody actually asks:
 *
 * - *did we try this client?* — every target appears, including deferred ones
 * - *were we allowed to?* — the preflight verdict, allow **or** deny
 * - *how complete was it?* — the stop reason, never a count
 * - *why was the shard slow?* — the cost balance and per-target durations
 *
 * ## Mostly pure
 *
 * It assembles a value from outcomes and timings. The clock and the writer
 * belong to the caller, which is what lets the manifest be asserted against a
 * schema in a unit test rather than by running a harvest.
 *
 * @module app/run-manifest
 */

import { OUTCOME_STATES } from './target-runner.mjs';

/** Manifest schema version, bumped when the shape changes. */
export const MANIFEST_VERSION = 1;

/**
 * Builds the manifest.
 *
 * @param {object} input
 * @param {string} input.runId
 * @param {string} input.generatedAt   RFC 3339. Passed; `app/` reads no clock.
 * @param {any} input.run              The `RunResult`.
 * @param {ReadonlyArray<any>} input.planned  Every target the plan contained.
 * @param {any} [input.shardPlan]
 * @param {any} [input.engine]         `{ version, packVersions }`.
 * @returns {Record<string, any>}
 */
export function buildManifest({ runId, generatedAt, run, planned, shardPlan, engine }) {
  const outcomes = run?.outcomes ?? [];

  return {
    manifest_version: MANIFEST_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    engine: engine ?? null,
    ...timings(run),
    planned_count: planned?.length ?? 0,
    counts: countStates(outcomes),
    shard: shardPlan === undefined ? null : summariseShards(shardPlan),
    targets: outcomes.map(summariseTarget),
  };
}

/**
 * @param {any} run
 * @returns {Record<string, any>}
 */
function timings(run) {
  return {
    started_at: run?.startedAt ?? null,
    finished_at: run?.finishedAt ?? null,
    duration_ms: (run?.finishedAt ?? 0) - (run?.startedAt ?? 0),
    budget_exhausted: run?.budgetExhausted === true,
  };
}

/**
 * Counts by state, with every state present at zero.
 *
 * Present-at-zero on purpose: a consumer reading `counts.deferred` must get a
 * number rather than `undefined`, and a dashboard that shows a missing key as
 * blank rather than as zero is a dashboard that hides the interesting run.
 *
 * @param {ReadonlyArray<any>} outcomes
 * @returns {Record<string, number>}
 */
function countStates(outcomes) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(OUTCOME_STATES.map((state) => [state, 0]));

  for (const outcome of outcomes) {
    counts[outcome.state] = (counts[outcome.state] ?? 0) + 1;
  }

  return counts;
}

/**
 * @param {any} outcome
 * @returns {Record<string, any>}
 */
function summariseTarget(outcome) {
  return {
    client_slug: outcome.clientSlug,
    listing_key: outcome.listingKey,
    state: outcome.state,
    code: outcome.code,
    detail: outcome.detail,
    duration_ms: outcome.durationMs,
    // TR-APP-010: recorded whether it allowed or denied.
    preflight: outcome.preflight === null ? null : summarisePreflight(outcome.preflight),
    // VAL-01: completeness comes from the stop reason. Carrying the count here
    // instead would invite a reader to infer completeness from it.
    stop_reason: outcome.report?.stopReason ?? null,
    review_count: outcome.report?.finalCount ?? null,
    growth_curve: outcome.report?.growthCurve ?? null,
  };
}

/**
 * @param {any} verdict
 * @returns {Record<string, any>}
 */
function summarisePreflight(verdict) {
  return {
    allow: verdict.allow,
    code: verdict.code ?? null,
    recorded_at: verdict.recordedAt ?? null,
    // Every check, not only the failing one. "Which checks did we actually run
    // on the day" is the question an audit asks, and a list of denials cannot
    // answer it.
    checks: (verdict.reasons ?? []).map((/** @type {any} */ reason) => ({
      check: reason.check,
      name: reason.name,
      passed: reason.passed,
      detail: reason.detail,
    })),
  };
}

/**
 * @param {any} shardPlan
 * @returns {Record<string, any>}
 */
function summariseShards(shardPlan) {
  return {
    count: shardPlan.shards?.length ?? 0,
    // Recorded rather than merely checked: a balance drifting from 1.05 to 2.4
    // as the client mix changes is a scheduling problem visible months before
    // it becomes a job timeout.
    balance: shardPlan.balance ?? null,
    total_cost: shardPlan.totalCost ?? null,
    shards: (shardPlan.shards ?? []).map((/** @type {any} */ shard) => ({
      index: shard.index,
      target_count: shard.targets.length,
      cost: shard.cost,
    })),
  };
}

/**
 * Whether the manifest accounts for the plan (TR-APP-006).
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function checkManifest(manifest) {
  /** @type {string[]} */
  const problems = [];
  const counted = Object.values(manifest.counts ?? {}).reduce(
    (/** @type {number} */ sum, /** @type {any} */ n) => sum + n,
    0,
  );

  if (counted !== manifest.planned_count) {
    problems.push(
      `the manifest accounts for ${counted} of ${manifest.planned_count} planned targets; ` +
        `a target absent from the outcome list is invisible in the incident (TR-APP-006)`,
    );
  }

  if ((manifest.targets ?? []).some((/** @type {any} */ target) => target.state === undefined)) {
    problems.push('a target has no state');
  }

  return problems;
}
