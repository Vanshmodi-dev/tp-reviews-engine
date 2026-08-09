/**
 * Harvest completeness — **derived from the navigator's stop reason, never from
 * counts** (VAL-01).
 *
 * This is the most consequential four-way branch in the system. Completeness is
 * the single input `absenceIsMeaningful()` reads, and that predicate decides
 * whether a review's absence starts a countdown to deleting it. Get this wrong
 * and one bad page load begins erasing a paying client's reviews.
 *
 * ## Why counts cannot be the input
 *
 * The tempting implementation is `observed >= advertised ? 'full' : 'partial'`.
 * It is wrong in both directions and the failures are silent:
 *
 * - A source under-reports its own total, so a **partial** harvest that
 *   happened to reach the stale advertised number reads as `full` — and every
 *   review the harvest missed begins a countdown to deletion.
 * - A source over-reports, or the advertised total is simply absent, so a
 *   **complete** harvest reads as `partial` forever — removals are never
 *   confirmed and tombstoning silently stops working.
 *
 * The navigator knows something a count never can: *why the loop stopped*. That
 * is the fact this module reads, and the only one.
 *
 * @module core/validate/completeness
 */

export const COMPLETENESS_VALUES = Object.freeze(['full', 'full_capped', 'partial', 'failed']);

/**
 * Stop reason to completeness. The whole module is this table.
 *
 * - `target_reached` — the loop stopped because it had everything the source
 *   said existed. Complete.
 * - `cap_reached` — the loop stopped because it hit *our own* configured
 *   ceiling, not the end of the data. `full_capped` is deliberately distinct
 *   from `full`: absence below the cap is still meaningful, but the payload is
 *   knowingly a subset, and coverage rule G-08 treats it differently.
 * - `exhausted` — the loop stopped growing having already reached 95% of the
 *   advertised total. That is a finished list, not a stuck one: the remaining
 *   gap is the source's own count being slightly stale, which it routinely is.
 *   Treating this as `partial` would be safe for deletions and fatal for
 *   removals, because tombstoning would never confirm anything again.
 * - `stalled` / `budget_exhausted` — the loop gave up mid-list. Whatever was
 *   not seen was not looked at, so absence means nothing.
 * - `error` — including a detected challenge. Nothing about this run is
 *   evidence of anything.
 */
const STOP_REASON_COMPLETENESS = Object.freeze({
  target_reached: 'full',
  exhausted: 'full',
  cap_reached: 'full_capped',
  stalled: 'partial',
  budget_exhausted: 'partial',
  error: 'failed',
});

/**
 * Classifies a harvest.
 *
 * An unrecognised stop reason yields `failed`, not `full`. Failing closed here
 * costs a delayed removal; failing open deletes reviews. A future stop reason
 * that nobody remembered to map must not silently authorise deletions.
 *
 * @param {object} report
 * @param {string} report.stop_reason One of the navigator's documented reasons.
 * @returns {string} One of {@link COMPLETENESS_VALUES}.
 */
export function classifyCompleteness(report) {
  const reason = report?.stop_reason;

  return (
    STOP_REASON_COMPLETENESS[/** @type {keyof typeof STOP_REASON_COMPLETENESS} */ (reason)] ??
    'failed'
  );
}

/**
 * Whether a completeness value permits treating absence as removal evidence.
 *
 * Duplicated from `core/model/review.mjs` deliberately? **No** — it is imported
 * there and re-exported here would be two definitions of one rule. This module
 * classifies; the model owns the predicate. Keeping them apart means there is
 * exactly one place that answers "does absence count", and it is not this file.
 *
 * @param {string} completeness
 * @returns {boolean}
 */
export function isComplete(completeness) {
  return completeness === 'full' || completeness === 'full_capped';
}
