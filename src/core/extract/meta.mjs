/**
 * Likes, photo counts, and visit metadata (§21.3 steps 9–11, T-201).
 *
 * ## The hazard this file is named for: fabricating absent fields
 *
 * Every field here is optional, and every one of them has an obvious-looking
 * default. A missing like count becomes `0`. A missing photo count becomes `0`.
 * Absent visit metadata becomes an empty string. The payload then looks
 * complete, the schema validates, and nothing complains.
 *
 * `0` and `null` are different claims. `0` says "this review has no likes";
 * `null` says "this source does not tell us, or the strategy did not resolve".
 * Publishing the first when the second is true is fabricating data, and the
 * capability declaration (§`core/model/capabilities`) exists precisely so a
 * `null` can be *explained* rather than defaulted away.
 *
 * It also destroys the diagnostic. A pack whose `likes` strategy broke reports
 * zero likes on every review — indistinguishable from a listing where nobody
 * clicks the button, and invisible until someone compares against the source by
 * hand.
 *
 * ## Thousands separators are locale-dependent
 *
 * `1,234` is one thousand two hundred and thirty-four in `en` and one point two
 * three four in `de`. Both render on the same widget in different locales, and
 * a parser that strips commas unconditionally reports 1234 likes for a review
 * with 1.234 — an error of three orders of magnitude that looks entirely
 * plausible in a payload.
 *
 * So separators come from the locale, not from a guess, and a count that cannot
 * be read confidently is `null`.
 *
 * @module core/extract/meta
 */

/**
 * @typedef {object} ReviewMeta
 * @property {number | null} likes
 * @property {number | null} photo_count
 * @property {string | null} visited
 */

/** Locales whose grouping separator is `.` and decimal separator is `,`. */
const DOT_GROUPED = new Set(['de', 'es', 'pt', 'it', 'nl', 'tr', 'id', 'da']);

/**
 * Reads an integer count written in a locale's conventions.
 *
 * Returns null rather than a best guess whenever the string is not
 * unambiguously an integer — including the `1.234` case, which is a valid
 * integer in `de` and a valid decimal in `en`, and is therefore only readable
 * once the locale is known.
 *
 * @param {string | null} raw
 * @param {string} locale
 * @returns {number | null}
 */
export function readCount(raw, locale = 'en') {
  if (raw === null || raw === undefined) return null;

  const match = /-?\d[\d.,\u00A0\u202F\u2009 ]*/u.exec(String(raw));

  if (match === null) return null;

  const grouping = DOT_GROUPED.has(locale.slice(0, 2).toLowerCase()) ? '.' : ',';
  const digits = match[0]
    .replaceAll(/[\u00A0\u202F\u2009\s]/gu, '')
    .split(grouping)
    .join('');

  // Whatever remains must be digits only. A decimal separator surviving here
  // means the value was never an integer count, and rounding it would invent a
  // number the source never showed.
  if (!/^-?\d+$/u.test(digits)) return null;

  const value = Number(digits);

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * @param {import('./html.mjs').HtmlElement} node
 * @param {Record<string, any>} fields
 * @param {(name: string, node: import('./html.mjs').HtmlElement, spec: any) => string | null} read
 * @param {string} locale
 * @returns {ReviewMeta}
 */
export function extractMeta(node, fields, read, locale = 'en') {
  return {
    likes: readCount(read('likes', node, fields['likes']), locale),
    photo_count: readCount(read('photo_count', node, fields['photo_count']), locale),
    visited: read('visited', node, fields['visited']),
  };
}
