/**
 * The three-parser rating cascade and its integer post-check (EDR-017, T-198).
 *
 * ## Why three parsers
 *
 * Ratings are displayed visually as stars, semantically as an accessible label,
 * and sometimes as a bare number. Any single approach breaks on some rendering
 * variant, and they break for unrelated reasons — which is what makes three of
 * them worth maintaining.
 *
 * | Parser | Reads | Breaks when |
 * | --- | --- | --- |
 * | P1 accessible-label | A label carrying the value | The label is absent from a rendering |
 * | P2 star-count | Count of filled indicators | The *styling* of filled vs unfilled changes |
 * | P3 numeric-text | A bare numeric string | Anything at all; last resort |
 *
 * P2 is the intuitive one and the one to be most suspicious of: distinguishing
 * a filled star from an unfilled one is a pure styling concern, and vendors
 * change styling freely without considering it a breaking change.
 *
 * ## The post-check is the point (TR-EXT-040, TR-EXT-041)
 *
 * A parsed rating MUST be an integer in [1, 5]. Not because inputs are
 * untrusted in the abstract, but because a **non-integer rating is almost
 * always one specific bug**: a value like 4.3 means the parser matched an
 * element one level too high and captured the *aggregate business rating*
 * rather than this review's.
 *
 * Without the check, the business's own 4.7 average is ingested as a review,
 * on every harvest, inflating the published mean — and every individual value
 * looks entirely plausible in isolation. That is IR-14, and this is its
 * mitigation.
 *
 * Averaging the parsers' results was rejected for the same reason: it produces
 * non-integer values, which is precisely the corruption being caught.
 *
 * @module core/extract/rating
 */

/** The only ratings a review may carry. */
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * @typedef {object} RatingResult
 * @property {number | null} value
 * @property {'accessible-label' | 'star-count' | 'numeric-text' | null} parser
 * @property {string | null} error   `ERR-PARSE-RATING-INVALID` or `ERR-PARSE-FIELD-REQUIRED`.
 * @property {string | null} raw     What the winning parser read, for diagnostics.
 */

/**
 * Runs the cascade and applies the post-check.
 *
 * The parsers are supplied as thunks so this module stays free of any notion of
 * markup: the caller binds them to the pack's strategies, and the ordering — the
 * part that is normative — lives here.
 *
 * @param {object} parsers
 * @param {() => string | null} parsers.accessibleLabel
 * @param {() => number | null} parsers.starCount
 * @param {() => string | null} parsers.numericText
 * @returns {RatingResult}
 */
export function parseRating(parsers) {
  /** @type {Array<['accessible-label' | 'star-count' | 'numeric-text', () => unknown]>} */
  const cascade = [
    ['accessible-label', parsers.accessibleLabel],
    ['star-count', parsers.starCount],
    ['numeric-text', parsers.numericText],
  ];

  for (const [parser, run] of cascade) {
    let raw;

    try {
      raw = run();
    } catch {
      continue;
    }

    if (raw === null || raw === undefined || raw === '') continue;

    const value = typeof raw === 'number' ? raw : readNumber(String(raw));

    if (value === null) continue;

    return check(value, parser, String(raw));
  }

  return { value: null, parser: null, error: 'ERR-PARSE-FIELD-REQUIRED', raw: null };
}

/**
 * @param {number} value
 * @param {'accessible-label' | 'star-count' | 'numeric-text'} parser
 * @param {string} raw
 * @returns {RatingResult}
 */
function check(value, parser, raw) {
  // TR-EXT-041: this check MUST be implemented. It is not defensive
  // programming — it catches a specific, recurring corruption.
  if (!Number.isInteger(value) || value < MIN_RATING || value > MAX_RATING) {
    return { value: null, parser, error: 'ERR-PARSE-RATING-INVALID', raw };
  }

  return { value, parser, error: null, raw };
}

/**
 * Reads the first number from a label, handling locale decimal separators.
 *
 * "4,0 von 5 Sternen" and "4.0 out of 5" must both yield 4 — and "4,5" must
 * yield 4.5 so that the post-check can reject it. A comma-as-decimal locale is
 * exactly where a naive parser reads 45 and passes a check designed to catch
 * this.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function readNumber(text) {
  const match = /-?\d+(?:[.,]\d+)?/u.exec(text);

  if (match === null) return null;

  const value = Number(match[0].replace(',', '.'));

  return Number.isFinite(value) ? value : null;
}

/**
 * Counts filled indicators, sanity-checking the widget they came from.
 *
 * A five-star widget has exactly five indicators. When the pack's `total`
 * strategy matches some other number, it matched something that is not the
 * rating widget — and counting "filled" elements inside it produces a number
 * between 1 and 5 often enough to look correct.
 *
 * Returning null hands the record to P3 and leaves a fallback in the strategy
 * histogram, which is a visible symptom. Returning a plausible wrong integer
 * would not be.
 *
 * @param {number} filled
 * @param {number} total  Indicators matched in total; 0 when the pack cannot say.
 * @returns {number | null}
 */
export function countStars(filled, total) {
  if (!Number.isInteger(filled) || filled <= 0) return null;
  if (total > 0 && (total !== MAX_RATING || filled > total)) return null;

  return filled;
}
