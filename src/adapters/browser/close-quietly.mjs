/**
 * Teardown that tolerates a step which has already failed (TR-BRW-057).
 *
 * ## Why this is its own module
 *
 * It is the mitigation for IR-09 — the highest-impact browser risk in the
 * register — and it needs to be provable. Playwright's own `close()` calls are
 * idempotent no-ops, so **the failure this exists to survive cannot be
 * triggered through the public browser API**: closing twice succeeds, and
 * closing after the browser is gone succeeds too.
 *
 * That is a happy accident of one library version, not a guarantee. A crashed
 * browser process, a killed container, or a future Playwright release can all
 * make a close throw, and TR-BRW-057 requires the next target to start with the
 * context closed regardless.
 *
 * Living in a sibling module means the behaviour can be tested directly with a
 * throwing step — and tested without importing `playwright` at all, which keeps
 * the fast unit suite browser-free.
 *
 * ## Swallowed, but never silent
 *
 * The error is logged and not rethrown. Rethrowing would replace the real error
 * with a cleanup error, which is how the actual cause of an incident gets lost:
 * a target fails for one reason, its context fails to close for another, and
 * the report names only the second.
 *
 * But swallowing without recording would make a context that *consistently*
 * fails to close look identical to one that closes fine — right up until the
 * shard runs out of memory.
 *
 * @module adapters/browser/close-quietly
 */

/**
 * @param {() => Promise<unknown>} step
 * @param {{ debug: (event: string, fields?: any) => void } | undefined} logger
 * @param {string} what  `page`, `context`, or `browser`.
 * @returns {Promise<void>}
 */
export async function closeQuietly(step, logger, what) {
  try {
    await step();
  } catch (error) {
    logger?.debug('browser.close_failed', {
      what,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
