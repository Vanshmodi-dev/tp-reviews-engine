/**
 * Precision and confidence, derived from **phrase granularity** — never from
 * the arithmetic.
 *
 * This distinction is the whole module. Subtracting three average months from
 * an instant produces a millisecond-exact number, and that number is not
 * three-month-accurate. Reporting it without saying so would let a consumer
 * sort, filter, and display a guess as though it were a fact.
 *
 * The engine's position is that a coarse estimate honestly labelled is worth
 * more than a precise one that is wrong.
 *
 * @module core/dates/precision
 */

/** Coarsest first is deliberate: it reads as a scale. */
export const PRECISIONS = Object.freeze(['unknown', 'year', 'month', 'week', 'day']);

export const CONFIDENCES = Object.freeze(['low', 'medium', 'high']);

/**
 * Phrase granularity to precision.
 *
 * Sub-day units all report `day`. "3 hours ago" is known to the hour, but the
 * payload's date field is a day-level estimate and claiming hour precision in
 * it would be a promise the field cannot keep.
 */
const UNIT_PRECISION = Object.freeze({
  second: 'day',
  minute: 'day',
  hour: 'day',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
});

/**
 * TRD §21.6: `high` for explicit day and week phrases, `medium` for month
 * phrases, `low` for year phrases and anything requiring a fallback.
 */
const PRECISION_CONFIDENCE = Object.freeze({
  day: 'high',
  week: 'high',
  month: 'medium',
  year: 'low',
  unknown: 'low',
});

/**
 * @param {{ count: number, unit: string } | null} quantity
 * @returns {{ precision: string, confidence: string }}
 */
export function describePrecision(quantity) {
  if (quantity === null) {
    // TR-EXT-051. An unparseable phrase is `unknown`/`low` and the record stays
    // valid - a review is never discarded because its date could not be read.
    return { precision: 'unknown', confidence: 'low' };
  }

  const precision =
    UNIT_PRECISION[/** @type {keyof typeof UNIT_PRECISION} */ (quantity.unit)] ?? 'unknown';

  // No fallback here, deliberately. Every value `precision` can hold is a key
  // of PRECISION_CONFIDENCE - including 'unknown' - so the lookup is total by
  // construction, and a `?? 'low'` would be an unreachable branch pretending to
  // be a safety net.
  const confidence =
    PRECISION_CONFIDENCE[/** @type {keyof typeof PRECISION_CONFIDENCE} */ (precision)];

  return { precision, confidence };
}

/**
 * Whether one precision is coarser than another.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isCoarserThan(a, b) {
  return PRECISIONS.indexOf(a) < PRECISIONS.indexOf(b);
}
