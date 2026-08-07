import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../../src/core/reconcile/index.mjs';
import { naiveUniformAbsence, snapshot } from '../helpers/naive-reconcile.mjs';
import {
  inconclusiveStopReason,
  ledgerAndHarvest,
  observationOf,
  priorLedger,
  qualifyingStopReason,
  realLedgerAndHarvest,
} from '../helpers/reconcile-generators.mjs';
import { harvest } from '../helpers/reconcile-input.mjs';

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
 * ## Both halves are asserted
 *
 * Nothing changes on `partial`/`failed`, **and** the streak advances on
 * `full`/`full_capped`. A law asserting only the first would be satisfied by a
 * reconciler that never removes anything, and tombstoning would silently stop
 * working — a failure in the opposite direction that is just as invisible.
 *
 * The generator guarantees at least one absent record per case. A generator
 * that happened to observe the whole ledger would make this pass for the wrong
 * reason, which is why T-099's stated verification is an architect review of the
 * generator specifically. A test below asserts that property directly.
 */

const RUNS = 1000;

/**
 * Whether every record the harvest did NOT observe is byte-identical to how it
 * started. This is the whole of PT-07, expressed once.
 *
 * @param {any} prior
 * @param {any} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function absentRecordsUnchanged(prior, after, observed) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  for (const [id, record] of prior.records) {
    if (observedIds.has(id)) continue;

    if (JSON.stringify(after.records.get(id)) !== JSON.stringify(record)) return false;
  }

  return true;
}

/**
 * Whether every absent, non-terminal record's streak advanced by exactly one.
 *
 * @param {any} prior
 * @param {any} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function absentStreaksAdvanced(prior, after, observed) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  for (const [id, record] of prior.records) {
    if (observedIds.has(id)) continue;
    if (record.state === 'tombstoned' || record.state === 'suppressed') continue;

    if (after.records.get(id)?.missing_streak !== record.missing_streak + 1) return false;
  }

  return true;
}

describe('PT-07 — absence is not deletion (INV-03)', () => {
  it('changes NOTHING on an inconclusive harvest', () => {
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: inconclusiveStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed, stopReason, now }));

          return absentRecordsUnchanged(prior, out.ledger, observed);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('DOES increment the streak on a qualifying harvest', () => {
    // The other half of the asymmetry.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: qualifyingStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed, stopReason, now }));

          return absentStreaksAdvanced(prior, out.ledger, observed);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('reports every held absence rather than hiding it', () => {
    // "Nothing changed" and "nothing was considered" look identical in a ledger
    // diff. The decision log is the only place they differ, and an operator
    // needs to see that the engine looked and declined.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: inconclusiveStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed, stopReason, now }));

          return out.decisions.missing === 0 && out.decisions.tombstoned === 0;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('never advances the freshness signal on an inconclusive harvest', () => {
    // `last_full_harvest_at` is what a client is told about freshness. A stalled
    // run must not make stale data look newly verified.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: inconclusiveStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed, stopReason, now }));

          return out.ledger.last_full_harvest_at === prior.last_full_harvest_at;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('still merges additions on an inconclusive harvest', () => {
    // Observation is always evidence; only ABSENCE is conditional. Refusing new
    // reviews on a partial harvest is a different bug in the opposite direction,
    // and a payload that never grows during a bad week.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: inconclusiveStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed, stopReason, now }));

          return everyFreshIdentityLanded(prior, out.ledger, observed);
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
          fc.record({ prior: fc.constant(prior), observed: observationOf(prior) }),
        ),
        ({ prior, observed }) => {
          const after = naiveUniformAbsence({
            prior,
            observed,
            completeness: 'partial',
            removalConfirmations: 3,
            now: '2026-03-01T00:00:00.000Z',
          });
          return plainStreaksUnchanged(prior, after, observed);
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
    const samples = fc.sample(realLedgerAndHarvest(), { numRuns: 200, seed: 7 });

    const withAbsences = samples.filter(hasAbsentRecord);

    expect(withAbsences.length).toBe(samples.length);
    expect(samples.some(({ observed }) => observed.length > 0)).toBe(true);
  });

  it('holds the whole ledger when the harvest observed nothing at all', () => {
    // The degenerate stall: the page yielded not one review. Every record is
    // absent, and on an inconclusive harvest not one of them may move.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: inconclusiveStopReason() }),
        ({ prior, stopReason, now }) => {
          const out = reconcile(harvest({ prior, observed: [], stopReason, now }));

          return (
            out.decisions.held === prior.records.size - terminalCount(prior) &&
            absentRecordsUnchanged(prior, out.ledger, [])
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('leaves the naive counterexample provably different from the real merge', () => {
    // A sanity check on the counterexample itself: if `naiveUniformAbsence`
    // ever stopped differing from correct behaviour, the rejection above would
    // pass while proving nothing.
    const sample = fc.sample(ledgerAndHarvest({ completeness: fc.constant('partial') }), {
      numRuns: 1,
      seed: 3,
    })[0];

    expect(snapshot(naiveUniformAbsence(sample))).not.toBe(snapshot(sample.prior));
  });
});

/**
 * @param {any} ledger
 * @returns {number}
 */
function terminalCount(ledger) {
  return [...ledger.records.values()].filter(
    (record) => record.state === 'tombstoned' || record.state === 'suppressed',
  ).length;
}

/**
 * Whether every identity this harvest saw for the first time is now in the
 * ledger. Additions are unconditional; only absence is gated.
 *
 * @param {any} prior
 * @param {any} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function everyFreshIdentityLanded(prior, after, observed) {
  for (const entry of observed) {
    if (prior.records.has(entry.identity_hash)) continue;
    if (!after.records.has(entry.identity_hash)) return false;
  }

  return true;
}

/**
 * The plain-Map equivalent of `absentRecordsUnchanged`, for the naive
 * counterexample, which operates on Maps rather than on a `Ledger`.
 *
 * @param {Map<string, any>} prior
 * @param {Map<string, any>} after
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function plainStreaksUnchanged(prior, after, observed) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  for (const [id, record] of prior) {
    if (observedIds.has(id)) continue;
    if (after.get(id)?.missing_streak !== record.missing_streak) return false;
  }

  return true;
}

/**
 * @param {{ prior: any, observed: ReadonlyArray<any> }} sample
 * @returns {boolean}
 */
function hasAbsentRecord({ prior, observed }) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  return [...prior.records.keys()].some((id) => !observedIds.has(id));
}
