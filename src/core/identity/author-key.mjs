import { identityDigest } from '../util/hash.mjs';
import { textIdentityDigest } from './identity-hash.mjs';

/**
 * `author_key` — the internal matching key for a reviewer.
 *
 * **Never published** (TR-HASH-020). It exists so that "José Álvarez" and "Jose
 * Alvarez" match across harvests when a source renders diacritics
 * inconsistently, and for nothing else.
 *
 * The five steps are TRD §53.5, in order: casefold, strip diacritics, collapse
 * whitespace, remove punctuation, hash.
 *
 * **Diacritic stripping is not homoglyph normalisation, and the difference is
 * load-bearing** (TR-HASH-021). Stripping combining marks folds `é` to `e`,
 * which is a formatting difference. It does *not* fold Cyrillic `А` (U+0410)
 * into Latin `A` (U+0041), because those are different letters belonging to
 * different people. Two authors with visually identical names are two authors;
 * merging them is a data-integrity bug, not a feature.
 *
 * @module core/identity/author-key
 */

/** Combining marks removed after NFD decomposition. */
const COMBINING_MARKS = /\p{Mn}/gu;

/** Punctuation and symbols, removed after whitespace has been collapsed. */
const PUNCTUATION = /[\p{P}\p{S}]/gu;

/**
 * Applies the five normalisation steps and returns the hashed key.
 *
 * @param {string | null | undefined} name The author's display name as published.
 * @param {object} anonymousContext Used only when the name is absent.
 * @param {string} anonymousContext.listingKey
 * @param {string | null} anonymousContext.text The review's normalised text.
 * @returns {string} 32 hex characters.
 */
export function deriveAuthorKey(name, anonymousContext) {
  const folded = foldAuthorName(name);

  if (folded === '') {
    // TR-HASH-022. Anonymous reviewers must not collapse into one another: a
    // listing with forty "A Google user" reviews is forty reviews, not one.
    //
    // THE BOUNDED DIGEST IS LOAD-BEARING, NOT A CONVENIENCE. This key feeds
    // identity_hash, so anything unstable here makes an anonymous review
    // re-key itself. Using the FULL text would mean an anonymous reviewer
    // appending "Update: still great!" changes their author_key, which changes
    // their identity_hash, which tombstones the old review and inserts a new
    // one - the exact duplicate-then-vanish that EDR-036 rejects full-text
    // identity to avoid, reintroduced through the back door.
    //
    // Reusing textIdentityDigest means the anonymous bucket is stable under
    // precisely the edits identity is already tolerant of, and no others.
    return identityDigest([
      'anon',
      anonymousContext.listingKey,
      textIdentityDigest(anonymousContext.text),
    ]);
  }

  return identityDigest(['author', folded]);
}

/**
 * The four normalisation steps, without the hash.
 *
 * Exposed separately because the interesting behaviour is here, and a test that
 * can only see the digest cannot show *why* two names matched.
 *
 * @param {string | null | undefined} name
 * @returns {string} The folded form, or `''` when there is no usable name.
 */
export function foldAuthorName(name) {
  if (typeof name !== 'string') return '';

  return (
    name
      // 1. Casefold.
      .toLowerCase()
      // 2. Strip diacritics: decompose, drop combining marks, recompose.
      //    NFD separates `é` into `e` + U+0301; it leaves Cyrillic and Greek
      //    letters untouched, which is exactly the homoglyph distinction.
      .normalize('NFD')
      .replaceAll(COMBINING_MARKS, '')
      .normalize('NFC')
      // 3. Collapse whitespace, before punctuation removal so that "Mary-Jane"
      //    and "Mary Jane" converge rather than becoming "maryjane" and
      //    "mary jane".
      .replaceAll(/\s+/gu, ' ')
      .trim()
      // 4. Remove punctuation and symbols.
      .replaceAll(PUNCTUATION, '')
      // Collapsing again: removing punctuation can leave a doubled space, as in
      // "Anna - Maria" becoming "anna  maria".
      .replaceAll(/\s+/gu, ' ')
      .trim()
  );
}
