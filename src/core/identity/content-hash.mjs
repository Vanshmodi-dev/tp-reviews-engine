import { hashObject } from '../util/hash.mjs';

/**
 * `content_hash` — "did this review change?"
 *
 * Answers a different question from `identity_hash` and is allowed to change
 * freely: it is not a key, it is a change detector. A difference here means the
 * review was edited and the payload must be rewritten; equality means the file
 * is not touched at all (TR-HASH-030).
 *
 * ## The nine inputs (TRD §53.4)
 *
 * `rating`, full normalised `text`, `text_truncated`, `author.name`,
 * `author.avatar_url`, `owner_reply.text`, `owner_reply.date`, `likes`,
 * `photo_count`.
 *
 * Unlike identity, this uses the **full** text: a reviewer appending a sentence
 * has genuinely changed the displayed content, even though it is still the same
 * review.
 *
 * ## The exclusion that matters most
 *
 * **`relative_date` contributes nothing** (TR-HASH-010). It changes every
 * harvest by nature — "2 months ago" becomes "3 months ago" without the review
 * being touched. Including it would mark every review as edited on every single
 * run, which TRD §53.4 names as the single most common bug in naive
 * implementations of this system. The symptom is a fifty-fold multiplication of
 * commit churn, and `MET-commit-churn` exists to catch it.
 *
 * Also excluded: `first_seen_at`, `last_updated_at`, `revision`, and anything
 * else engine-generated — including them would make the hash self-referential,
 * so computing it would change it.
 *
 * @module core/identity/content-hash
 */

/**
 * @typedef {object} ContentHashInput
 * @property {number} rating
 * @property {string | null} text                Full normalised text.
 * @property {boolean} text_truncated
 * @property {string | null} author_name
 * @property {string | null} author_avatar_url
 * @property {string | null} reply_text
 * @property {string | null} reply_date
 * @property {number | null} likes
 * @property {number | null} photo_count
 */

/**
 * The nine fields, in a fixed key order.
 *
 * Built as an explicit object rather than passed through, so that a caller
 * handing over a whole review cannot accidentally contribute an extra field.
 * Adding one silently would change every hash in every ledger at once.
 *
 * @param {ContentHashInput} input
 * @returns {Record<string, unknown>}
 */
export function contentHashInputs(input) {
  return {
    rating: input.rating,
    text: input.text,
    text_truncated: input.text_truncated,
    author_name: input.author_name,
    author_avatar_url: input.author_avatar_url,
    reply_text: input.reply_text,
    reply_date: input.reply_date,
    likes: input.likes,
    photo_count: input.photo_count,
  };
}

/**
 * Computes the content hash over canonical bytes.
 *
 * Canonical serialisation means key insertion order cannot affect the result,
 * and that `null` and absent are distinguishable — both of which matter,
 * because a source that stops reporting `likes` has changed the review's
 * displayed content while a source that reports `likes: null` has not.
 *
 * @param {ContentHashInput} input
 * @returns {import('../util/result.mjs').Result<string, string>} 64 hex characters.
 */
export function deriveContentHash(input) {
  return hashObject(contentHashInputs(input));
}
