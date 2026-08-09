/**
 * The six timeout budgets and the relationships between them (EDR-028).
 *
 * ## The engine must always be the thing that stops
 *
 * A platform-level job cancellation produces no manifest, no flushed logs, no
 * diagnostics, and no health record. It converts a ten-minute investigation
 * into a guess. Every budget here exists so that something *inside* the engine
 * fires first and leaves evidence.
 *
 * TR-BRW-020: no timeout in the browser layer may be left infinite or unset.
 * "Unset" in Playwright means 30 seconds for some APIs and forever for others,
 * which is the worst of both — a default nobody chose and nobody remembers.
 *
 * ## Why the naive chain is WRONG
 *
 * "Six levels, each strictly inside the next" reads like
 * `t1 < t2 < t3 < t4 < t5 < t6`, and a test asserting that fails immediately on
 * the documented values: navigation is 30 s and the surface wait is **15 s**.
 *
 * That is deliberate (§29.2). Navigation and the surface wait are *siblings*
 * within a target, not nested in one another — and a review surface that has
 * not appeared fifteen seconds after the page settled is not going to appear.
 * Waiting the full navigation budget for it just burns half a minute per target
 * before reporting the same failure.
 *
 * So the constraint is a graph, not a chain, and it is written out below. The
 * "fix" a naive test would push you toward — raising the surface wait above the
 * navigation timeout — makes every selector break cost twice as long to detect.
 *
 * @module adapters/browser/timeouts
 */

/**
 * How much of the navigation budget a single action may take.
 *
 * Level 1 is "derived" in §29.2 rather than configured, because an action
 * timeout large enough to matter is a navigation problem wearing a smaller hat.
 */
const ACTION_FRACTION = 6;

/** The documented defaults (§29.2). Overridden by `nav.*` config. */
export const DEFAULT_BUDGETS = Object.freeze({
  navigation_timeout_ms: 30_000,
  surface_timeout_ms: 15_000,
  pagination_budget_ms: 120_000,
  budget_target_ms: 300_000,
  budget_run_ms: 900_000,
});

/**
 * The containment constraints, as data.
 *
 * Written as pairs rather than as a sorted list precisely because the ordering
 * is not total. `[inner, outer]` means the inner budget must fire first.
 */
export const CONSTRAINTS = Object.freeze([
  ['action_timeout_ms', 'navigation_timeout_ms'],
  ['navigation_timeout_ms', 'pagination_budget_ms'],
  ['surface_timeout_ms', 'pagination_budget_ms'],
  ['pagination_budget_ms', 'budget_target_ms'],
  ['budget_target_ms', 'budget_run_ms'],
]);

/**
 * @typedef {object} Budgets
 * @property {number} action_timeout_ms
 * @property {number} navigation_timeout_ms
 * @property {number} surface_timeout_ms
 * @property {number} pagination_budget_ms
 * @property {number} budget_target_ms
 * @property {number} budget_run_ms
 */

/**
 * Resolves the six budgets from configuration.
 *
 * @param {Record<string, any>} [nav]     The `nav` config block.
 * @param {Record<string, any>} [publish] Where the target and run ceilings live.
 * @returns {Budgets}
 */
export function resolveBudgets(nav = {}, publish = {}) {
  const navigation = numberOr(nav['navigation_timeout_ms'], DEFAULT_BUDGETS.navigation_timeout_ms);

  return {
    action_timeout_ms: Math.floor(navigation / ACTION_FRACTION),
    navigation_timeout_ms: navigation,
    surface_timeout_ms: numberOr(nav['surface_timeout_ms'], DEFAULT_BUDGETS.surface_timeout_ms),
    pagination_budget_ms: numberOr(
      nav['pagination_budget_ms'],
      DEFAULT_BUDGETS.pagination_budget_ms,
    ),
    budget_target_ms: numberOr(publish['budget_target_ms'], DEFAULT_BUDGETS.budget_target_ms),
    budget_run_ms: numberOr(publish['budget_run_ms'], DEFAULT_BUDGETS.budget_run_ms),
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Every violated containment constraint.
 *
 * Returns problems rather than throwing so the config loader can report all of
 * them at once — an operator who lowered `budget_target_ms` has usually broken
 * two relationships, not one.
 *
 * @param {Budgets} budgets
 * @returns {string[]}
 */
export function checkNesting(budgets) {
  /** @type {string[]} */
  const problems = [];

  for (const [inner, outer] of CONSTRAINTS) {
    const innerValue = budgets[/** @type {keyof Budgets} */ (inner)];
    const outerValue = budgets[/** @type {keyof Budgets} */ (outer)];

    if (!Number.isFinite(innerValue) || innerValue <= 0) {
      problems.push(`${inner} must be a positive number of milliseconds, never unset or infinite`);
      continue;
    }

    if (innerValue < outerValue) continue;

    problems.push(
      `${inner} (${innerValue}ms) must fire before ${outer} (${outerValue}ms); ` +
        `an outer budget that fires first destroys the diagnostic — the engine reports ` +
        `"the target timed out" when the answer was "navigation hung" (EDR-028)`,
    );
  }

  return problems;
}
