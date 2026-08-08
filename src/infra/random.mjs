/**
 * The system random source (T-129).
 *
 * ## Not cryptographic, and the distinction is load-bearing
 *
 * `Math.random()` is fine for retry jitter, which is what this exists for:
 * spreading concurrent retries so a recovering source is not hit by every shard
 * at the same instant. It is **not** fine for anything an attacker benefits from
 * predicting — a token, a nonce, a secret. `node:crypto` covers that, and
 * `core/util/hash.mjs` is where the engine reaches for it.
 *
 * The rule is stated here rather than left implicit because the two needs look
 * identical at the call site and only one of them fails visibly.
 *
 * @module infra/random
 */

/**
 * @returns {import('../ports/random.mjs').RandomPort}
 */
export function createSystemRandom() {
  return {
    next: () => Math.random(),
    intBetween: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
  };
}
