/**
 * The circuit breaker (T-139).
 *
 * `closed → open → half-open`, per source-access pair, with an escalating
 * cooldown, persisted to `state`.
 *
 * ## What it is actually protecting
 *
 * Not this engine. The source, and the client's standing with it.
 *
 * A cadence-driven system that keeps harvesting a source which is rejecting it
 * looks, from the source's side, exactly like an attack — and the escalation
 * that follows is not a slower response, it is a harder block, applied to the
 * account or the IP range rather than the request. The recovery from that is a
 * conversation with a platform, not a code change.
 *
 * So the breaker fails **towards not trying**, and its cooldown grows rather
 * than repeating: a source that is still refusing after one cooldown is not
 * going to be persuaded by the same interval again.
 *
 * ## Per source-access pair
 *
 * Keyed by source *and* access method, because `google:api` being rate-limited
 * says nothing about `google:dom`, and tripping both on one signal would take
 * out a working path along with a broken one.
 *
 * ## State is pure; persistence is the caller's job
 *
 * Every function here takes the current state and returns the next one. Nothing
 * reads a clock or a file. That is what makes the transitions testable without
 * a filesystem, and what lets `state` hold the breaker across runs — a breaker
 * that forgot everything when the process exited would reopen the circuit on
 * every scheduled run, which is the same as not having one.
 *
 * @module infra/breaker/circuit
 */

/** The three states. `half_open` admits exactly one trial request. */
export const BREAKER_STATES = Object.freeze(['closed', 'open', 'half_open']);

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;

/** Fifteen minutes: longer than a transient fault, shorter than the cadence. */
const DEFAULT_COOLDOWN_MINUTES = 15;

/** Six hours: one full cadence interval, so every source gets a daily attempt. */
const MAX_COOLDOWN_HOURS = 6;

/** Consecutive failures before the circuit opens. */
export const DEFAULT_FAILURE_THRESHOLD = 5;

/**
 * First cooldown. Doubles on each subsequent trip.
 *
 * Fifteen minutes is longer than any transient network fault and shorter than
 * the six-hour harvest cadence, so a source that recovers quickly is retried
 * within the same run window rather than skipped entirely.
 */
export const DEFAULT_COOLDOWN_MS = DEFAULT_COOLDOWN_MINUTES * MINUTE_MS;

/**
 * The cooldown never grows past this.
 *
 * Uncapped doubling reaches a week after ten trips, which means a source that
 * had a bad morning is still muted on Friday. Six hours is one full cadence
 * interval: the longest pause that still gives every source one attempt per day.
 */
export const MAX_COOLDOWN_MS = MAX_COOLDOWN_HOURS * HOUR_MS;

/**
 * @typedef {object} BreakerState
 * @property {string} state           One of {@link BREAKER_STATES}.
 * @property {number} failures        Consecutive failures in the current window.
 * @property {number} trips           How many times this circuit has opened. Drives escalation.
 * @property {string | null} openedAt RFC 3339.
 * @property {string | null} retryAt  RFC 3339. When a trial request is permitted.
 */

/**
 * @typedef {object} BreakerPolicy
 * @property {number} [failureThreshold]
 * @property {number} [cooldownMs]
 * @property {number} [maxCooldownMs]
 */

/**
 * A closed circuit, which is where every source starts.
 *
 * @returns {BreakerState}
 */
export function closedBreaker() {
  return Object.freeze({ state: 'closed', failures: 0, trips: 0, openedAt: null, retryAt: null });
}

/**
 * The cooldown for the nth trip.
 *
 * Doubling, capped. Uncapped doubling reaches a week after ten trips, which
 * means a source that had a bad morning is still muted on Friday.
 *
 * @param {number} trips 1-based.
 * @param {BreakerPolicy} [policy]
 * @returns {number}
 */
export function cooldownFor(trips, policy = {}) {
  const base = policy.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const ceiling = policy.maxCooldownMs ?? MAX_COOLDOWN_MS;

  return Math.min(base * 2 ** Math.max(0, trips - 1), ceiling);
}

/**
 * Records a failure.
 *
 * A failure in `half_open` reopens immediately and escalates, without waiting
 * to accumulate a threshold again. The trial request already answered the
 * question the threshold exists to ask.
 *
 * @param {BreakerState} current
 * @param {string} now RFC 3339.
 * @param {BreakerPolicy} [policy]
 * @returns {BreakerState}
 */
export function recordFailure(current, now, policy = {}) {
  const threshold = policy.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;

  if (current.state === 'half_open') return trip(current, now, policy);

  const failures = current.failures + 1;

  if (failures >= threshold) return trip({ ...current, failures }, now, policy);

  return Object.freeze({ ...current, failures });
}

/**
 * @param {BreakerState} current
 * @param {string} now
 * @param {BreakerPolicy} policy
 * @returns {BreakerState}
 */
function trip(current, now, policy) {
  const trips = current.trips + 1;

  return Object.freeze({
    state: 'open',
    failures: 0,
    trips,
    openedAt: now,
    retryAt: new Date(Date.parse(now) + cooldownFor(trips, policy)).toISOString(),
  });
}

/**
 * Records a success.
 *
 * A success in `half_open` closes the circuit and clears the failure count, but
 * **`trips` is deliberately preserved**. A source that has tripped four times
 * before is not the same risk as one that has never tripped, and resetting the
 * escalation on every recovery produces a circuit that flaps at the shortest
 * cooldown forever.
 *
 * @param {BreakerState} current
 * @returns {BreakerState}
 */
export function recordSuccess(current) {
  return Object.freeze({
    state: 'closed',
    failures: 0,
    trips: current.trips,
    openedAt: null,
    retryAt: null,
  });
}

/**
 * Whether a request may proceed, and the state to persist if it may.
 *
 * Returns the transition rather than mutating, so the caller writes the
 * `half_open` state **before** making the trial request. Writing it after would
 * let a crash during the trial leave the circuit open with its cooldown already
 * elapsed, admitting an unbounded number of trials on the next run.
 *
 * @param {BreakerState} current
 * @param {string} now RFC 3339.
 * @returns {{ allowed: boolean, next: BreakerState, reason: string }}
 */
export function admits(current, now) {
  if (current.state === 'closed') {
    return { allowed: true, next: current, reason: 'circuit closed' };
  }

  if (current.state === 'half_open') {
    // One trial at a time. A second concurrent request would turn the probe
    // into the very burst the breaker exists to prevent.
    return { allowed: false, next: current, reason: 'a trial request is already in flight' };
  }

  if (current.retryAt !== null && Date.parse(now) >= Date.parse(current.retryAt)) {
    return {
      allowed: true,
      next: Object.freeze({ ...current, state: 'half_open' }),
      reason: 'cooldown elapsed; admitting one trial request',
    };
  }

  return { allowed: false, next: current, reason: `circuit open until ${current.retryAt}` };
}

/**
 * The `state`-branch key for a source-access pair.
 *
 * @param {string} source
 * @param {string} access
 * @returns {string}
 */
export function breakerKey(source, access) {
  return `${source}:${access}`;
}
