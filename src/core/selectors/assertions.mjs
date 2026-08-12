/**
 * Structural assertions — "does the page still look like the page the pack was
 * written for" (DEL-92).
 *
 * ## Why this exists alongside the strategy histogram
 *
 * The histogram says a strategy moved. It does not say *what* moved, and it
 * only says anything once records are already resolving from fallbacks.
 *
 * These assertions run against the serialised subtree and answer the structural
 * question directly: the feed is still there, review nodes are still there, the
 * accessible rating label is still there. A pack can resolve every field and
 * still be reading the wrong element; a pack can also be one redesign away from
 * total failure while every payload it produces is perfect.
 *
 * ## Why they run in `core/`
 *
 * They are counting matches of declared selectors against a string. That is
 * pure, so the same file runs against the fixture corpus in CI and against a
 * live canary in production with no difference in code path — which is what
 * stops the canary from being the only place a rule is exercised.
 *
 * ## Severity is part of the data
 *
 * `fatal` means nothing downstream is worth evaluating; `error` predicts a
 * quarantine spike; `warn` means a field is running on its last strategy. An
 * assertion file where everything is fatal is an assertion file that gets
 * muted the first time a `warn` case fires.
 *
 * @module core/selectors/assertions
 */

import { queryAll } from '../extract/query.mjs';

/** Ascending. `fatal` stops evaluation of everything after it. */
export const ASSERTION_SEVERITIES = Object.freeze(['warn', 'error', 'fatal']);

/**
 * @typedef {object} AssertionResult
 * @property {string} id
 * @property {boolean} passed
 * @property {string} severity
 * @property {number} matched
 * @property {string} detail
 */

/**
 * Evaluates one assertion against a parsed subtree.
 *
 * @param {any} root      A parsed tree from `core/extract/html`.
 * @param {any} assertion
 * @returns {AssertionResult}
 */
export function evaluateAssertion(root, assertion) {
  let matched;

  try {
    matched = queryAll(root, assertion.selector).length;
  } catch (error) {
    // A selector the subset cannot compile is a broken assertion file, not a
    // broken page. Reporting it as a page failure would send an engineer to
    // the source looking for a change that never happened.
    return {
      id: assertion.id,
      passed: false,
      severity: 'error',
      matched: 0,
      detail: `assertion selector is unusable: ${error instanceof Error ? error.message : error}`,
    };
  }

  const min = assertion.min ?? null;
  const max = assertion.max ?? null;

  if (min !== null && matched < min) {
    return result(assertion, false, matched, `expected at least ${min}, found ${matched}`);
  }

  if (max !== null && matched > max) {
    return result(assertion, false, matched, `expected at most ${max}, found ${matched}`);
  }

  return result(assertion, true, matched, `found ${matched}`);
}

/**
 * @param {any} assertion
 * @param {boolean} passed
 * @param {number} matched
 * @param {string} detail
 * @returns {AssertionResult}
 */
function result(assertion, passed, matched, detail) {
  return {
    id: assertion.id,
    passed,
    severity: assertion.severity ?? 'error',
    matched,
    detail,
  };
}

/**
 * Evaluates a whole assertion file, stopping after a fatal failure.
 *
 * Stopping matters: once the surface is missing, every other assertion fails
 * for the same reason, and a report of six failures where there is one problem
 * is a report nobody reads to the end.
 *
 * @param {any} root
 * @param {any} file
 * @returns {{ results: AssertionResult[], failed: AssertionResult[], healthy: boolean }}
 */
export function evaluateAssertions(root, file) {
  /** @type {AssertionResult[]} */
  const results = [];

  for (const assertion of file?.assertions ?? []) {
    const outcome = evaluateAssertion(root, assertion);

    results.push(outcome);

    if (!outcome.passed && outcome.severity === 'fatal') break;
  }

  const failed = results.filter((outcome) => !outcome.passed);

  return { results, failed, healthy: failed.length === 0 };
}

/**
 * Checks an assertion file is well formed.
 *
 * A file that silently declares nothing passes every canary run, which is the
 * worst possible outcome for a mechanism whose entire job is to notice change.
 *
 * @param {any} file
 * @returns {string[]}
 */
export function checkAssertionFile(file) {
  const assertions = file?.assertions;

  if (!Array.isArray(assertions) || assertions.length === 0) {
    return ['the assertion file declares no assertions, so it can never fail'];
  }

  /** @type {string[]} */
  const problems = [];
  const seen = new Set();

  for (const assertion of assertions) {
    if (typeof assertion?.id !== 'string' || assertion.id === '') {
      problems.push('an assertion has no id');
      continue;
    }

    if (seen.has(assertion.id)) problems.push(`duplicate assertion id "${assertion.id}"`);

    seen.add(assertion.id);
    problems.push(...checkOneAssertion(assertion));
  }

  return problems;
}

/** Shortest notes that could plausibly explain what an assertion protects. */
const MIN_ASSERTION_NOTES = 20;

/**
 * @param {any} assertion
 * @returns {string[]}
 */
function checkOneAssertion(assertion) {
  /** @type {string[]} */
  const problems = [];

  if (typeof assertion.selector !== 'string' || assertion.selector === '') {
    problems.push(`assertion "${assertion.id}" has no selector`);
  }

  if (!ASSERTION_SEVERITIES.includes(assertion.severity)) {
    problems.push(`assertion "${assertion.id}" has severity "${assertion.severity}"`);
  }

  if (assertion.min === undefined && assertion.max === undefined) {
    // Without a bound there is nothing to violate. This is the failure mode the
    // whole file exists to avoid: an assertion that cannot fail.
    problems.push(`assertion "${assertion.id}" declares neither min nor max`);
  }

  if (typeof assertion.notes !== 'string' || assertion.notes.trim().length < MIN_ASSERTION_NOTES) {
    problems.push(`assertion "${assertion.id}" has no usable notes`);
  }

  return problems;
}
