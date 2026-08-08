/**
 * Hard ceilings and floors — **compile-time constants, never config keys**
 * (T-163, TR-CFG-030, TR-CFG-031).
 *
 * ## A ceiling that can be configured is not a ceiling
 *
 * These bounds exist to stop a configuration change from turning the engine
 * into something that hammers a source, runs for an hour, or holds a browser
 * open for five minutes. If the bound itself were a key, the same pull request
 * that raised `source_hourly_budget` to 6,000 would raise its ceiling too, and
 * the review would show two numbers agreeing with each other.
 *
 * ## A breach is an error, never a clamp
 *
 * The tempting implementation clamps: `Math.min(value, ceiling)`. It is wrong,
 * and the reason is about incidents rather than correctness. An operator who
 * set `max_reviews: 6000` believes the engine is fetching 6,000 reviews. If it
 * silently fetched 5,000, every subsequent number they reason about — coverage,
 * the count drop, the gate verdict — is being compared against an intent the
 * engine quietly declined to honour, and nothing in the logs says so.
 *
 * Rejecting makes the disagreement visible at the moment it is introduced,
 * which is the only moment it is cheap.
 *
 * ## Floors exist for the same reason, pointing the other way
 *
 * `min_request_delay_ms` and `inter_target_delay_ms` have floors because the
 * failure mode of setting them too low is not a slow engine — it is a source
 * deciding this traffic is abusive, and blocking the account rather than the
 * request.
 *
 * @module app/config/limits
 */

/**
 * @typedef {object} Bound
 * @property {number} [ceiling]
 * @property {number} [floor]
 * @property {string} why  Stated so a rejection message can explain itself.
 */

/**
 * Bounds by dotted config path (TRD §8.4.2, §8.4.4, §8.4.7).
 *
 * @type {Readonly<Record<string, Bound>>}
 */
export const LIMITS = Object.freeze({
  'nav.max_reviews': Object.freeze({
    ceiling: 5000,
    why: 'a larger harvest cannot finish inside the run budget, so it would always be partial',
  }),
  'nav.scroll_timeout_ms': Object.freeze({
    ceiling: 120_000,
    why: 'a longer wait holds a browser open past the point a stall is distinguishable from a hang',
  }),
  'nav.expansion_cap': Object.freeze({
    ceiling: 1000,
    why: 'each expansion is a request; beyond this the harvest is mostly clicking',
  }),

  'reconcile.removal_confirmations': Object.freeze({
    floor: 2,
    ceiling: 10,
    why: 'below two a single unlucky harvest removes a review; above ten a real removal stays published for days',
  }),
  'reconcile.coverage_min': Object.freeze({ floor: 0.5, ceiling: 1, why: 'a ratio' }),
  'reconcile.near_duplicate_threshold': Object.freeze({
    floor: 0.8,
    ceiling: 1,
    why: 'below 0.8 distinct short reviews cluster together',
  }),

  budget_target_ms: Object.freeze({
    ceiling: 300_000,
    why: 'one target may not consume the whole run budget',
  }),
  budget_run_ms: Object.freeze({
    ceiling: 900_000,
    why: 'the scheduled workflow is killed past this, so a longer budget is a lie',
  }),
  inter_target_delay_ms: Object.freeze({
    floor: 5000,
    why: 'a shorter gap between targets reads as automated abuse from the source side',
  }),
  min_request_delay_ms: Object.freeze({
    floor: 250,
    why: 'a shorter gap between requests reads as automated abuse from the source side',
  }),
  source_hourly_budget: Object.freeze({
    ceiling: 600,
    why: 'above this the engine is the heaviest client the source has, which invites a block',
  }),
  source_daily_budget: Object.freeze({ ceiling: 6000, why: 'as above, over a day' }),
  max_parallel: Object.freeze({
    ceiling: 8,
    why: 'more concurrency multiplies the request rate a source sees from one origin',
  }),
  cadence_floor_hours: Object.freeze({
    floor: 1,
    why: 'below hourly the engine is polling, not harvesting',
  }),
});

/**
 * Checks a resolved config against every bound.
 *
 * Returns **all** violations rather than the first. An operator fixing one
 * rejection at a time across four validation runs is a morning spent on what
 * one message could have said.
 *
 * @param {Record<string, any>} config
 * @returns {{ path: string, value: number, bound: string, limit: number, why: string }[]}
 */
export function checkLimits(config) {
  const violations = [];

  for (const [path, bound] of Object.entries(LIMITS)) {
    const value = readPath(config, path);

    if (typeof value !== 'number' || Number.isNaN(value)) continue;

    if (bound.ceiling !== undefined && value > bound.ceiling) {
      violations.push({ path, value, bound: 'ceiling', limit: bound.ceiling, why: bound.why });
    }

    if (bound.floor !== undefined && value < bound.floor) {
      violations.push({ path, value, bound: 'floor', limit: bound.floor, why: bound.why });
    }
  }

  return violations;
}

/**
 * @param {Record<string, any>} source
 * @param {string} path Dotted.
 * @returns {unknown}
 */
export function readPath(source, path) {
  let current = /** @type {any} */ (source);

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }

  return current;
}

/**
 * A human-readable rejection message.
 *
 * Names the value, the bound, and **why the bound exists**. A message that says
 * only "exceeds maximum" tells an operator they are wrong without telling them
 * what they misunderstood.
 *
 * @param {{ path: string, value: number, bound: string, limit: number, why: string }} violation
 * @returns {string}
 */
export function describeViolation(violation) {
  const relation = violation.bound === 'ceiling' ? 'exceeds the ceiling' : 'is below the floor';

  return `${violation.path} is ${violation.value}, which ${relation} of ${violation.limit}: ${violation.why}`;
}
