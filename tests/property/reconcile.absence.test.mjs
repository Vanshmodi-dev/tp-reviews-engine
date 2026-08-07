import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createLedger, insertReview } from '../../src/core/model/ledger.mjs';
import { isScaffold, reconcile } from '../../src/core/reconcile/index.mjs';
import { buildNormalizedReview } from '../helpers/build-review.mjs';
import { naiveUniformAbsence, referenceReconcile, snapshot } from '../helpers/naive-reconcile.mjs';

/**
 * PT-07 — **the most important test in the project** (T-099).
 *
 * For any `partial` or `failed` harvest, every prior record's streak, state,
 * and timestamps are unchanged. Absence is only evidence of removal when the
 * harvest actually looked.
 *
 * ## Why this law outranks the others
 *
 * PT-01 and PT-02 protect against nondeterminism, which is visible: a payload
 * churns, a diff appears, someone notices. PT-07 protects against something
 * invisible. A single stalled page load starts a countdown, and three harvests
 * later a paying client's entire review set is gone — with no error raised
 * anywhere, no failed job, and no alert. The engine will have done exactly what
 * it was told.
 *
 * TRD §22.5's Agent Note names the simplification by name: *"An implementer who
 * 'simplifies' this by treating absence uniformly has introduced the system's
 * worst possible bug."*
 *
 * ## What is currently proven, honestly stated
 *
 * `core/reconcile/index.mjs` is a scaffold that returns the prior ledger
 * unchanged. It satisfies this law **vacuously** — a function that changes
 * nothing trivially changes nothing on a partial harvest.
 *
 * So the law is stated against the scaffold *and* asserted to REJECT
 * `naiveUniformAbsence`, which is the documented simplification written out in
 * full. That rejection is what makes this law meaningful today. T-101 turns the
 * scaffold assertions into real ones.
 */

const RUNS = 1000;

/** Harvests that carry no information about absence. */
const incompleteCompleteness = () => fc.constantFrom('partial', 'failed');

/** Harvests where absence IS evidence. */
const completeCompleteness = () => fc.constantFrom('full', 'full_capped');

const identity = () =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 32, maxLength: 32 })
    .map((cs) => cs.join(''));

/** @param {string} id */
const priorRecord = (id) =>
  fc.record({
    identity_hash: fc.constant(id),
    content_hash: fc.constantFrom('c1', 'c2', 'c3'),
    state: fc.constantFrom('active', 'unconfirmed'),
    first_seen_at: fc.constant('2026-01-01T00:00:00.000Z'),
    last_seen_at: fc.constant('2026-02-01T00:00:00.000Z'),
    missing_streak: fc.integer({ min: 0, max: 2 }),
    tombstoned_at: fc.constant(null),
  });

/** A ledger of 1-12 prior records. */
const priorLedger = () =>
  fc
    .uniqueArray(identity(), { minLength: 1, maxLength: 12 })
    .chain((ids) => fc.tuple(...ids.map((id) => priorRecord(id))))
    .map((records) => new Map(records.map((r) => [r.identity_hash, r])));

/**
 * A harvest that observes only SOME of the prior ledger — so there is always at
 * least one absent record for the law to be about.
 *
 * A generator that happened to observe everything would make PT-07 pass for the
 * wrong reason, which is why the architect's stated check for T-099 is to
 * review this generator specifically.
 */
/** @param {Map<string, any>} prior */
const partialObservation = (prior) =>
  fc
    .subarray([...prior.keys()], { maxLength: Math.max(0, prior.size - 1) })
    .map((ids) => ids.map((id) => ({ identity_hash: id, content_hash: 'c-observed' })));

