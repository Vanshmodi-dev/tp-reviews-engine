import { markNormalised } from '../model/review.mjs';
import { decodeAndStrip, hasSurvivingMarkup } from './markup.mjs';
import { boundGraphemes, countGraphemes, stripControls, toNFC } from './unicode.mjs';
import { canonicaliseWhitespace, stripTruncationMarker } from './whitespace.mjs';

/**
 * The normalisation pipeline — **the security boundary for every client website
 * simultaneously**.
 *
 * Eight steps, and EDR-019 makes the **order** normative rather than
 * incidental. Each position below is load-bearing:
 *
 *   1-2. Decode entities, then remove markup. Decoding must come first, or
 *        `&lt;script&gt;` survives stripping as literal text and re-encodes
 *        into a live tag downstream. Markup is REMOVED, never escaped
 *        (TR-NORM-010) — escaping means a consumer that unescapes gets it back.
 *   3.   NFC, before bounding, so grapheme counting is meaningful.
 *   4.   Strip controls, zero-width, and bidi OVERRIDES — keeping bidi marks,
 *        which mixed-direction text needs (TR-NORM-012).
 *   5.   Canonicalise whitespace, after control removal, so invisible
 *        characters cannot survive as "content" propping a run apart.
 *   6.   Detect and remove a truncation marker, after whitespace is regular so
 *        matching is reliable.
 *   7.   Bound length LAST, by grapheme cluster, so the bound applies to final
 *        content rather than to padding that was about to be removed
 *        (EDR-020).
 *   8.   Brand, making the boundary enforceable by the type checker.
 *
 * Reordering any two of these is a real defect, which is why the order is
 * asserted by observing intermediate effects rather than only the final output.
 *
 * @module core/normalize
 */

/** TRD §23.4 / EDR-020. Grapheme clusters — not code units, not bytes. */
export const MAX_TEXT_LENGTH = 5000;

/**
 * @typedef {object} NormalizeResult
 * @property {import('../model/review.mjs').CleanString} text
 * @property {boolean} text_truncated  The source's own text was longer than what was retrieved.
 * @property {boolean} text_clipped    The engine bounded the length (TR-NORM-021).
 * @property {boolean} markup_survived Self-check failure. `ERR-CLEAN-MARKUP-SURVIVED`, critical.
 */

/**
 * Runs the eight-step pipeline.
 *
 * @param {string} input Raw text from any adapter. Assumed hostile.
 * @param {number} [maxLength] Grapheme bound. Defaults to {@link MAX_TEXT_LENGTH}.
 * @returns {NormalizeResult}
 */
export function normalize(input, maxLength = MAX_TEXT_LENGTH) {
  // 1-2. Entities out, markup out.
  const stripped = decodeAndStrip(input);

  // 3. Compose, so a grapheme is a grapheme.
  const composed = toNFC(stripped);

  // 4. Invisible and direction-bending characters out.
  const visible = stripControls(composed);

  // 5. Whitespace made regular.
  const spaced = canonicaliseWhitespace(visible);

  // 6. The source's own "... More" removed, and recorded.
  const { text: unmarked, truncated } = stripTruncationMarker(spaced);

  // 7. Bounded last, on a cluster boundary.
  const { text: bounded, clipped } = boundGraphemes(unmarked, maxLength);

  // The self-check (T-069). This asserts the boundary held rather than assuming
  // it: if markup reaches here, the caller must raise
  // ERR-CLEAN-MARKUP-SURVIVED, which is `critical` because it means the
  // security boundary itself failed rather than that the data was merely odd.
  const markupSurvived = hasSurvivingMarkup(bounded);

  // 8. Brand.
  return {
    text: markNormalised(bounded),
    text_truncated: truncated,
    text_clipped: clipped,
    markup_survived: markupSurvived,
  };
}

export { countGraphemes };
