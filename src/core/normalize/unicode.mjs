/**
 * Steps 3, 4 and 7 — Unicode normalisation, control stripping, and
 * grapheme-safe length bounding.
 *
 * @module core/normalize/unicode
 */

/**
 * Code points removed outright: C0 and C1 controls except TAB and LF, DEL,
 * zero-width characters, and bidi overrides.
 *
 * **U+200E and U+200F are deliberately absent.** Those are the bidi *marks*,
 * and they are required to render mixed-direction text correctly — an Arabic
 * review quoting a Latin product name needs them. Bidi *overrides* (U+202A–E)
 * and *isolates* (U+2066–9) are different characters with a different purpose:
 * they visually reorder text, so a review can be made to read as its own
 * opposite. TR-NORM-012 turns on exactly this distinction.
 *
 * Expressed as ranges rather than a regex literal because a character class
 * full of invisible characters is unreviewable, and this is a security
 * boundary.
 */
/* eslint-disable no-magic-numbers -- a Unicode range table: the code points ARE the meaning, and a name per bound adds noise rather than clarity */
/** @type {ReadonlyArray<readonly [number, number]>} */
const STRIPPED_RANGES = Object.freeze([
  [0x00, 0x08], // C0 below TAB
  [0x0b, 0x0c], // VT, FF
  [0x0e, 0x1f], // C0 above CR (CR itself is handled by whitespace canonicalisation)
  [0x7f, 0x9f], // DEL and the C1 range
  [0x00ad, 0x00ad], // SOFT HYPHEN - invisible, and splits words when copied
  [0x200b, 0x200d], // ZWSP, ZWNJ, ZWJ
  [0x202a, 0x202e], // LRE, RLE, PDF, LRO, RLO - bidi OVERRIDES
  [0x2060, 0x2064], // word joiner and invisible operators
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI - bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
]);
/* eslint-enable no-magic-numbers */

/**
 * ZWJ (U+200D) is stripped as an invisible character, but it is also the glue
 * in emoji sequences: a family emoji is five code points joined by four ZWJs.
 * Stripping it there would turn one glyph into four separate people.
 *
 * So ZWJ survives when it sits *between* two extended-pictographic characters,
 * and is removed everywhere else — where it is either invisible padding or a
 * homograph trick.
 */
const EMOJI = /\p{Extended_Pictographic}/u;

const ZWJ = 0x200d;

/**
 * @param {number} cp
 * @returns {boolean}
 */
function inStrippedRange(cp) {
  for (const [lo, hi] of STRIPPED_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/**
 * Unicode-normalises to NFC.
 *
 * Before length bounding, so that grapheme counting is meaningful: the same
 * visible text can be one code point or two depending on composition, and
 * bounding a decomposed string counts the combining marks separately.
 *
 * @param {string} text
 * @returns {string}
 */
export function toNFC(text) {
  return text.normalize('NFC');
}

/**
 * Removes control, zero-width, and bidi-override characters.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripControls(text) {
  const chars = [...text];
  let out = '';

  for (const [i, ch] of chars.entries()) {
    // A single character from a spread always has a code point; the cast
    // removes a branch that cannot be reached and therefore cannot be tested.
    const cp = /** @type {number} */ (ch.codePointAt(0));

    if (cp === ZWJ) {
      const before = chars[i - 1] ?? '';
      const after = chars[i + 1] ?? '';
      // Keep the ZWJ only where it is doing emoji work.
      if (EMOJI.test(before) && EMOJI.test(after)) out += ch;
      continue;
    }

    if (!inStrippedRange(cp)) out += ch;
  }

  return out;
}

/**
 * Counts grapheme clusters — what a reader would call "characters".
 *
 * @param {string} text
 * @returns {number}
 */
export function countGraphemes(text) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * Bounds text to `max` grapheme clusters, cutting only on a cluster boundary.
 *
 * EDR-020: bounding is by grapheme cluster and is applied **last**.
 *
 * Cutting at 5,000 *code units* splits surrogate pairs and ZWJ sequences,
 * producing mojibake — visible garbage on the client's website. Cutting by
 * bytes is worse. Cutting *before* normalisation is worse still: a review
 * padded with 10,000 characters of markup would be cut before the markup was
 * removed, discarding the real text and keeping the padding.
 *
 * @param {string} text
 * @param {number} max
 * @returns {{ text: string, clipped: boolean }}
 */
export function boundGraphemes(text, max) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const clusters = [...segmenter.segment(text)];

  if (clusters.length <= max) return { text, clipped: false };

  const out = clusters
    .slice(0, max)
    .map((cluster) => cluster.segment)
    .join('');

  // The cut lands wherever the bound falls, which can be in the middle of a run
  // of spaces, so the bounded text needs its trailing edge cleaned again.
  //
  // Step 5 already canonicalised whitespace, but this step runs after it
  // (EDR-020 applies the bound to final content), so it can reintroduce exactly
  // what step 5 removed. `normalize('a'.repeat(4999) + '  tail')` produced text
  // ending in a space until this line existed, which breaks the
  // no-surrounding-whitespace guarantee that PT-10 asserts and that every
  // payload consumer relies on.
  //
  // Only the trailing edge can be affected: the slice always starts at cluster
  // zero, so it cannot create leading whitespace that step 5 did not already
  // remove.
  return { text: out.trimEnd(), clipped: true };
}
