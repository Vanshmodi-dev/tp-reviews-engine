/**
 * Rate budget accounting (T-140, RETRY-04, EDR-034).
 *
 * ============================================================================
 * ACCOUNTING IS PESSIMISTIC: A REQUEST IS COUNTED **BEFORE** IT IS MADE.
 * ============================================================================
 *
 * ## Why the obvious ordering is wrong
 *
 * The natural implementation counts a request after it completes, because then
 * a request that failed to send does not consume budget. It is wrong, and the
 * failure is asymmetric in a way that matters:
 *
 * - **Count after:** a crash between sending and recording loses the record of
 *   a request that the source definitely saw. The engine now believes it has
 *   more budget than it does, and the next run spends it. Under-counting
 *   compounds — every crash widens the gap — and the thing at the other end of
 *   the gap is a platform deciding we are abusing it.
 * - **Count before:** a crash between recording and sending charges us for a
 *   request that never happened. We do slightly less work than we were entitled
 *   to.
 *
 * One error mode costs a few wasted slots. The other costs the client's access
 * to their own reviews. So the counter is written first, and this module fails
 * **closed**: if the budget cannot be read, no request is permitted.
 *
 * ## Windows are calendar-aligned, not rolling
 *
 * Hourly and daily counters key on the UTC hour and UTC day. A rolling window
 * needs the timestamp of every request retained, which is state proportional to
 * traffic; calendar alignment needs two integers. The cost is a boundary effect
 * — a burst at 10:59 and another at 11:01 both fit — and that is acceptable
 * because the budgets are set well below any published limit precisely so the
 * boundary case is still safe.
 *
 * State is pure here. Persistence is the caller's, through `StatePort`.
 *
 * @module infra/limiter/token-bucket
 */

/**
 * @typedef {object} BudgetState
 * @property {string} hourKey    UTC hour this counter belongs to.
 * @property {number} hourCount
 * @property {string} dayKey     UTC day this counter belongs to.
 * @property {number} dayCount
 */

/**
 * @typedef {object} BudgetLimits
 * @property {number} perHour
 * @property {number} perDay
 */

/** `YYYY-MM-DDTHH` — an RFC 3339 timestamp truncated to the UTC hour. */
const HOUR_KEY_LENGTH = 13;

/** `YYYY-MM-DD` — truncated to the UTC day. */
const DAY_KEY_LENGTH = 10;

/**
 * @param {string} now RFC 3339.
 * @returns {string}
 */
export function hourKeyOf(now) {
  return now.slice(0, HOUR_KEY_LENGTH);
}

/**
 * @param {string} now RFC 3339.
 * @returns {string}
 */
export function dayKeyOf(now) {
  return now.slice(0, DAY_KEY_LENGTH);
}

/**
 * An empty budget for the window containing `now`.
 *
 * @param {string} now RFC 3339.
 * @returns {BudgetState}
 */
export function emptyBudget(now) {
  return Object.freeze({
    hourKey: hourKeyOf(now),
    hourCount: 0,
    dayKey: dayKeyOf(now),
    dayCount: 0,
  });
}

/**
 * Rolls counters whose window has passed.
 *
 * Separate from the spend so that a caller can ask "what is the state of the
 * budget right now" without spending any of it — which is what a status command
 * and a dry run both need.
 *
 * @param {BudgetState} current
 * @param {string} now RFC 3339.
 * @returns {BudgetState}
 */
export function rollWindows(current, now) {
  const hourKey = hourKeyOf(now);
  const dayKey = dayKeyOf(now);

  return Object.freeze({
    hourKey,
    hourCount: current.hourKey === hourKey ? current.hourCount : 0,
    dayKey,
    dayCount: current.dayKey === dayKey ? current.dayCount : 0,
  });
}

/**
 * Whether one more request fits, and the state to persist **before** making it.
 *
 * Returns the next state rather than mutating, so the caller can write it and
 * only then send. That ordering is the whole of EDR-034.
 *
 * @param {BudgetState} current
 * @param {BudgetLimits} limits
 * @param {string} now RFC 3339.
 * @returns {{ allowed: boolean, next: BudgetState, reason: string }}
 */
export function reserve(current, limits, now) {
  const rolled = rollWindows(current, now);

  if (rolled.hourCount >= limits.perHour) {
    return { allowed: false, next: rolled, reason: `hourly budget of ${limits.perHour} exhausted` };
  }

  if (rolled.dayCount >= limits.perDay) {
    return { allowed: false, next: rolled, reason: `daily budget of ${limits.perDay} exhausted` };
  }

  return {
    allowed: true,
    next: Object.freeze({
      ...rolled,
      hourCount: rolled.hourCount + 1,
      dayCount: rolled.dayCount + 1,
    }),
    reason: 'within budget',
  };
}

/**
 * What remains in each window.
 *
 * Never negative. A budget that reads `-3` after a limit was lowered mid-day
 * would render as nonsense in a status output; zero says the same thing and is
 * true.
 *
 * @param {BudgetState} current
 * @param {BudgetLimits} limits
 * @param {string} now RFC 3339.
 * @returns {{ hour: number, day: number }}
 */
export function remaining(current, limits, now) {
  const rolled = rollWindows(current, now);

  return {
    hour: Math.max(0, limits.perHour - rolled.hourCount),
    day: Math.max(0, limits.perDay - rolled.dayCount),
  };
}

/**
 * Whether a budget state is usable.
 *
 * A caller that cannot read or validate its budget MUST NOT proceed — failing
 * closed is the entire point. This exists so "the state file was corrupt" and
 * "the budget is exhausted" produce the same outcome at the call site.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUsableBudget(value) {
  if (value === null || typeof value !== 'object') return false;

  const budget = /** @type {Record<string, unknown>} */ (value);

  return (
    typeof budget.hourKey === 'string' &&
    typeof budget.dayKey === 'string' &&
    Number.isInteger(budget.hourCount) &&
    Number.isInteger(budget.dayCount) &&
    /** @type {number} */ (budget.hourCount) >= 0 &&
    /** @type {number} */ (budget.dayCount) >= 0
  );
}
