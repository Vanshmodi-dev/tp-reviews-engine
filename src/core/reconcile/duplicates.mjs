/**
 * Duplicate handling — three different problems that are easy to confuse.
 *
 * | Kind | Definition | What happens |
 * |---|---|---|
 * | **Intra-run exact** | Two records in ONE harvest with the same `identity_hash` | Collapsed to one, deterministically |
 * | **Cross-run same** | An observed record matches a ledger record's `identity_hash` | UPDATE or UNCHANGED — not a duplicate at all |
 * | **Near-duplicate** | Same `author_key`, similar text, DIFFERENT `identity_hash` | A `warn` finding and gate rule G-11. **Nothing is merged.** |
 *
 * The third row is the one that gets implemented wrongly. A near-duplicate is
 * **reported, never collapsed**. Twelve different people leaving "Great!" on the
 * same listing produce twelve near-duplicate pairs and twelve surviving records,
 * because they are twelve genuine reviews by twelve genuine authors. Merging
 * them would delete eleven real reviews to tidy up a warning.
 *
 * That is why every near-duplicate comparison is scoped to a single
 * `author_key` (DUP-01). Short review text collides constantly across authors
 * and almost never means anything; within one author it usually means an edit.
 *
 * ## Why the comparison is bucketed (DUP-02, IR-15)
 *
 * Comparing every review against every other is O(n²): invisible at 100 reviews
 * and roughly 12.5 million comparisons at 5,000. Bucketing by `author_key`
 * first makes the cost the sum of the squares of the bucket sizes, and real
 * buckets hold one or two reviews. The quadratic version is not slightly
 * slower; it is the difference between a two-second pass and a timeout.
 *
 * @module core/reconcile/duplicates
 */

import { bigramProfile, similarityOf } from '../util/similarity.mjs';

/**
 * Reported similarity is rounded to four decimals.
 *
 * Two runs over identical data must produce byte-identical reports, and the last
 * places of a floating-point ratio are exactly where two builds can disagree.
 */
const SIMILARITY_PRECISION = 10_000;

/**
 * @typedef {object} NearDuplicatePair
 * @property {string} author_key
 * @property {string} left        `identity_hash` of the earlier record.
 * @property {string} right       `identity_hash` of the later record.
 * @property {number} similarity  Rounded to four decimals for stable reporting.
 */

/**
 * @typedef {object} CollapseResult
 * @property {any[]} records       One record per `identity_hash`, in identity order.
 * @property {number} collisions   How many records were discarded.
 */

/**
 * Counts fields that carry an actual value.
 *
 * `author` is walked rather than counted as one, because that object is exactly
 * where two renderings of the same review differ — one has the avatar and
 * profile URL, the other was clipped before they loaded. Counting it as a single
 * field would make the more complete record and the less complete one tie.
 *
 * @param {any} review
 * @returns {number}
 */
function nonNullFieldCount(review) {
  let count = 0;

  for (const [key, value] of Object.entries(review)) {
    if (value === null || value === undefined) continue;

    if (key === 'author' && typeof value === 'object') {
      count += Object.values(value).filter((inner) => inner !== null && inner !== undefined).length;
      continue;
    }

    count += 1;
  }

  return count;
}

/** @param {any} review @returns {number} */
function textLength(review) {
  return review.text === null || review.text === undefined ? 0 : [...String(review.text)].length;
}

/**
 * TR-REC-002's total ordering. Returns true when `candidate` beats `held`.
 *
 * The first three tests are normative: more non-null fields, then longer text,
 * then the earlier node ordinal. The fourth — lexicographic `content_hash` — is
 * this module's addition, and it is required rather than decorative: two
 * records can tie on all three normative tests, and a comparison that returns
 * "neither" for a tie falls back to whichever the loop reached first. That is
 * iteration order, which is what DUP-03 exists to forbid.
 *
 * The node ordinal is a *field on the record*, not a position in the array, so
 * reading it does not make the result depend on the order the records arrive in
 * (TR-EXT-031).
 *
 * @param {any} candidate
 * @param {any} held
 * @returns {boolean}
 */
