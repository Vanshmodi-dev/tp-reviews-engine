/**
 * Normalised string similarity.
 *
 * Two callers with different tolerances for being wrong:
 *
 * - **Identity verification** (threshold 0.82) asks "is this listing the one we
 *   configured?". A false positive harvests the wrong business.
 * - **Near-duplicate detection** (threshold 0.92) asks "did this reviewer post
 *   nearly the same text twice?". A false positive raises a warning nobody
 *   needs; it never deletes anything, because near-duplicates are a `warn`
 *   finding and gate rule G-11, not a removal.
 *
 * The asymmetry is why the thresholds differ and why neither is hard-coded
 * here — both arrive as configuration.
 *
 * Dice coefficient over character bigrams. Chosen over edit distance because it
 * is O(n) rather than O(n²) — near-duplicate detection compares every review
 * against every other, so the quadratic version is the difference between a
 * fast pass and a timeout on a thousand-review listing.
 *
 * @module core/util/similarity
 */

/**
 * Folds text for comparison: lowercase, collapse whitespace, drop punctuation.
 *
 * Comparison folding is deliberately more aggressive than the normaliser's:
 * here the goal is "do these mean the same thing", not "is this safe to
 * publish".
 *
 * @param {string} text
 * @returns {string}
 */
export function foldForComparison(text) {
  if (typeof text !== 'string') return '';

  return text
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/\p{Mn}/gu, '')
    .normalize('NFC')
    .replaceAll(/[\p{P}\p{S}]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/**
 * @param {string} text
 * @returns {Map<string, number>} Bigram counts.
 */
function bigrams(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  const chars = [...text];

  for (let i = 0; i < chars.length - 1; i += 1) {
    const pair = `${chars[i]}${chars[i + 1]}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  return counts;
}

/**
 * Everything about one string that a comparison needs.
 *
 * @typedef {object} BigramProfile
 * @property {string} folded
 * @property {Map<string, number>} grams
 * @property {number} total
 */

/**
 * Precomputes a string's comparison profile.
 *
 * Exported for callers that compare one text against **many**. `similarity`
 * builds both profiles on every call, which is right for a single comparison and
 * wasteful in a loop: comparing *n* texts pairwise rebuilds each profile *n*
 * times. Near-duplicate detection is exactly that shape, so it builds each
 * profile once and calls {@link similarityOf}.
 *
 * @param {string} text
 * @returns {BigramProfile}
 */
export function bigramProfile(text) {
  const folded = foldForComparison(text);
  const grams = bigrams(folded);

  let total = 0;
  for (const n of grams.values()) total += n;

  return { folded, grams, total };
}

/**
 * Similarity between two precomputed profiles.
 *
 * @param {BigramProfile} left
 * @param {BigramProfile} right
 * @returns {number}
 */
export function similarityOf(left, right) {
  if (left.folded === right.folded) return 1;
  if (left.folded === '' || right.folded === '') return 0;

  // A single character produces no bigrams; equality is handled above, so
  // anything reaching here with no bigrams shares nothing.
  if (left.total === 0 || right.total === 0) return 0;

  // Iterating the smaller map keeps the cost proportional to the shorter text
  // rather than to whichever argument happened to be passed first.
  const [fewer, more] = left.grams.size <= right.grams.size ? [left, right] : [right, left];

  let shared = 0;
  for (const [gram, count] of fewer.grams) {
    shared += Math.min(count, more.grams.get(gram) ?? 0);
  }

  return (2 * shared) / (left.total + right.total);
}

/**
 * Similarity between two strings, from 0 (nothing in common) to 1 (identical
 * after folding).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  return similarityOf(bigramProfile(a), bigramProfile(b));
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} threshold Supplied by configuration, never assumed here.
 * @returns {boolean}
 */
export function isSimilarEnough(a, b, threshold) {
  return similarity(a, b) >= threshold;
}
