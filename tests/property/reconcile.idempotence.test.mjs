import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../../src/core/reconcile/index.mjs';
import {
  naiveNonIdempotent,
  naiveUnguardedAbsence,
  snapshot,
} from '../helpers/naive-reconcile.mjs';
import {
  completeHarvest,
  ledgerAndHarvest,
  qualifyingStopReason,
  realLedgerAndHarvest,
} from '../helpers/reconcile-generators.mjs';
import { harvest } from '../helpers/reconcile-input.mjs';
import { ledgerSnapshot } from '../helpers/ledger-snapshot.mjs';

/**
 * PT-01 — reconcile idempotence (T-097, INV-04).
 *
 * `reconcile(reconcile(L,H),H) ≡ reconcile(L,H)` for fixed `now`.
 *
 * ## What this buys
 *
 * A shard that crashes after reconciling but before committing can simply
 * re-run. That single sentence is load-bearing well beyond the reconciler:
 *
 * - Ledger rollback is a five-minute operation rather than a data-loss event,
 *   because a ledger restored to any prior state re-converges after one harvest
 *   (IMPL-PLAN §57).
 * - Publication is payload-then-state (PUB-01, EDR-025). That ordering is only
 *   self-healing because a re-run of the same harvest reproduces the same
 *   result; without idempotence a crash between the two writes is unrecoverable
 *   rather than self-correcting.
 * - A permanent push failure is survivable, because the next run reproduces
 *   byte-identical artifacts (CH-12).
 *
 * ## The one field that does not get this for free
 *
 * Every field reconciliation writes is derived from the observation or
 * explicitly preserved, so re-applying recomputes the same value. `missing_streak`
 * is the exception: it is defined by **accumulation**, so a second application of
 * the same harvest counts the same absence twice. At the default of three
 * confirmations, two replays of one harvest tombstone records that a single
 * application would have left merely `unconfirmed` — reviews pulled from a
 * client's site because a job was retried.
 *
 * `decideAbsent` guards it with `alreadyCounted`, which the merge derives from
 * `Ledger.last_full_harvest_at` under a fixed `now`. No new field was needed;
 * the ledger already recorded when it last absorbed a qualifying harvest.
 *
 * The law is asserted against the real reconciler **and** asserted to reject the
 * unguarded version, so the guard cannot be removed without a failure.
 */

const RUNS = 1000;

describe('PT-01 — reconciliation is idempotent (INV-04)', () => {
  it('applying the same harvest twice equals applying it once', () => {
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const once = reconcile(harvest({ prior, observed, stopReason, now }));
        const twice = reconcile(harvest({ prior: once.ledger, observed, stopReason, now }));

        return ledgerSnapshot(twice.ledger) === ledgerSnapshot(once.ledger);
      }),
      { numRuns: RUNS },
    );
  });

  it('holds when absence is being counted, which is the hard case', () => {
    // Restricted to stop reasons that classify as `full`/`full_capped`, so the
    // streak path always runs. On an inconclusive harvest idempotence is
    // inherited from PT-07 rather than tested here.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: qualifyingStopReason() }),
        ({ prior, observed, stopReason, now }) => {
          const once = reconcile(harvest({ prior, observed, stopReason, now }));
          const twice = reconcile(harvest({ prior: once.ledger, observed, stopReason, now }));

          return ledgerSnapshot(twice.ledger) === ledgerSnapshot(once.ledger);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('holds for ANY number of applications, not just the second', () => {
    // Not implied by the two-application case in practice: a guard that clears
    // itself after use satisfies f(f(x)) = f(x) and then drifts on the third.
    // A shard can be retried more than once.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: qualifyingStopReason() }),
        fc.integer({ min: 2, max: 5 }),
        ({ prior, observed, stopReason, now }, applications) => {
          const once = reconcile(harvest({ prior, observed, stopReason, now }));
          let ledger = once.ledger;

          for (let pass = 1; pass < applications; pass += 1) {
            ledger = reconcile(harvest({ prior: ledger, observed, stopReason, now })).ledger;
          }

          return ledgerSnapshot(ledger) === ledgerSnapshot(once.ledger);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('does not mutate the prior ledger (LEDG-04)', () => {
    // Idempotence is unfalsifiable if the first application edited its input:
    // the comparison would be between two views of one mutated object.
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const before = ledgerSnapshot(prior);
        reconcile(harvest({ prior, observed, stopReason, now }));

        return ledgerSnapshot(prior) === before;
      }),
      { numRuns: RUNS },
    );
  });

  it('reports no invariant violations on either application', () => {
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const once = reconcile(harvest({ prior, observed, stopReason, now }));
        const twice = reconcile(harvest({ prior: once.ledger, observed, stopReason, now }));

        return once.invariantViolations.length === 0 && twice.invariantViolations.length === 0;
      }),
      { numRuns: RUNS },
    );
  });

  it('REJECTS a reconciler that accumulates per application', () => {
    // naiveNonIdempotent keeps an observation counter - a reasonable-sounding
    // field that makes a retry double-count.
    const result = fc.check(
      fc.property(ledgerAndHarvest(), (input) => {
        const once = naiveNonIdempotent(input);
        const twice = naiveNonIdempotent({ ...input, prior: once });

        return snapshot(twice) === snapshot(once);
      }),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-01 failed to catch per-application accumulation').toBe(true);
  });

  it('REJECTS a streak that is counted again on every application', () => {
    // The real reconciler with its idempotence guard removed. This is the one an
    // implementer actually writes, and the one that tombstones live reviews
    // because a job was retried.
    const result = fc.check(
      fc.property(ledgerAndHarvest({ completeness: completeHarvest() }), (input) => {
        const once = naiveUnguardedAbsence(input);
        const twice = naiveUnguardedAbsence({ ...input, prior: once });

        return snapshot(twice) === snapshot(once);
      }),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-01 failed to catch an unguarded missing_streak').toBe(true);
  });

  it('shows the generator produces the case the law is about', () => {
    // A generator whose harvests always observed the whole ledger would make
    // both rejections above impossible, and the law would pass for the wrong
    // reason. Every case must have something absent for a streak to count.
    const samples = fc.sample(realLedgerAndHarvest({ stopReason: qualifyingStopReason() }), {
      numRuns: 200,
      seed: 11,
    });

    expect(samples.every(hasAbsentRecord)).toBe(true);
  });
});

/**
 * Whether a generated case leaves at least one prior record unobserved, which is
 * the only way the streak path runs at all.
 *
 * @param {{ prior: any, observed: ReadonlyArray<any> }} sample
 * @returns {boolean}
 */
function hasAbsentRecord({ prior, observed }) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  return [...prior.records.keys()].some((id) => !observedIds.has(id));
}
