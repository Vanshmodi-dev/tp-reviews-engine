/**
 * The publication order — a **total** ordering over reviews (PROJ-01).
 *
 * ## Why totality is the requirement, not "sorted by date"
 *
 * The obvious sort is newest first, by `date_estimated`. It is not enough, and
 * the reason is specific: most sources publish *relative* dates, so pinned
 * estimates cluster hard. Twenty reviews from the same week frequently share a
 * `date_estimated` to the day, and coarse precision makes whole months
 * identical.
 *
 * A comparator that returns 0 for those leaves their relative order to the
 * sort's implementation and to the order they happened to arrive in. That is
 * not a cosmetic problem:
 *
 * - The payload bytes change, so the content hash changes, so hash-gating stops
 *   suppressing the write and every run commits.
 * - `latest.json` is the head of this order, so its contents shuffle between
 *   runs and a client's widget reorders itself for no reason a visitor can see.
 * - PT-12's byte-identical claim becomes false, and with it the whole
 *   "artifacts are reproducible" argument.
 *
 * So the key is `(date_estimated desc, first_seen_at desc, identity_hash asc)`,
 * and the final component is what makes it total: two distinct reviews cannot
 * share an identity hash, so the comparator returns 0 only for a review and
 * itself. PT-13 asserts exactly that.
 *
 * ## Nulls sort last, deliberately
 *
 * A review with no usable date is not "very old"; it is unknown. Sorting it as
 * the oldest is a guess presented as a fact, and it would push genuinely old
 * reviews off the end of `latest.json` in its favour.
 *
 * @module core/project/order
 */

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {number} Descending, with null and undefined last.
 */
function compareDatesDescending(a, b) {
  const left = a ?? null;
  const right = b ?? null;

  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  // RFC 3339 UTC strings with fixed width compare correctly as strings, which
  // avoids constructing two Date objects per comparison — a real cost at the
  // thousands-of-reviews sizes this runs at.
  return left < right ? 1 : -1;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} Ascending.
 */
function compareAscending(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The composite comparator over `LedgerReview` records.
 *
 * @param {any} left
 * @param {any} right
 * @returns {number}
 */
export function compareForPublication(left, right) {
  const byDate = compareDatesDescending(left.review.date_estimated, right.review.date_estimated);
  if (byDate !== 0) return byDate;

  const bySeen = compareDatesDescending(left.first_seen_at, right.first_seen_at);
  if (bySeen !== 0) return bySeen;

  // The totality guarantee. Two distinct reviews cannot share an identity hash,
  // so this returns 0 only when a record is compared with itself.
  return compareAscending(left.review.identity_hash, right.review.identity_hash);
}

/**
 * The same ordering reversed, for `display.order: 'oldest'`.
 *
 * Reversing the *whole* key rather than only the date keeps the ordering total
 * in both directions. Reversing just the date would leave the tiebreak pointing
 * the same way and produce an order that is neither newest-first nor a genuine
 * mirror of it.
 *
 * @param {any} left
 * @param {any} right
 * @returns {number}
 */
export function compareForPublicationReversed(left, right) {
  return -compareForPublication(left, right);
}

/**
 * Orders records for publication.
 *
 * Returns a new array; the input is never sorted in place, because the caller's
 * array is derived from the ledger and reconciliation's purity guarantee stops
 * being true the moment a projector reorders something it was handed.
 *
 * @param {ReadonlyArray<any>} records
 * @param {string} [order] `newest` (default) or `oldest`.
 * @returns {any[]}
 */
export function orderForPublication(records, order = 'newest') {
  const comparator = order === 'oldest' ? compareForPublicationReversed : compareForPublication;

  return [...records].sort(comparator);
}
