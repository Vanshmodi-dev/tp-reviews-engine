import { MAX_RATING, MIN_RATING } from '../model/review.mjs';
import { similarity } from '../util/similarity.mjs';
import { shouldQuarantine, validateRecord } from './record.mjs';

/**
 * Set-level validation: coverage, quarantine rate, duplicates, distribution.
 *
 * Like `record.mjs`, this **observes and reports**. It flags intra-run
 * duplicates; it does not remove them. Removal is reconciliation's job in
 * PH-05, and doing it here would mean two modules decide what exists.
 *
 * @module core/validate/aggregate
 */

/** @typedef {import('../model/report.mjs').Finding} Finding */

/** Generated from the model's bounds rather than restated, so there is one source of truth for the star scale. */
const RATINGS = Object.freeze(
  Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_unused, i) => MIN_RATING + i),
);
const PERCENT_SCALE = 100;

/**
 * Coverage: what fraction of the advertised total was actually extracted.
 *
 * Returns `null` when the source reports no total. **Null is not zero.**
 * Treating an unknown advertised total as 0 makes coverage infinite or
 * undefined; treating it as "we got everything" makes a partial harvest look
 * complete. Null propagates honestly, and gate rule G-08 knows what to do
 * with it.
 *
 * @param {number} extracted
 * @param {number | null | undefined} advertised
 * @returns {number | null}
 */
export function computeCoverage(extracted, advertised) {
  if (advertised === null || advertised === undefined || advertised <= 0) return null;

  // Capped at 1: a source under-reporting its own total should not produce
  // coverage of 1.4, which reads as a bug rather than as good news.
  return Math.min(1, extracted / advertised);
}

/**
 * Quarantine rate: the fraction of records too broken to publish.
 *
 * A high rate means the engine does not understand the data it is about to
 * publish, which is why gate rule G-06 is not overridable.
 *
 * @param {number} accepted
 * @param {number} quarantined
 * @returns {number}
 */
export function computeQuarantineRate(accepted, quarantined) {
  const total = accepted + quarantined;

  // No records at all is a rate of 0, not a division by zero. Whether an empty
  // harvest is acceptable is gate rule G-02's question, not this one's.
  return total === 0 ? 0 : quarantined / total;
}

/**
 * Rating distribution, keyed "1".."5".
 *
 * Always contains all five keys, including zeros. A distribution that omits
 * empty buckets makes a client's star bars disappear rather than show zero.
 *
 * @param {ReadonlyArray<any>} reviews
 * @returns {Record<string, number>}
 */
export function computeDistribution(reviews) {
  /** @type {Record<string, number>} */
  const distribution = {};
  for (const r of RATINGS) distribution[String(r)] = 0;

  for (const review of reviews) {
    const key = String(review?.rating);
    if (key in distribution) distribution[key] = (distribution[key] ?? 0) + 1;
  }

  return distribution;
}

/**
 * Mean rating over published reviews, to two decimal places.
 *
 * Computed, never copied from the source's advertised aggregate. The two are
 * different numbers and the difference is a signal — gate rule G-09 compares
 * them.
 *
 * @param {ReadonlyArray<any>} reviews
 * @returns {number}
 */
export function computeMeanRating(reviews) {
  if (reviews.length === 0) return 0;

  const total = reviews.reduce((sum, r) => sum + (Number(r?.rating) || 0), 0);
  return Math.round((total / reviews.length) * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Flags intra-run exact duplicates — same `identity_hash` seen twice.
 *
 * **Findings only. Nothing is removed.** Collapsing duplicates is §22.4's job
 * during reconciliation, and doing it here would mean the record set changes
 * shape during validation, which VAL-02 forbids.
 *
 * @param {ReadonlyArray<any>} reviews
 * @returns {Finding[]}
 */
export function findDuplicates(reviews) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Finding[]} */
  const findings = [];

  for (const review of reviews) {
    const id = review?.identity_hash;
    if (typeof id !== 'string') continue;

    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);

    if (count === 2) {
      findings.push(
        Object.freeze({
          code: 'ERR-VALIDATE-AGGREGATE',
          severity: 'warn',
          identity_hash: id,
          field: 'identity_hash',
          detail: 'identity appears more than once in this harvest',
        }),
      );
    }
  }

  return findings;
}

