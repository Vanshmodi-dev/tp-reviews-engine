/**
 * ALG-PAGINATE's stop conditions, as pure arithmetic (§19.3, §19.4).
 *
 * ## Why the decision is separated from the scrolling
 *
 * Scrolling needs a browser. Deciding *whether to stop, and why* needs two
 * numbers and a clock reading. Keeping them apart means every stop reason —
 * including the ones that only occur on a five-thousand-review listing at the
 * end of a two-minute budget — is testable exhaustively in milliseconds.
 *
 * It also puts the part that matters most where it can be read. TR-NAV-001:
 * **the stop reason is a first-class output emitted at the point of stopping.**
 * Completeness classification depends entirely on it, and inferring it later
 * from counts is precisely how a stalled harvest gets classified `full` and
 * starts deleting a client's reviews.
 *
 * ## The evaluation ORDER is normative
 *
 * §19.4 lists the conditions in order and says the order matters. `cap_reached`
 * is checked before `target_reached` because a harvest that hit our own ceiling
 * is `full_capped`, not `full` — the difference decides whether a count drop
 * below the cap is measured against the cap or against the advertised total.
 *
 * Reordering these two produces a system that publishes correctly and reconciles
 * wrongly, which is the worst combination available.
 *
 * ## `exhausted` is not `stalled` (TR-NAV-021)
 *
 * Both mean "no new records appeared". They differ in one clause: `exhausted`
 * additionally requires the count to have reached 95% of the advertised total.
 *
 * Without that distinction, a listing whose advertised total is stale or simply
 * absent stops growing, is classified `stalled`, and therefore `partial` —
 * forever. Removals are never confirmed and tombstoning silently stops working,
 * which is the exact failure `core/validate/completeness.mjs` warns about in
 * its own header.
 *
 * @module adapters/acquisition/google-dom/pagination
 */

/** How close to the advertised total counts as having seen everything. */
export const EXHAUSTED_RATIO = 0.95;

/** Default consecutive no-growth iterations before declaring a stall. */
export const DEFAULT_STALL_THRESHOLD = 3;

/** First wait after a no-growth iteration, in milliseconds. */
export const BASE_SETTLE_MS = 900;

/** For rendering EXHAUSTED_RATIO as a percentage in the stop detail. */
const AS_PERCENT = 100;

/**
 * Floor and ceiling for the scroll ratio.
 *
 * A ratio at or near zero scrolls nowhere and pagination never terminates
 * except by budget; above one it jumps past the virtualisation window, which is
 * the absolute-bottom failure EDR-013 exists to prevent.
 */
const MIN_SCROLL_RATIO = 0.1;
const MAX_SCROLL_RATIO = 1;

/**
 * Backoff before re-checking after a no-growth iteration (TR-NAV-020).
 *
 * 900 ms, 1800 ms, 3600 ms. Increasing, because a stall declared after three
 * immediate re-scrolls is a stall declared about the network rather than about
 * the source — and a false `stalled` marks a complete harvest `partial`, which
 * stops removals being confirmed.
 *
 * @param {number} consecutiveQuiet  1 for the first quiet iteration.
 * @returns {number}
 */
export function backoffFor(consecutiveQuiet) {
  const step = Math.max(0, consecutiveQuiet - 1);

  return BASE_SETTLE_MS * 2 ** step;
}

/**
 * @typedef {object} PaginationState
 * @property {number[]} growthCurve   Count after every iteration, oldest first.
 * @property {number} elapsedMs
 * @property {number | null} advertisedTotal
 */

/**
 * @typedef {object} PaginationLimits
 * @property {number} maxReviews
 * @property {number} paginationBudgetMs
 * @property {number} [stallThreshold]
 */

/**
 * @typedef {object} StopDecision
 * @property {boolean} stop
 * @property {string | null} reason
 * @property {string} detail  Why, in words, for the acquisition report.
 */

