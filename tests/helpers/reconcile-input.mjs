/**
 * Builders for the reconciler's inputs.
 *
 * `reconcile` takes five things and every test needs four of them to be
 * uninteresting. These builders make the interesting one visible: a test that
 * says `harvest({ stopReason: 'stalled' })` is about stalling, and nothing else
 * in the call distracts from that.
 *
 * @module tests/helpers/reconcile-input
 */

import { applyBatch, createLedger, nextInsert } from '../../src/core/model/ledger.mjs';
import { buildNormalizedReview } from './build-review.mjs';

/** The instant a seeded ledger's prior harvest ran. */
export const T0 = '2026-02-01T00:00:00.000Z';

/** The instant the harvest under test runs. */
export const T1 = '2026-03-01T00:00:00.000Z';

/**
 * A 32-hex identity derived from a label, so failures name the record.
 *
 * @param {string | number} label
 * @returns {string}
 */
export function identity(label) {
  return String(label).padStart(32, '0').slice(-32);
}

/**
 * A `NormalizedReview` with a chosen identity and content.
 *
 * @param {string | number} label
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function review(label, overrides = {}) {
  return buildNormalizedReview({
    identity_hash: identity(label),
    content_hash: `content-${label}`.padEnd(64, '0'),
    ...overrides,
  });
}

/**
 * A ledger already holding the given reviews, as if from a prior full harvest.
 *
 * @param {ReadonlyArray<any>} reviews
 * @param {string} [now]
 * @returns {any}
 */
export function ledgerWith(reviews, now = T0) {
  const ledger = createLedger({ clientSlug: 'acme-dental', listingKey: 'main', now });

  // Batched, not one `insertReview` per review. Each single-record write copies
  // the whole record Map, so seeding n reviews that way is O(n²) — building the
  // 5,000-record fixture the budget suite uses cost 12.5 million entry copies
  // and made the SETUP the slowest thing in the run. The records are identical
  // either way; `nextInsert` is what `insertReview` computes with.
  const changes = reviews.map((record) => [
    record.identity_hash,
    nextInsert(undefined, record, now),
  ]);

  return applyBatch(ledger, /** @type {any} */ (changes), now);
}

/**
 * The ledger record for an identity, or a thrown error naming it.
 *
 * Tests assert on record fields constantly and `Map.get` is typed as possibly
 * undefined. Reaching for `?.` at every call site would let a missing record
 * compare `undefined` against `undefined` and pass silently; this fails loudly
 * and says which identity was absent.
 *
 * @param {any} ledger
 * @param {string} identityHash
 * @returns {any}
 */
export function recordOf(ledger, identityHash) {
  const record = ledger.records.get(identityHash);

  if (record === undefined) throw new Error(`no ledger record for ${identityHash}`);

  return record;
}

/**
 * A complete `ReconcileInput`.
 *
 * `stopReason` rather than `completeness`, deliberately: completeness is
 * *derived* from the navigator's stop reason and never set directly (VAL-01).
 * A builder that let a test set completeness would let a test assert a
 * behaviour the real pipeline cannot produce.
 *
 * @param {object} options
 * @param {any} options.prior
 * @param {ReadonlyArray<any>} [options.observed]
 * @param {string} [options.stopReason]
 * @param {ReadonlySet<string>} [options.denylist]
 * @param {number} [options.removalConfirmations]
 * @param {number} [options.nearDuplicateThreshold]
 * @param {string} [options.now]
 * @returns {any}
 */
export function harvest({
  prior,
  observed = [],
  stopReason = 'target_reached',
  denylist = new Set(),
  removalConfirmations = 3,
  nearDuplicateThreshold = 0.92,
  now = T1,
}) {
  return {
    prior,
    observed,
    report: { stop_reason: stopReason },
    config: { removalConfirmations, nearDuplicateThreshold, keepTombstones: true, denylist },
    now,
  };
}
