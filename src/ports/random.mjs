/**
 * `RandomPort` — the only way anything draws a random number.
 *
 * Retry jitter, sampling, and any future shuffling draw from here. `core/` may
 * not call `Math.random()` (DR-2), and the edge injects a seeded generator in
 * tests so a failure is reproducible from the seed alone.
 *
 * **Not cryptographic.** Nothing here may be used to generate a token, a
 * nonce, or anything an attacker benefits from predicting; `node:crypto` covers
 * that need. The distinction is stated in the port rather than left to the
 * implementation, because a caller reads the interface and not the source.
 *
 * **This file declares. It does not implement.** See `infra/random.mjs`.
 *
 * @module ports/random
 */

/**
 * @typedef {object} RandomPort
 * @property {() => number} next            Uniform in [0, 1).
 * @property {(min: number, max: number) => number} intBetween  Uniform integer, inclusive.
 */

export {};
