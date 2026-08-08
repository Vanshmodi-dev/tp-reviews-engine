/**
 * `ClockPort` — the only way anything reads the current time.
 *
 * ## Why a port for something this small
 *
 * `Date.now()` is one call. Wrapping it looks like ceremony until the first
 * intermittent property-test failure, and then it is the difference between a
 * bug you can reproduce and one you cannot.
 *
 * `core/` may not read a clock at all (DR-2): every function that needs an
 * instant takes one as a parameter. This port exists so the *edge* has a single
 * seam too — the composition root injects a system clock in production and a
 * fixed clock in tests, and no module below it can tell or care.
 *
 * The cost is about twenty lines. What it buys is that "the core is pure" stops
 * being a convention maintained by review and becomes a fact enforced by an
 * architecture test.
 *
 * **This file declares. It does not implement.** See `infra/clock.mjs`.
 *
 * @module ports/clock
 */

/**
 * @typedef {object} ClockPort
 * @property {() => number} nowMs   Milliseconds since the Unix epoch.
 * @property {() => Date} now       The same instant as a `Date`.
 * @property {() => string} nowIso  The same instant as an RFC 3339 UTC string.
 */

export {};
