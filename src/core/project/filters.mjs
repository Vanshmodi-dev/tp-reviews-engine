/**
 * Display filters (TRD §24.4).
 *
 * Applied **before** aggregate computation (TR-PROJ-021), so `stats` describes
 * what was actually published rather than what was harvested.
 *
 * ## `min_rating` and deliberate friction
 *
 * `display.min_rating` defaults to `null`, and the product position is that
 * TradyPerch declines to filter out low ratings. The config system does not
 * forbid it — a jurisdiction or a platform might someday require selective
 * display — but setting it triggers validation rule V-8, which requires a
 * written justification.
 *
 * That is the point of implementing it here rather than not at all: mechanisms
 * that make the wrong choice slightly uncomfortable are more durable than
 * mechanisms that make it impossible and get bypassed by a fork.
 *
 * @module core/project/filters
 */

import { countGraphemes } from '../normalize/unicode.mjs';
import { hasText } from './stats.mjs';

/**
 * Every property admits `undefined` explicitly, because a caller spreading a
 * partial config legitimately produces `{ order: undefined }` and
 * `resolveDisplay` is built to treat that as "not supplied" rather than as a
 * value. Under `exactOptionalPropertyTypes` the two are different types, and
 * saying so here is what lets a caller pass one without a cast.
 *
 * @typedef {object} DisplayConfig
 * @property {string | undefined} [order]              `newest` (default) or `oldest`.
 * @property {number | undefined} [latest_count]       Size of the `latest` slice. Default 20.
 * @property {number | undefined} [min_text_length]    Default 0.
 * @property {ReadonlyArray<string> | null | undefined} [languages]  Default null (all).
 * @property {boolean | undefined} [include_rating_only] Default true.
 * @property {number | null | undefined} [min_rating]  Default null. See V-8.
 */

/**
 * A display config with every default filled in. Distinct from `DisplayConfig`
 * because the whole job of `resolveDisplay` is to turn "may be absent" into
 * "definitely present", and a filter that still had to guard for undefined
 * would mean that job was not done.
 *
 * @typedef {object} ResolvedDisplay
 * @property {string} order
 * @property {number} latest_count
 * @property {number} min_text_length
 * @property {ReadonlyArray<string> | null} languages
 * @property {boolean} include_rating_only
 * @property {number | null} min_rating
 */

/** The documented defaults, so a caller may pass nothing and still be correct. */
export const DISPLAY_DEFAULTS = Object.freeze({
  order: 'newest',
  latest_count: 20,
  min_text_length: 0,
  languages: null,
  include_rating_only: true,
  min_rating: null,
});

/**
 * Resolves a partial display config against the defaults.
 *
 * @param {DisplayConfig} [display]
 * @returns {ResolvedDisplay}
 */
export function resolveDisplay(display = {}) {
  return /** @type {ResolvedDisplay} */ ({ ...DISPLAY_DEFAULTS, ...stripUndefined(display) });
}

/**
 * `{ languages: undefined }` must not beat the default, but `{ languages: null }`
 * must — null is the meaningful "all languages" value.
 *
 * @param {Record<string, any>} source
 * @returns {Record<string, any>}
 */
function stripUndefined(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
}

/**
 * Whether one record survives the display filters.
 *
 * @param {any} record
 * @param {ResolvedDisplay} display
 * @returns {boolean}
 */
export function passesDisplayFilters(record, display) {
  const review = record.review;

  // Graphemes, not code points, and the same counter the normaliser's length
  // bound uses. A family emoji is seven code points and one character to a
  // reader; two definitions of "how long is this text" in one codebase is how a
  // review passes `min_text_length` here and is reported as a different length
  // three stages later.
  const textLength = typeof review.text === 'string' ? countGraphemes(review.text) : 0;

  // A review with no text at all is governed by `include_rating_only`, not by
  // `min_text_length`. Conflating them would make `min_text_length: 1` silently
  // drop every rating-only review, which is a different policy than the one the
  // operator asked for.
  if (!hasText(review)) {
    if (!display.include_rating_only) return false;
  } else if (textLength < display.min_text_length) {
    return false;
  }

  if (display.languages !== null && !display.languages.includes(review.language)) return false;

  if (display.min_rating !== null) {
    if (typeof review.rating !== 'number') return false;
    if (review.rating < display.min_rating) return false;
  }

  return true;
}

/**
 * Applies the display filters to a set of records.
 *
 * @param {ReadonlyArray<any>} records
 * @param {ResolvedDisplay} display
 * @returns {any[]}
 */
export function applyDisplayFilters(records, display) {
  return records.filter((record) => passesDisplayFilters(record, display));
}
