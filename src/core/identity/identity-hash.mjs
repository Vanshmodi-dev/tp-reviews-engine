import { identityDigest } from '../util/hash.mjs';

/**
 * `identity_hash` — "is this the same review?"
 *
 * **This is the one value in the system that cannot be changed after the first
 * publication.** It is the Ledger's primary key. Changing how it is computed
 * re-keys every stored review, so every existing record would be tombstoned and
 * every incoming record inserted as new — a client's entire review history
 * would vanish and reappear as brand new reviews on the same day.
 *
 * That is why `identity_algo_version` is input #1 rather than an afterthought:
 * a future change is possible, but only as an explicit, versioned migration
 * (§53.6), never as an edit to this function.
 *
 * ## The six inputs (TRD §53.3, TR-HASH-001) — order is part of the contract
 *
 *   1. `identity_algo_version`  literal, currently 1
 *   2. `listing.key`            as stored; scopes identity to a listing
 *   3. `source`                 lowercased; the same person on two platforms is two reviews
 *   4. `author_key`             already folded and hashed
 *   5. `text_identity_digest`   first 512 graphemes, lowercased, whitespace-collapsed
 *   6. `rating`                 integer; a tiebreaker for short or empty texts
 *
 * ## What is deliberately NOT an input (EDR-036)
 *
 * **A source-specific review identifier**, even where the adapter exposes one
 * and even though it would be a strictly better discriminator (TR-HASH-002).
 * Using it would make identity differ between the DOM path and the API path for
 * the same review, so migrating a client from scraping to a sanctioned API
 * would insert every review as new and tombstone every old one — destroying the
 * migration guarantee the whole adapter architecture exists to provide.
 *
 * **The avatar URL**, which changes when a reviewer updates their photo.
 * **`relative_date`**, which changes on every harvest by nature.
 * **The full text** — an appended sentence would create a new identity,
 * producing a duplicate-then-vanish that a visitor can see.
 *
 * @module core/identity/identity-hash
 */

/** Bumping this is a migration (§53.6), not an edit. */
export const IDENTITY_ALGO_VERSION = 1;

/** TR-HASH-003. Bounded so that appending a sentence does not break identity. */
export const IDENTITY_TEXT_GRAPHEMES = 512;

/**
 * Input #5: the first 512 graphemes of normalised text, lowercased and
 * whitespace-collapsed.
 *
 * Bounded because a reviewer appending "Update: still great!" to a long review
 * should be an UPDATE, not an INSERT — appending is the most common form of
 * review edit, and an unbounded text input would make every edit look like a
 * different review.
 *
 * Empty text yields `''` rather than being omitted, so that a rating-only
 * review still has a well-defined position in the input list.
 *
 * @param {string | null | undefined} text Normalised review text.
 * @returns {string}
 */
export function textIdentityDigest(text) {
  if (typeof text !== 'string' || text === '') return '';

  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const clusters = [...segmenter.segment(text)];
  const bounded = clusters
    .slice(0, IDENTITY_TEXT_GRAPHEMES)
    .map((cluster) => cluster.segment)
    .join('');

  return bounded.toLowerCase().replaceAll(/\s+/gu, ' ').trim();
}

/**
 * Computes the identity hash from the six ordered inputs.
 *
 * @param {object} input
 * @param {string} input.listingKey
 * @param {string} input.source
 * @param {string} input.authorKey
 * @param {string | null} input.text Normalised text, or null for a rating-only review.
 * @param {number} input.rating
 * @returns {string} 32 hex characters.
 */
export function deriveIdentityHash({ listingKey, source, authorKey, text, rating }) {
  // The array order IS the contract. Reordering it silently re-keys every
  // review in every ledger.
  return identityDigest([
    String(IDENTITY_ALGO_VERSION),
    String(listingKey),
    String(source).toLowerCase(),
    String(authorKey),
    textIdentityDigest(text),
    String(rating),
  ]);
}
