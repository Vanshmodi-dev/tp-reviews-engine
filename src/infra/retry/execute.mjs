/**
 * The generic retry executor (T-138, RETRY-03, EDR-027).
 *
 * ============================================================================
 * THIS FILE CONTAINS NO ERROR-CLASS NAME, AND MUST NOT ACQUIRE ONE.
 * Its acceptance criterion is a code search for `ERR-` finding nothing.
 * ============================================================================
 *
 * Whether something may be retried is a property of the error class, and the
 * class table is the single place that answers it. An executor with its own
 * opinion — a special case for a class it thinks is usually transient — is how a
 * challenge page turns into a hundred requests that each confirm the block.
 *
 * ## The budget is checked before every sleep, not before the loop
 *
 * A retry schedule can outlive the run that scheduled it. Checking the budget
 * once at the start authorises a sequence that finishes after the job has been
 * killed, which produces requests the engine believes it never made and a rate
 * budget that under-counts. So the budget is consulted before each wait, and
 * exhaustion stops the sequence immediately.
 *
 * ## Sleeping is injected
 *
 * `sleep` is a parameter so tests do not spend real seconds proving a backoff
 * schedule. The default is a real timer; every test passes a recorder and
 * asserts the sequence of delays directly.
 *
 * @module infra/retry/execute
 */

import { delayFor } from './policy.mjs';

/**
 * @typedef {object} ExecuteOptions
 * @property {import('./policy.mjs').RetryPolicyTable} policy
 *   Injected, like the table itself. This module resolves a policy through it
 *   and never inspects the code it passed in.
 * @property {{ next: () => number }} random
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => boolean} [budgetAvailable]  False when the run may make no further attempts.
 * @property {(event: Record<string, unknown>) => void} [onAttempt]
 */

/**
 * Runs `operation`, retrying according to the policy for whatever class it
 * reports.
 *
 * `operation` returns a `Result`-shaped value rather than throwing: an expected
 * failure is a value in this system, and an executor that caught exceptions
 * would also catch programmer errors and retry them.
 *
 * @param {() => Promise<any>} operation
 * @param {ExecuteOptions} options
 * @returns {Promise<any>} The final `Result`.
 */
export async function executeWithRetry(operation, options) {
  const sleep = options.sleep ?? defaultSleep;
  const budgetAvailable = options.budgetAvailable ?? (() => true);
  const onAttempt = options.onAttempt ?? (() => undefined);

  let attempt = 0;
  let last = await operation();

  onAttempt({ attempt: 1, ok: last?.ok === true, code: codeOf(last) });

  while (last?.ok !== true) {
    const policy = options.policy.policyFor(codeOf(last));

    attempt += 1;
    if (attempt >= policy.maxAttempts) break;

    // Checked before the wait, every time. See the module header.
    if (!budgetAvailable()) break;

    await sleep(delayFor(policy, attempt, options.random));

    last = await operation();
    onAttempt({ attempt: attempt + 1, ok: last?.ok === true, code: codeOf(last) });
  }

  return last;
}

/**
 * The class a failed result reports, or an empty string.
 *
 * Empty rather than a placeholder class name: this module names no class, and
 * `policyFor` already treats anything it does not recognise as `never`.
 *
 * @param {any} result
 * @returns {string}
 */
function codeOf(result) {
  return typeof result?.error?.code === 'string' ? result.error.code : '';
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