/**
 * Finds near-duplicate clusters: same author, high text similarity, different
 * identity.
 *
 * @param {ReadonlyArray<any>} reviews
 * @param {number} threshold
 * @returns {{ clusters: number, largest: number, findings: Finding[] }}
 */
export function findNearDuplicates(reviews, threshold) {
  /** @type {Finding[]} */
  const findings = [];
  let clusters = 0;
  let largest = 0;

  /** @type {Map<string, any[]>} */
  const byAuthor = new Map();
  for (const review of reviews) {
    const key = review?.author_key;
    if (typeof key !== 'string') continue;
    byAuthor.set(key, [...(byAuthor.get(key) ?? []), review]);
  }

  for (const group of byAuthor.values()) {
    if (group.length < 2) continue;

    const matches = pairwiseMatches(group, threshold);
    findings.push(...matches.findings);

    if (matches.size > 1) {
      clusters += 1;
      largest = Math.max(largest, matches.size);
    }
  }

  return { clusters, largest, findings };
}

/**
 * Compares every pair within one author's reviews.
 *
 * Split out of {@link findNearDuplicates} so neither function exceeds the
 * complexity limit - two nested loops plus three guards is more branching than
 * one function should carry.
 *
 * @param {ReadonlyArray<any>} group Reviews sharing an author key.
 * @param {number} threshold
 * @returns {{ size: number, findings: Finding[] }}
 */
function pairwiseMatches(group, threshold) {
  /** @type {Finding[]} */
  const findings = [];
  let size = 1;

  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      if (!isNearDuplicate(group[i], group[j], threshold)) continue;

      size += 1;
      findings.push(
        Object.freeze({
          code: 'ERR-VALIDATE-AGGREGATE',
          severity: 'warn',
          identity_hash: group[i]?.identity_hash ?? null,
          field: 'text',
          detail: 'near-duplicate of another review by the same author',
        }),
      );
    }
  }

  return { size, findings };
}

/**
 * Whether two reviews by the same author are near-duplicates of each other.
 *
 * Two records with the SAME identity are exact duplicates, which findDuplicates
 * already reports - counting them here too would double-report one problem.
 *
 * @param {any} a
 * @param {any} b
 * @param {number} threshold
 * @returns {boolean}
 */
function isNearDuplicate(a, b, threshold) {
  if (a?.identity_hash === b?.identity_hash) return false;

  return similarity(a?.text ?? '', b?.text ?? '') >= threshold;
}

/**
 * Assembles the full `ValidationReport`.
 *
 * @param {ReadonlyArray<any>} reviews
 * @param {object} context
 * @param {number | null} context.advertisedTotal
 * @param {number} context.nearDuplicateThreshold
 * @returns {import('../model/report.mjs').ValidationReport}
 */
export function validateAll(reviews, { advertisedTotal, nearDuplicateThreshold }) {
  /** @type {Finding[]} */
  const findings = [];
  let accepted = 0;
  let quarantined = 0;

  for (const review of reviews) {
    const recordFindings = validateRecord(review);
    findings.push(...recordFindings);
    if (shouldQuarantine(recordFindings)) quarantined += 1;
    else accepted += 1;
  }

  findings.push(...findDuplicates(reviews));

  const near = findNearDuplicates(reviews, nearDuplicateThreshold);
  findings.push(...near.findings);

  return Object.freeze({
    findings: Object.freeze(findings),
    accepted_count: accepted,
    quarantined_count: quarantined,
    quarantine_rate: computeQuarantineRate(accepted, quarantined),
    coverage: computeCoverage(reviews.length, advertisedTotal),
    near_duplicate_clusters: near.clusters,
    largest_duplicate_cluster: near.largest,
    has_fatal: findings.some((f) => f.severity === 'fatal'),
  });
}
