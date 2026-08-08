/**
 * Aggregates — computed from what is actually published (PROJ-04, TRD §24.5).
 *
 * ## The one rule this module exists to enforce
 *
 * **`advertised_total` is never substituted for `total_count`, and
 * `advertised_rating` is never substituted for `mean_rating`.** The advertised
 * figures are the source's claim; the computed figures are our observation.
 * Publishing the source's claim as though it were ours is the specific
 * dishonesty this product exists to avoid — a client whose page says "247
 * reviews, 4.8 stars" while the engine holds 180 of them is displaying a number
 * it cannot substantiate, on their own website, under their own name.
 *
 * Both are published side by side on purpose (TR-PROJ-031). Divergence means
 * either coverage is incomplete or extraction is wrong, and a consumer or a
 * monitoring check must be able to see that without access to internals.
 *
 * ## Filters run before aggregation
 *
 * TR-PROJ-021. `stats` describes what was published, not what was harvested. A
 * mean computed over reviews that were then filtered out would describe a
 * payload that does not exist.
 *
 * ## Why this is several small passes rather than one fused loop
 *
 * Each aggregate is a separate rule in TRD §24.5, and each is checkable against
 * that table on its own when it has its own named function. A single loop that
 * folds all of them at once is marginally faster and considerably harder to
 * audit — and the cost here is a handful of linear passes over an array the
 * reconciler has already walked several times, which does not register against
 * the phase's CPU budget.
 *
 * @module core/project/stats
 */

/** Rating values a distribution is keyed by. */
const RATING_KEYS = Object.freeze(['1', '2', '3', '4', '5']);

/** Two decimal places, per TRD §24.5. */
const MEAN_PRECISION = 100;

/** Coverage is a ratio; four places is enough to be useful and stable. */
const COVERAGE_PRECISION = 10_000;

/**
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 */
function round(value, precision) {
  return Math.round(value * precision) / precision;
}

/**
 * Whether a rating counts toward the mean and the distribution.
 *
 * A rating outside 1-5 is not clamped into the nearest bucket: it is a defect in
 * extraction, and folding it in would make the distribution disagree with the
 * mean while both looked plausible. `checkStatsConsistency` then reports the
 * shortfall rather than hiding it.
 *
 * @param {any} review
 * @returns {boolean}
 */
export function countableRating(review) {
  return typeof review.rating === 'number' && RATING_KEYS.includes(String(review.rating));
}

/**
 * Counts keyed "1".."5", with every key present even when a rating is unused.
 *
 * A missing key makes a consumer's star-bar rendering fall back to `undefined`
 * and draw nothing, which reads as a bug on the client's site.
 *
 * @param {ReadonlyArray<any>} published
 * @returns {Record<string, number>}
 */
export function buildDistribution(published) {
  return Object.fromEntries(
    RATING_KEYS.map((key) => [
      key,
      published.filter(
        (record) => countableRating(record.review) && String(record.review.rating) === key,
      ).length,
    ]),
  );
}

/**
 * Count per detected language code, in deterministic key order.
 *
 * `null` is excluded rather than counted under a key: "we could not tell" is not
 * a language, and bucketing it as one would let an adapter with broken detection
 * report a confident-looking distribution.
 *
 * Keys are sorted because insertion order follows harvest order, which is
 * unstable — two runs over the same data would otherwise serialise the same
 * object into different bytes and defeat hash-gating (TR-PROJ-012).
 *
 * @param {ReadonlyArray<any>} published
 * @returns {Record<string, number>}
 */
export function countLanguages(published) {
  /** @type {Map<string, number>} */
  const counts = new Map();

  for (const record of published) {
    const language = record.review.language;
    if (typeof language !== 'string' || language === '') continue;

    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * @typedef {object} StatsInput
 * @property {ReadonlyArray<any>} published  The post-filter, post-suppression records.
 * @property {number | null} advertisedTotal
 * @property {number | null} advertisedRating
 * @property {string} completeness
 * @property {string | null} lastFullHarvestAt
 */

/**
 * Computes the aggregate block.
 *
 * @param {StatsInput} input
 * @returns {import('../model/payload.mjs').Stats}
 */
export function computeStats({
  published,
  advertisedTotal,
  advertisedRating,
  completeness,
  lastFullHarvestAt,
}) {
  const rated = published.filter((record) => countableRating(record.review));
  const ratingTotal = rated.reduce((sum, record) => sum + record.review.rating, 0);
  const dates = published
    .map((record) => record.review.date_estimated)
    .filter((date) => typeof date === 'string');

  const totalCount = published.length;

  return Object.freeze({
    total_count: totalCount,
    advertised_total: advertisedTotal,
    coverage: computeCoverage(totalCount, advertisedTotal),
    mean_rating: rated.length === 0 ? 0 : round(ratingTotal / rated.length, MEAN_PRECISION),
    advertised_rating: advertisedRating,
    distribution: Object.freeze(buildDistribution(published)),
    with_text_count: published.filter((record) => hasText(record.review)).length,
    with_reply_count: published.filter((record) => hasOwnerReply(record.review)).length,
    newest_review_date: dates.length === 0 ? null : maxOf(dates),
    oldest_review_date: dates.length === 0 ? null : minOf(dates),
    languages: Object.freeze(countLanguages(published)),
    completeness,
    last_full_harvest_at: lastFullHarvestAt,
  });
}

/**
 * `total_count / advertised_total`, or null.
 *
 * Null when the source did not advertise a total, and null when it advertised
 * zero — dividing by it would produce `Infinity` or `NaN`, either of which
 * serialises into a payload as something a consumer cannot interpret.
 *
 * The ratio is NOT clamped to 1. Holding more reviews than the source currently
 * advertises is a real and informative state: it happens when reviews are
 * removed at the source but are still inside our confirmation window, and
 * clamping would hide exactly the discrepancy G-12 exists to notice.
 *
 * @param {number} totalCount
 * @param {number | null} advertisedTotal
 * @returns {number | null}
 */
export function computeCoverage(totalCount, advertisedTotal) {
  if (typeof advertisedTotal !== 'number' || advertisedTotal <= 0) return null;

  return round(totalCount / advertisedTotal, COVERAGE_PRECISION);
}

/**
 * Whether a review carries publishable text.
 *
 * @param {any} review
 * @returns {boolean}
 */
export function hasText(review) {
  return typeof review.text === 'string' && review.text.trim() !== '';
}

/**
 * @param {any} review
 * @returns {boolean}
 */
export function hasOwnerReply(review) {
  return review.owner_reply !== null && review.owner_reply !== undefined;
}

/** @param {ReadonlyArray<string>} values @returns {string} */
function maxOf(values) {
  return values.reduce((best, value) => (value > best ? value : best));
}

/** @param {ReadonlyArray<string>} values @returns {string} */
function minOf(values) {
  return values.reduce((best, value) => (value < best ? value : best));
}