function beats(candidate, held) {
  const byFields = nonNullFieldCount(candidate) - nonNullFieldCount(held);
  if (byFields !== 0) return byFields > 0;

  const byText = textLength(candidate) - textLength(held);
  if (byText !== 0) return byText > 0;

  const candidateOrdinal = ordinalOf(candidate);
  const heldOrdinal = ordinalOf(held);
  if (candidateOrdinal !== heldOrdinal) return candidateOrdinal < heldOrdinal;

  return String(candidate.content_hash) < String(held.content_hash);
}

/**
 * @param {any} review
 * @returns {number} The node ordinal, or Infinity when absent so that a record
 *   carrying one always beats a record that does not.
 */
function ordinalOf(review) {
  return Number.isFinite(review.node_ordinal) ? review.node_ordinal : Number.POSITIVE_INFINITY;
}

/**
 * Collapses records colliding on `identity_hash` within one harvest
 * (TR-REC-001, TR-REC-002, DUP-03).
 *
 * TR-REC-003 places collapse in validation rather than here, and that is where
 * the `warn` finding is raised. This runs anyway, because the merge must be
 * correct for any input it is handed and a caller that skipped validation would
 * otherwise produce an order-dependent ledger — the one defect PT-02 exists to
 * catch. Collapsing an already-collapsed harvest is a no-op.
 *
 * @param {ReadonlyArray<any>} observed
 * @returns {CollapseResult}
 */
export function collapseIntraRun(observed) {
  /** @type {Map<string, any>} */
  const winners = new Map();
  let collisions = 0;

  for (const review of observed) {
    const held = winners.get(review.identity_hash);

    if (held === undefined) {
      winners.set(review.identity_hash, review);
      continue;
    }

    collisions += 1;
    if (beats(review, held)) winners.set(review.identity_hash, review);
  }

  const records = [...winners.values()].sort((a, b) =>
    a.identity_hash < b.identity_hash ? -1 : a.identity_hash > b.identity_hash ? 1 : 0,
  );

  return { records, collisions };
}

/**
 * Groups records by `author_key` (DUP-02).
 *
 * Records with no author key are dropped rather than pooled into a shared
 * bucket. An anonymous bucket would compare every anonymous reviewer against
 * every other, which is both the quadratic case this avoids and a guaranteed
 * source of false positives — anonymous short reviews are the most likely text
 * in the corpus to collide.
 *
 * @param {ReadonlyArray<any>} records
 * @returns {Map<string, any[]>}
 */
export function bucketByAuthor(records) {
  /** @type {Map<string, any[]>} */
  const buckets = new Map();

  for (const review of records) {
    const key = review.author_key;
    if (typeof key !== 'string' || key === '') continue;

    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [review]);
    else bucket.push(review);
  }

  return buckets;
}

/**
 * Finds near-duplicate pairs: same author, similar text, different identity.
 *
 * **Reports only.** Nothing is merged, nothing is removed, and the returned
 * pairs become a `warn` finding and an input to gate rule G-11.
 *
 * @param {ReadonlyArray<any>} records
 * @param {number} threshold Similarity at or above which a pair is reported.
 * @returns {NearDuplicatePair[]}
 */
