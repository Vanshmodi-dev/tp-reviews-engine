/**
 * A deterministic clock (TR-TEST-032).
 *
 * Every test uses this. `core/` may not read the system clock (DR-2), so the
 * instant always arrives as an argument - and a test that reads the real clock
 * is a test that fails on a Tuesday, in February, in a leap year.
 *
 * Written in PH-00, before `ClockPort` exists as an interface in PH-07. That is
 * deliberate (IMPL PLAN 21.3): the helper establishes the shape the port must
 * satisfy from the test's point of view, which is the point of view that
 * matters for determinism. The port file documents what this already fixed.
 */

/**
 * @typedef {object} FixedClock
 * @property {() => number} nowMs      Milliseconds since the epoch. Never moves on its own.
 * @property {() => Date} now          The same instant as a Date.
 * @property {() => string} nowIso     The same instant as an ISO-8601 string.
 * @property {(ms: number) => void} advance   Moves the clock forward, explicitly.
 * @property {(instant: number | string | Date) => void} set  Jumps the clock to an instant.
 */

/**
 * Normalises any accepted instant form to epoch milliseconds.
 *
 * @param {number | string | Date} instant
 * @returns {number}
 */
function toEpochMs(instant) {
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();

  if (Number.isNaN(ms)) {
    throw new TypeError(`fixed-clock: not a valid instant: ${String(instant)}`);
  }
  return ms;
}

/**
 * Creates a clock pinned to `instant` that advances only when told to.
 *
 * @param {number | string | Date} [instant] Defaults to a fixed, arbitrary,
 *   deliberately unremarkable date so that a test which forgets to pass one
 *   still behaves identically on every machine and every run.
 * @returns {FixedClock}
 */
export function createFixedClock(instant = '2026-01-01T00:00:00.000Z') {
  let currentMs = toEpochMs(instant);

  return {
    nowMs: () => currentMs,
    now: () => new Date(currentMs),
    nowIso: () => new Date(currentMs).toISOString(),

    advance(ms) {
      if (!Number.isFinite(ms)) {
        throw new TypeError(`fixed-clock: advance needs a finite number, got ${String(ms)}`);
      }
      if (ms < 0) {
        // Time not moving is realistic. Time moving backwards is a test that
        // will pass for a reason its author did not intend.
        throw new RangeError('fixed-clock: advance cannot be negative. Use set() to jump.');
      }
      currentMs += ms;
    },

    set(next) {
      currentMs = toEpochMs(next);
    },
  };
}
