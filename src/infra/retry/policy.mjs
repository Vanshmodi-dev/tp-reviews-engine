/**
 * Retry policy as a lookup table keyed by error class (T-136, RETRY-01).
 *
 * ## Why this file imports nothing from `core/`
 *
 * It tried to. The architecture rule stopped it, and the rule is right:
 * `infra/` is domain-ignorant technical infrastructure, and a module that
 * imports the review engine's error taxonomy is not infrastructure — it is the
 * engine, filed in the wrong drawer. The next thing it would import is the
 * ledger.
 *
 * So the mechanism lives here and the **data is injected**. The taxonomy in
 * `core/model/errors.mjs` already carries a retry policy on every class,
 * transcribed from SAD Appendix B's `R` column; the composition root hands that
 * table to `createRetryPolicy` and this module never learns what an `ERR-` code
 * means.
 *
 * That also keeps the table in exactly one place. Two copies of a retry policy
 * is how one of them acquires a retry on a blocked class during a bad
 * afternoon, and the whole point of INV-07 is that no such afternoon can produce
 * that outcome.
 *
 * @module infra/retry/policy
 */

/** The policy applied when a failure carries no recognised class. */
export const UNKNOWN_POLICY = Object.freeze({ strategy: 'never', maxAttempts: 0 });

/**
 * @typedef {object} RetryPolicy
 * @property {string} strategy   `never` | `fixed` | `exponential`.
 * @property {number} maxAttempts
 * @property {number} [baseDelayMs]
 */

/**
 * @typedef {object} RetryPolicyTable
 * @property {(code: string) => RetryPolicy} policyFor
 * @property {(code: string) => boolean} isRetryable
 * @property {() => string[]} neverRetryClasses
 */

/**
 * Builds a policy table from an injected class registry.
 *
 * @param {Record<string, { retry: RetryPolicy }>} classes
 *   Keyed by error code. Shaped like `core/model/errors.mjs`'s `ERROR_CLASSES`,
 *   but this module does not import it and does not know what the codes mean.
 * @returns {RetryPolicyTable}
 */
export function createRetryPolicy(classes) {
  /**
   * An unrecognised code yields `never`, not a default retry. Failing closed
   * costs a delayed recovery; failing open means a class nobody has classified
   * yet is retried against a source that may be actively rejecting us.
   *
   * @param {string} code
   * @returns {RetryPolicy}
   */
  const policyFor = (code) => classes[code]?.retry ?? UNKNOWN_POLICY;

  /**
   * @param {string} code
   * @returns {boolean}
   */
  const isRetryable = (code) => policyFor(code).strategy !== 'never';

  return {
    policyFor,
    isRetryable,
    // Derived from the registry rather than listed, so a class added later is
    // covered without anybody remembering to update a list.
    neverRetryClasses: () => Object.keys(classes).filter((code) => !isRetryable(code)),
  };
}

/**
 * The delay before attempt `n`, with jitter.
 *
 * ## Why the jitter is full rather than a small wobble
 *
 * Shards retry in parallel. Exponential backoff alone synchronises them: every
 * shard that failed at the same moment waits the same interval and retries in
 * the same instant, which is the thundering herd the backoff was supposed to
 * prevent. Full jitter — a uniform draw across the whole window rather than a
 * fixed delay plus noise — is what actually spreads them.
 *
 * Randomness arrives as a port so a test can assert the schedule exactly
 * (DR-2).
 *
 * @param {RetryPolicy} policy
 * @param {number} attempt 1-based.
 * @param {{ next: () => number }} random
 * @returns {number} Milliseconds.
 */
export function delayFor(policy, attempt, random) {
  const base = policy.baseDelayMs ?? 0;

  if (policy.strategy === 'never' || base === 0) return 0;
  if (policy.strategy === 'fixed') return base;

  const window = base * 2 ** (attempt - 1);

  return Math.floor(random.next() * window);
}