export function findNearDuplicates(records, threshold) {
  /** @type {NearDuplicatePair[]} */
  const pairs = [];

  // Buckets are walked in author order, and pairs within a bucket are emitted in
  // identity order, so the reported list is a property of the data rather than
  // of the harvest — which PT-12 needs and a reader comparing two runs assumes
  // anyway.
  const buckets = [...bucketByAuthor(records).entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const [authorKey, bucket] of buckets) {
    collectPairs(bucket, authorKey, threshold, pairs);
  }

  return pairs.sort(
    (a, b) =>
      compare(a.author_key, b.author_key) || compare(a.left, b.left) || compare(a.right, b.right),
  );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The within-bucket comparison. Quadratic **inside one author's bucket only**,
 * which is the point of bucketing: real buckets hold one or two records.
 *
 * ## The length bound, and why it is exact
 *
 * Dice similarity is `2·shared / (totalA + totalB)` over character bigrams, and
 * `shared` can never exceed `min(totalA, totalB)`. So
 * `2·min / (totalA + totalB)` is a hard ceiling on the score, computable from
 * the two lengths alone without comparing a single bigram.
 *
 * Sorting the bucket by bigram count makes that ceiling *fall monotonically* as
 * the inner loop advances, so the first pair that cannot reach the threshold
 * proves none of the rest can either, and the loop breaks. No pair that would
 * have been reported is skipped — this changes the cost, never the result.
 *
 * It matters because a bucket is only small when the author key is working. An
 * adapter that derived one key for every anonymous reviewer would put the whole
 * listing in a single bucket, and the bound is what keeps that from becoming a
 * quarter of a million text comparisons.
 *
 * @param {ReadonlyArray<any>} bucket
 * @param {string} authorKey
 * @param {number} threshold
 * @param {NearDuplicatePair[]} sink
 * @returns {void}
 */
function collectPairs(bucket, authorKey, threshold, sink) {
  // Each profile is built once, not once per comparison. Rebuilding them inside
  // the loop makes an n-record bucket do n² foldings of the same text.
  const byLength = bucket
    .map((review) => ({ review, profile: bigramProfile(String(review.text ?? '')) }))
    .sort((a, b) => a.profile.total - b.profile.total || compareIdentity(a.review, b.review));

  for (const [i, left] of byLength.entries()) {
    for (let j = i + 1; j < byLength.length; j += 1) {
      // The loop bound guarantees this index is populated; the assertion says so
      // rather than adding a branch that can never be taken and never covered.
      const right = /** @type {ProfiledReview} */ (byLength[j]);

      if (!canReachThreshold(left.profile.total, right.profile.total, threshold)) break;
      if (left.review.identity_hash === right.review.identity_hash) continue;

      const score = similarityOf(left.profile, right.profile);
      if (score < threshold) continue;

      sink.push(pairOf(authorKey, left.review, right.review, score));
    }
  }
}

/**
 * @typedef {object} ProfiledReview
 * @property {any} review
 * @property {import('../util/similarity.mjs').BigramProfile} profile
 */

/**
 * Whether two texts of these sizes could possibly score at or above `threshold`.
 *
 * @param {number} smaller
 * @param {number} larger
 * @param {number} threshold
 * @returns {boolean}
 */
function canReachThreshold(smaller, larger, threshold) {
  // Degenerate texts produce no bigrams, and `similarity` resolves those by
  // string equality rather than by overlap. Never prune them.
  if (smaller === 0 || larger === 0) return true;

  return (2 * smaller) / (smaller + larger) >= threshold;
}

/**
 * Pairs are reported in identity order so the two sides do not swap depending on
 * which text happened to be shorter.
 *
 * @param {string} authorKey
 * @param {any} a
 * @param {any} b
 * @param {number} score
 * @returns {NearDuplicatePair}
 */
function pairOf(authorKey, a, b, score) {
  const [left, right] = compareIdentity(a, b) <= 0 ? [a, b] : [b, a];

  return {
    author_key: authorKey,
    left: left.identity_hash,
    right: right.identity_hash,
    similarity: Math.round(score * SIMILARITY_PRECISION) / SIMILARITY_PRECISION,
  };
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function compareIdentity(a, b) {
  return a.identity_hash < b.identity_hash ? -1 : a.identity_hash > b.identity_hash ? 1 : 0;
}

/**
 * Whether an observed identity already exists in the ledger — duplicate
 * detection tier 1 (T-102).
 *
 * A one-line map lookup rather than a scan, and named rather than inlined
 * because "have we seen this before" is a question worth being able to find.
 * The map is what keeps this O(1); an array-backed ledger would make the merge
 * O(n²) at the thousand-review listings this system is built for (IR-24).
 *
 * @param {import('../model/ledger.mjs').Ledger} ledger
 * @param {string} identityHash
 * @returns {boolean}
 */
export function isKnownIdentity(ledger, identityHash) {
  return ledger.records.has(identityHash);
}