/**
 * How many trailing iterations produced no growth.
 *
 * @param {ReadonlyArray<number>} curve
 * @returns {number}
 */
export function quietIterations(curve) {
  let quiet = 0;

  for (let index = curve.length - 1; index > 0; index -= 1) {
    if (curve[index] !== curve[index - 1]) break;

    quiet += 1;
  }

  return quiet;
}

/**
 * Evaluates the stop conditions in the normative order.
 *
 * @param {PaginationState} state
 * @param {PaginationLimits} limits
 * @returns {StopDecision}
 */
export function evaluateStop(state, limits) {
  const curve = state.growthCurve;
  const count = curve.length === 0 ? 0 : /** @type {number} */ (curve[curve.length - 1]);
  const advertised = state.advertisedTotal;

  // 1. Our own ceiling, checked FIRST. A capped harvest that also happens to
  //    equal the advertised total is still capped: we stopped because of a
  //    configuration choice, and the reconciler must measure count drops
  //    against the cap rather than against the source's total.
  if (count >= limits.maxReviews) {
    return stop('cap_reached', `reached the configured cap of ${limits.maxReviews}`);
  }

  // 2. Everything the source says exists.
  if (advertised !== null && advertised > 0 && count >= advertised) {
    return stop('target_reached', `reached the advertised total of ${advertised}`);
  }

  const quiet = quietIterations(curve);

  // 3. No growth. Which of the two no-growth reasons it is depends entirely on
  //    how close we got — and that single clause is the difference between a
  //    harvest whose absences count and one whose absences mean nothing.
  if (quiet >= (limits.stallThreshold ?? DEFAULT_STALL_THRESHOLD)) {
    return classifyNoGrowth(count, advertised, quiet);
  }

  // 4. Time. Checked after the growth conditions so that a harvest which
  //    finished on its final iteration is not reported as having run out of
  //    budget on the same tick.
  if (state.elapsedMs >= limits.paginationBudgetMs) {
    return stop(
      'budget_exhausted',
      `pagination budget of ${limits.paginationBudgetMs}ms spent at ${count} records`,
    );
  }

  return { stop: false, reason: null, detail: 'still growing' };
}

/**
 * Which of the two no-growth reasons applies (TR-NAV-021).
 *
 * @param {number} count
 * @param {number | null} advertised
 * @param {number} quiet
 * @returns {StopDecision}
 */
function classifyNoGrowth(count, advertised, quiet) {
  const comparable = advertised !== null && advertised > 0;

  if (comparable && count >= /** @type {number} */ (advertised) * EXHAUSTED_RATIO) {
    return stop(
      'exhausted',
      `no growth for ${quiet} iterations at ${count} of ${advertised} advertised, ` +
        `which is within ${EXHAUSTED_RATIO * AS_PERCENT}% — the list is finished, not stuck`,
    );
  }

  return stop(
    'stalled',
    `no growth for ${quiet} iterations at ${count}` +
      (comparable
        ? ` of ${advertised} advertised`
        : ', with no advertised total to compare against'),
  );
}

/**
 * @param {string} reason
 * @param {string} detail
 * @returns {StopDecision}
 */
function stop(reason, detail) {
  return { stop: true, reason, detail };
}

/**
 * The scroll distance for one iteration (EDR-013).
 *
 * A ratio of the container height, **never the absolute bottom**. Jumping to
 * the bottom is faster and skips records: past the virtualisation window the
 * intervening rows are never materialised, so the harvest silently returns
 * fewer reviews than exist. That is a correctness failure disguised as a
 * performance win, and it produces no error of any kind.
 *
 * @param {number} containerHeight
 * @param {number} [ratio]
 * @returns {number}
 */
export function scrollStep(containerHeight, ratio = 0.9) {
  const bounded = Math.min(Math.max(ratio, MIN_SCROLL_RATIO), MAX_SCROLL_RATIO);

  return Math.max(1, Math.floor(containerHeight * bounded));
}
