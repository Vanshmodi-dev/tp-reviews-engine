import { markNormalised } from '../model/review.mjs';

/**
 * The normalisation pipeline — **the security boundary for every client website
 * simultaneously**.
 *
 * ============================================================================
 * NOT IMPLEMENTED YET. THIS IS THE DELIBERATE RED-PHASE PLACEHOLDER.
 * ============================================================================
 *
 * PH-02's Sequencing Note (ID-13) requires the property laws PT-10 and PT-11 to
 * be written as failing tests and merged *before* any implementation task
 * starts. This module exists so those laws have the real import path to point
 * at from the first commit, rather than being retargeted later — a law written
 * against a stand-in and then pointed somewhere else is a law nobody has
 * actually run against the thing it governs.
 *
 * It returns its input unchanged. That is not a simplification to be tidied up;
 * it is the state the laws are currently proving is wrong.
 *
 * **Nothing may import this until T-068 replaces it.** No caller exists today,
 * and the architecture test plus the eventual markup self-check (T-069) are
 * what keep it that way.
 *
 * The eight steps, in the order EDR-019 makes normative (TRD §23.3):
 *
 *   1. Decode entities        — repeatedly, until stable
 *   2. Strip markup           — REMOVE, never escape (TR-NORM-010)
 *   3. Unicode normalise      — NFC
 *   4. Remove control chars   — C0/C1 except \n and \t; zero-width; bidi OVERRIDES
 *   5. Canonicalise whitespace
 *   6. Detect truncation      — set text_truncated, remove the marker
 *   7. Bound length           — 5,000 GRAPHEME clusters, last (EDR-020)
 *   8. Type and brand         — return CleanString
 *
 * Step 4 strips bidi *overrides* and preserves bidi *marks*. They are different
 * characters with different purposes: overrides visually reorder text and are a
 * real spoofing vector; marks are required to render mixed-direction text
 * correctly, and stripping them corrupts legitimate Arabic and Hebrew reviews
 * (TR-NORM-012).
 *
 * @module core/normalize
 */

/** TRD §23.4 / EDR-020. Grapheme clusters, not code units, not bytes. */
export const MAX_TEXT_LENGTH = 5000;

/**
 * @typedef {object} NormalizeResult
 * @property {import('../model/review.mjs').CleanString} text
 * @property {boolean} text_truncated  The source's own text was longer than what was retrieved.
 * @property {boolean} text_clipped    The engine bounded the length (TR-NORM-021).
 */

/**
 * Normalises one string.
 *
 * @param {string} input
 * @returns {NormalizeResult}
 */
export function normalize(input) {
  // The no-op. Replaced step by step across T-064 through T-068; PT-10 and
  // PT-11 are red until it is.
  return { text: markNormalised(input), text_truncated: false, text_clipped: false };
}
