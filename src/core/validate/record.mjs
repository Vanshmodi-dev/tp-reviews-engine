import { isValidRating } from '../model/review.mjs';

/**
 * Per-record validation — produces **findings**, never changes data (VAL-02).
 *
 * Validation observes and reports. It does not clean, coerce, drop, or reorder
 * anything. That separation is what makes the pipeline auditable: if a value is
 * wrong in the payload, either the extractor produced it wrong or the
 * normaliser failed to clean it, and validation's job is to say so loudly
 * rather than to quietly paper over it.
 *
 * A `fatal` finding is what gate rule G-07 blocks on. Everything below `fatal`
 * is information: the review is published and the finding is recorded.
 *
 * @module core/validate/record
 */

/** @typedef {import('../model/report.mjs').Finding} Finding */

const MAX_TEXT_GRAPHEMES = 5000;

/**
 * Findings travel into logs, diagnostics bundles, and alerts. A bounded detail
 * is what stops a malformed field carrying page content into all three.
 */
const MAX_DETAIL_LENGTH = 200;

/**
 * @param {string} code
 * @param {string} severity
 * @param {string | null} identityHash
 * @param {{ field: string, detail: string }} where
 * @returns {Finding}
 */
function finding(code, severity, identityHash, where) {
  return Object.freeze({
    code,
    severity,
    identity_hash: identityHash,
    field: where.field,
    // Bounded, and never raw page content: a finding travels into logs,
    // diagnostics bundles, and alerts.
    detail: where.detail.slice(0, MAX_DETAIL_LENGTH),
  });
}

/** The checks, in the order their findings should read. */
const CHECKS = Object.freeze([checkRating, checkIdentity, checkText, checkAnonymous, checkDate]);

/**
 * Validates one normalised review.
 *
 * The checks are a list rather than a chain of `if`s. As a chain this reached a
 * complexity of 23, which is both over the limit and genuinely harder to read:
 * the checks are a table, and adding one should be adding a row.
 *
 * @param {any} review A `NormalizedReview`.
 * @returns {Finding[]} Findings, empty when the record is sound.
 */
export function validateRecord(review) {
  const id = review?.identity_hash ?? null;
  /** @type {Finding[]} */
  const findings = [];

  for (const check of CHECKS) {
    const result = check(review, typeof id === 'string' ? id : null);
    if (result !== null) findings.push(result);
  }

  return findings;
}

/**
 * A rating outside 1-5, fractional, or missing. Fatal: a payload with a rating
 * of 0 or 7 is visibly broken on a client's site.
 *
 * @param {any} review @param {string | null} id @returns {Finding | null}
 */
function checkRating(review, id) {
  if (isValidRating(review?.rating)) return null;

  return finding('ERR-PARSE-RATING-INVALID', 'fatal', id, {
    field: 'rating',
    detail: `rating ${String(review?.rating)} is not an integer in 1..5`,
  });
}

/** @param {any} review @param {string | null} id @returns {Finding | null} */
function checkIdentity(review, id) {
  const hash = review?.identity_hash;
  if (typeof hash === 'string' && /^[0-9a-f]{32}$/u.test(hash)) return null;

  return finding('ERR-INTERNAL-INVARIANT', 'fatal', id, {
    field: 'identity_hash',
    detail: 'identity_hash is not 32 hex characters',
  });
}

/**
 * Text must be a string or null, and within the normalisation bound. Exceeding
 * the bound means normalisation did not run - a pipeline-order defect rather
 * than a data problem.
 *
 * @param {any} review @param {string | null} id @returns {Finding | null}
 */
function checkText(review, id) {
  const text = review?.text;

  if (text !== null && typeof text !== 'string') {
    return finding('ERR-PARSE-FIELD-REQUIRED', 'fatal', id, {
      field: 'text',
      detail: 'text must be a string or null',
    });
  }

  if (typeof text === 'string' && graphemeCount(text) > MAX_TEXT_GRAPHEMES) {
    return finding('ERR-CLEAN-MARKUP-SURVIVED', 'fatal', id, {
      field: 'text',
      detail: 'text exceeds the normalisation bound; normalisation did not run',
    });
  }

  return null;
}

/**
 * Anonymous AND textless. Publishable, but worth knowing: it is a star rating
 * with nothing else, and a listing full of them is a signal.
 *
 * @param {any} review @param {string | null} id @returns {Finding | null}
 */
function checkAnonymous(review, id) {
  const anonymous = review?.author?.name === null || review?.author?.name === undefined;
  if (!anonymous || review?.text !== null) return null;

  return finding('ERR-PARSE-FIELD-REQUIRED', 'info', id, {
    field: 'author.name',
    detail: 'anonymous rating-only review',
  });
}

/** @param {any} review @param {string | null} id @returns {Finding | null} */
function checkDate(review, id) {
  if (review?.date_estimated !== null && review?.date_estimated !== undefined) return null;

  return finding('ERR-PARSE-FIELD-REQUIRED', 'warn', id, {
    field: 'date_estimated',
    detail: 'relative date could not be resolved; record remains valid',
  });
}

/**
 * @param {string} text
 * @returns {number}
 */
function graphemeCount(text) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * Whether a record should be quarantined rather than published.
 *
 * Only `fatal` quarantines. A warning is published *with* its finding, because
 * a review with an unresolvable date is still a real review and withholding it
 * serves nobody.
 *
 * @param {Finding[]} findings
 * @returns {boolean}
 */
export function shouldQuarantine(findings) {
  return findings.some((f) => f.severity === 'fatal');
}
