/**
 * Steps 5 and 6 — whitespace canonicalisation and truncation-marker removal.
 *
 * Runs after control stripping, so that invisible characters cannot survive as
 * "content" holding a whitespace run apart. A zero-width space between two
 * spaces would otherwise stop them collapsing, and the payload would carry a
 * gap the reviewer never typed.
 *
 * @module core/normalize/whitespace
 */

/** Blank lines beyond this many consecutive newlines are collapsed away. */
const MAX_CONSECUTIVE_NEWLINES = 2;

/**
 * Markers a source appends when it has shortened the text itself.
 *
 * This set is deliberately small and Latin-focused. The locale-aware phrase
 * table proper is PH-03's deliverable (TRD §21.6) and this list is replaced by
 * it; carrying a guessed multi-locale table here would put invented data in the
 * security boundary, and a marker that is missed costs a trailing "… More" in
 * the payload rather than anything unsafe.
 *
 * **Every marker requires an ellipsis.** A bare trailing "more" or "Read more"
 * is NOT treated as a marker, and that asymmetry is deliberate: the risks are
 * not symmetric. A missed marker leaves a cosmetic "… More" in the payload; a
 * false positive silently deletes the last words of a real review.
 *
 * The corpus caught this. The first version accepted a bare `more`, which ate
 * the final word of "cost &foo; more" and even the tail of "textmore" — three
 * failing cases that all looked like unrelated bugs until the cause was traced
 * to one over-broad alternative.
 *
 * Sources render the expander as "…More", so ellipsis-anchoring covers the real
 * case. "I would definitely read more" stays intact, which is the outcome that
 * matters.
 */
const TRUNCATION_MARKERS = Object.freeze([
  /\s*(?:\.\.\.|…)\s*(?:more|read more|show more|see more)\s*$/iu,
  /\s*(?:\.\.\.|…)\s*$/u,
]);

/**
 * Canonicalises line endings and collapses whitespace runs.
 *
 * @param {string} text
 * @returns {string}
 */
export function canonicaliseWhitespace(text) {
  return (
    text
      // CRLF and lone CR become LF. Byte-determinism depends on this: the same
      // review harvested on two platforms must produce identical bytes.
      .replaceAll(/\r\n?/gu, '\n')
      // Horizontal whitespace runs - including exotic Unicode spaces a source
      // may emit - collapse to one ordinary space. \n is excluded so that
      // paragraph structure survives.
      .replaceAll(/[^\S\n]+/gu, ' ')
      // Space padding around a newline is invisible and defeats the run
      // collapse above, so it goes before newlines are counted.
      .replaceAll(/ *\n */gu, '\n')
      // Three or more newlines become a paragraph break. A reviewer who pressed
      // return twelve times meant one gap.
      .replaceAll(/\n{3,}/gu, '\n'.repeat(MAX_CONSECUTIVE_NEWLINES))
      .trim()
  );
}

/**
 * Removes a trailing truncation marker, reporting whether one was found.
 *
 * Runs after whitespace canonicalisation so that matching is reliable: a marker
 * separated from the text by a newline and two spaces is the same marker.
 *
 * `text_truncated` and `text_clipped` are **different flags** (TR-NORM-022).
 * This one means the source's own text was longer than what was retrieved;
 * clipping means the engine bounded it. Both can be true of one review.
 *
 * @param {string} text
 * @returns {{ text: string, truncated: boolean }}
 */
export function stripTruncationMarker(text) {
  for (const marker of TRUNCATION_MARKERS) {
    if (marker.test(text)) {
      return { text: text.replace(marker, '').trimEnd(), truncated: true };
    }
  }

  return { text, truncated: false };
}
