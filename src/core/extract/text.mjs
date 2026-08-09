/**
 * Review body lifting and truncation detection (§21.3 step 8, §21.7, T-200).
 *
 * ## Markup removal does NOT happen here
 *
 * This is the hazard the plan names for this file, and it is worth stating
 * plainly: the temptation is to strip tags while lifting the text, because the
 * markup is right there and a regex would take one line.
 *
 * Markup removal is step 2 of the **normaliser** (§23.3), which is the security
 * boundary for every client website simultaneously (INV-05, X-7). Doing part of
 * it here would mean text reaching the payload had been cleaned by two
 * different implementations, one of which was never reviewed as a security
 * control and is not covered by PT-10, PT-11, or the `019` fixture.
 *
 * Extraction lifts *text nodes*. Whatever markup survives that is the
 * normaliser's problem, and fixture `019-markup-in-review-text` proves it gets
 * solved there.
 *
 * ## Truncation markers are pack data, not constants (TR-EXT-060)
 *
 * "More", "Mehr", "और", "المزيد" — a hard-coded English marker silently fails
 * on every non-English listing, and it fails by *keeping* the marker in the
 * text, so the published review ends with the word "More".
 *
 * TR-EXT-062 puts marker matching after whitespace canonicalisation, so
 * `…\n\n  More` and `… More` match the same declared marker.
 *
 * ## Rating-only reviews are valid
 *
 * A review with a rating and no text is a legitimate, common record (fixture
 * 010). `text: null` here is data, and INV-02 depends on it not being treated
 * as a missing required field.
 *
 * @module core/extract/text
 */

/**
 * @typedef {object} ReviewText
 * @property {string | null} value
 * @property {boolean} truncated
 */

/**
 * Canonicalises whitespace for marker matching only.
 *
 * The *stored* text is canonicalised by the normaliser; this is the local
 * collapse TR-EXT-062 requires so that a marker split across lines still
 * matches. Doing it twice is harmless and doing it here is necessary.
 *
 * @param {string} text
 * @returns {string}
 */
function collapse(text) {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Lifts the body text and detects a truncation marker.
 *
 * @param {string | null} raw
 * @param {ReadonlyArray<string>} markers  Locale-aware, from the pack.
 * @returns {ReviewText}
 */
export function extractText(raw, markers = []) {
  if (raw === null || raw === undefined) return { value: null, truncated: false };

  const collapsed = collapse(raw);

  if (collapsed === '') return { value: null, truncated: false };

  for (const marker of markers) {
    const trimmed = typeof marker === 'string' ? marker.trim() : '';

    if (trimmed === '' || !collapsed.endsWith(trimmed)) continue;

    // TR-EXT-061: the marker is removed from the stored text AND the flag is
    // set. Removing without flagging loses the fact that the review is
    // incomplete; flagging without removing publishes the word "More".
    const withoutMarker = collapse(collapsed.slice(0, -trimmed.length));

    return { value: withoutMarker === '' ? null : withoutMarker, truncated: true };
  }

  return { value: collapsed, truncated: false };
}
