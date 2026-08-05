import { describePrecision } from './precision.mjs';
import { resolveRelativePhrase } from './relative.mjs';

/**
 * Date pinning — resolve once, then **never recompute** (FR-036, TR-EXT-050).
 *
 * On the first harvest a review reads "2 months ago". A year later the same
 * review reads "1 year ago". Recomputing on each harvest would push the
 * review's date forward in time on every single run, permanently scrambling
 * sort order and making "newest first" meaningless — the review would drift
 * later forever while never changing.
 *
 * Pinning trades precision for stability, and a displayed ordering needs
 * stability far more than it needs precision.
 *
 * **There is deliberately no recompute path in this module.** Not a flag, not
 * an option, not a `force` parameter. The property law PT-06 asserts the
 * absence, and the reviewer's check for T-078 is to look for such a path and
 * find that it does not exist. Adding one later would pass every test that
 * exists today, which is exactly why it must not be possible to add one by
 * accident.
 *
 * @module core/dates/pin
 */

/**
 * @typedef {object} PinnedDate
 * @property {string | null} date_estimated  RFC 3339, or null when unparseable.
 * @property {string} date_precision
 * @property {string} date_confidence
 */

/**
 * Resolves a phrase for a review being seen for the FIRST time.
 *
 * @param {string | null} phrase The source's verbatim relative date.
 * @param {number} observedAtMs Epoch milliseconds. Required — `core/` reads no clock (DR-2).
 * @param {string} [locale]
 * @returns {PinnedDate}
 */
export function pinDate(phrase, observedAtMs, locale = 'en') {
  const resolved = phrase === null ? null : resolveRelativePhrase(phrase, observedAtMs, locale);
  const { precision, confidence } = describePrecision(resolved?.quantity ?? null);

  return {
    date_estimated: resolved === null ? null : new Date(resolved.resolvedMs).toISOString(),
    date_precision: precision,
    date_confidence: confidence,
  };
}

/**
 * Returns the date a review already carries, ignoring anything newly observed.
 *
 * This function takes the new phrase as a parameter **and does not use it**,
 * and that is the point rather than an oversight: it makes the call site read
 * as "we saw a new phrase and are deliberately keeping the old date", which is
 * the behaviour PT-06 protects. A caller that wanted to recompute would have to
 * delete this function and write a different one, which is a conspicuous change
 * rather than a quiet one.
 *
 * @param {PinnedDate} existing The date pinned at first observation.
 * @param {string | null} _newlyObservedPhrase Ignored, deliberately.
 * @returns {PinnedDate} `existing`, unchanged.
 */
export function keepPinnedDate(existing, _newlyObservedPhrase) {
  return existing;
}

/**
 * Chooses the date for a review, given whether it is already known.
 *
 * The only branch is "have we seen this before?". There is no path where a
 * known review's date is recomputed.
 *
 * @param {PinnedDate | null} existing `null` when the review is new.
 * @param {string | null} phrase
 * @param {number} observedAtMs
 * @param {string} [locale]
 * @returns {PinnedDate}
 */
export function resolveOrKeep(existing, phrase, observedAtMs, locale = 'en') {
  return existing === null ? pinDate(phrase, observedAtMs, locale) : existing;
}
