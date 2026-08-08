/**
 * The eight canonical exit codes (T-167, TR-CLI-002).
 *
 * ## Codes 5, 6 and 7 are CI successes and alerting failures (EDR-030)
 *
 * This looks wrong until you consider what a red CI badge communicates. It
 * means "the code is broken". A gate rejection means the opposite: the code
 * worked perfectly and correctly declined to publish bad data. Failing the job
 * for it teaches the team that red is normal, and after a fortnight of that
 * nobody looks at a red badge at all — including the time it means something.
 *
 * So the *job conclusion* and the *alert severity* are set independently. A
 * gate rejection is a green job with an error-severity alert; a bot challenge
 * is a green job with a **critical** alert, because it needs a human that day.
 *
 * ## The set is closed
 *
 * Adding a code is a MAJOR version bump (§36). Downstream automation branches
 * on these numbers, and a new one silently falls into whatever `else` branch a
 * consumer wrote.
 *
 * @module cli/exit-codes
 */

export const EXIT = Object.freeze({
  /** Every target succeeded. */
  OK: 0,
  /** An unexpected internal error. The only code that means "this is a defect". */
  INTERNAL: 1,
  /** Invalid usage or configuration. Includes an unknown flag or `TPRE_*` variable. */
  USAGE: 2,
  /** Every target failed. */
  ALL_FAILED: 3,
  /** Some targets failed or were deferred; others succeeded. */
  PARTIAL: 4,
  /** The Publish Gate rejected. Nothing published, nothing crashed. */
  GATE_REJECTED: 5,
  /** Policy blocked the run: kill switch, robots, budget, or an open breaker. */
  POLICY_BLOCKED: 6,
  /** A bot challenge was encountered. Terminal, and never retried (INV-07). */
  CHALLENGE: 7,
});

/**
 * Whether a code should fail the CI job.
 *
 * @param {number} code
 * @returns {boolean}
 */
export function failsJob(code) {
  return code === EXIT.INTERNAL || code === EXIT.USAGE || code === EXIT.ALL_FAILED;
}

/**
 * The alert severity a code carries, independent of job conclusion.
 *
 * @param {number} code
 * @returns {string}
 */
export function severityFor(code) {
  switch (code) {
    case EXIT.OK:
      return 'none';
    case EXIT.INTERNAL:
      return 'critical';
    // A challenge is critical despite being a green job: it means a source has
    // decided we look like a bot, and every hour it goes unanswered makes the
    // eventual conversation harder.
    case EXIT.CHALLENGE:
      return 'critical';
    case EXIT.USAGE:
    case EXIT.ALL_FAILED:
    case EXIT.GATE_REJECTED:
      return 'error';
    default:
      return 'warn';
  }
}

/**
 * Human-readable, for `--help` and for the run manifest.
 *
 * @type {Readonly<Record<number, string>>}
 */
export const EXIT_MEANINGS = Object.freeze({
  [EXIT.OK]: 'all targets succeeded',
  [EXIT.INTERNAL]: 'unexpected internal error',
  [EXIT.USAGE]: 'invalid usage or configuration',
  [EXIT.ALL_FAILED]: 'all targets failed',
  [EXIT.PARTIAL]: 'some targets failed or were deferred',
  [EXIT.GATE_REJECTED]: 'the publish gate rejected; nothing was published',
  [EXIT.POLICY_BLOCKED]: 'policy blocked the run',
  [EXIT.CHALLENGE]: 'a bot challenge was encountered',
});