/**
 * Whether every record the harvest did NOT observe is byte-identical to how it
 * started. This is the whole of PT-07, expressed once.
 *
 * @param {Map<string, any>} prior
 * @param {Map<string, any>} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function absentRecordsUnchanged(prior, after, observed) {
  const observedIds = new Set(observed.map((o) => o.identity_hash));

  for (const [id, record] of after) {
    if (observedIds.has(id)) continue;
    const before = prior.get(id);
    if (before === undefined) return false;

    if (
      record.missing_streak !== before.missing_streak ||
      record.state !== before.state ||
      record.last_seen_at !== before.last_seen_at ||
      record.tombstoned_at !== before.tombstoned_at
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Whether every absent record's streak advanced by exactly one.
 *
 * @param {Map<string, any>} prior
 * @param {Map<string, any>} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function absentStreaksAdvanced(prior, after, observed) {
  const observedIds = new Set(observed.map((o) => o.identity_hash));

  for (const [id, record] of after) {
    if (observedIds.has(id)) continue;
    if (record.missing_streak !== (prior.get(id)?.missing_streak ?? -1) + 1) return false;
  }

  return true;
}

describe('PT-07 — absence is not deletion (INV-03)', () => {
  it('changes NOTHING on an incomplete harvest', () => {
    fc.assert(
      fc.property(
        priorLedger().chain((prior) =>
          fc.record({
            prior: fc.constant(prior),
            observed: partialObservation(prior),
            completeness: incompleteCompleteness(),
          }),
        ),
        ({ prior, observed, completeness }) => {
          const before = snapshot(prior);
          const after = referenceReconcile({
            prior,
            observed,
            completeness,
            removalConfirmations: 3,
            now: '2026-03-01T00:00:00.000Z',
          });

          // Only the OBSERVED records may change. Every absent record must be
          // byte-identical, including its streak and last_seen_at.
          return before.length > 0 && absentRecordsUnchanged(prior, after, observed);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('DOES increment the streak on a complete harvest', () => {
    // The other half of the asymmetry. A law that only asserted "nothing
    // changes" would be satisfied by a reconciler that never removes anything,
    // and tombstoning would silently stop working.
    fc.assert(
      fc.property(
        priorLedger().chain((prior) =>
          fc.record({
            prior: fc.constant(prior),
            observed: partialObservation(prior),
            completeness: completeCompleteness(),
          }),
        ),
        ({ prior, observed, completeness }) => {
          const after = referenceReconcile({
            prior,
            observed,
            completeness,
            removalConfirmations: 3,
            now: '2026-03-01T00:00:00.000Z',
          });

          return absentStreaksAdvanced(prior, after, observed);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('REJECTS a reconciler that treats absence uniformly', () => {
    // The law's teeth. naiveUniformAbsence is the exact simplification TRD
    // §22.5's Agent Note warns about, written out in full.
    const result = fc.check(
      fc.property(
        priorLedger().chain((prior) =>
          fc.record({ prior: fc.constant(prior), observed: partialObservation(prior) }),
        ),
        ({ prior, observed }) => {
          const after = naiveUniformAbsence({
            prior,
            observed,
            completeness: 'partial',
            removalConfirmations: 3,
            now: '2026-03-01T00:00:00.000Z',
          });

          // The naive version increments regardless of completeness, so the
          // absent records will NOT be unchanged - which is the rejection.
          return absentRecordsUnchanged(prior, after, observed);
        },
      ),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-07 failed to catch uniform absence handling').toBe(true);
  });

  it('shows the generator actually produces absent records', () => {
    // T-099's stated verification is an architect review of THIS generator. A
    // generator that always observed the whole ledger would make PT-07 pass
    // vacuously and nobody would know.
    const samples = fc.sample(
      priorLedger().chain((prior) =>
        fc.record({ prior: fc.constant(prior), observed: partialObservation(prior) }),
      ),
      { numRuns: 200, seed: 7 },
    );

    const withAbsences = samples.filter(({ prior, observed }) => observed.length < prior.size);

    expect(withAbsences.length).toBe(samples.length);
    expect(samples.some(({ observed }) => observed.length > 0)).toBe(true);
  });

  it('is vacuous against the scaffold, and says so', () => {
    // Stated rather than hidden: the real reconciler is not written yet, so its
    // conformance here proves nothing. T-101 makes this assertion real.
    expect(isScaffold()).toBe(true);

    const seeded = insertReview(
      createLedger({ clientSlug: 'c', listingKey: 'main', now: '2026-01-01T00:00:00.000Z' }),
      buildNormalizedReview(),
      '2026-01-01T00:00:00.000Z',
    ).ledger;

    const out = reconcile({
      prior: seeded,
      observed: [],
      report: /** @type {any} */ ({ stop_reason: 'stalled' }),
      config: /** @type {any} */ ({ removalConfirmations: 3, denylist: new Set() }),
      now: '2026-03-01T00:00:00.000Z',
    });

    // The scaffold returns the prior ledger untouched: nothing tombstoned,
    // nothing marked missing, and the ledger itself still sound.
    expect(out.decisions.tombstoned).toBe(0);
    expect(out.decisions.missing).toBe(0);
    expect(out.ledger).toBe(seeded);
    expect(out.invariantViolations).toEqual([]);
  });
});
