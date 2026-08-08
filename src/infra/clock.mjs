/**
 * The system clock (T-128).
 *
 * The only place in the engine that reads the real time. Everything else takes
 * an instant as a parameter or a `ClockPort` as a dependency, which is what
 * makes DR-2 mechanically enforceable rather than a convention (C-30).
 *
 * @module infra/clock
 */

/**
 * @returns {import('../ports/clock.mjs').ClockPort}
 */
export function createSystemClock() {
  return {
    nowMs: () => Date.now(),
    now: () => new Date(),
    nowIso: () => new Date().toISOString(),
  };
}
