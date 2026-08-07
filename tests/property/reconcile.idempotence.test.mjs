import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createLedger } from '../../src/core/model/ledger.mjs';
import { isScaffold, reconcile } from '../../src/core/reconcile/index.mjs';
import {
  naiveNonIdempotent,
  naiveUnguardedAbsence,
  referenceReconcile,
  snapshot,
} from '../helpers/naive-reconcile.mjs';
import { NOW, completeHarvest, ledgerAndHarvest } from '../helpers/reconcile-generators.mjs';

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
 * ## A tension in the law worth knowing about before implementing it
 *
 * Every field reconciliation writes satisfies this for free *except one*.
 * `missing_streak` is defined by accumulation rather than by the observation, so
 * applying the same harvest twice counts the same absence twice. The literal law
 * is therefore false for the obvious streak implementation, and the counter-
 * example is not exotic — it is one `full` harvest with one absent record.
 *
 * That is not a defect in the law. It is the law doing its job: it says the
 * streak needs a "this harvest has already been counted" guard, and it says so
 * before the code exists rather than after a retry has tombstoned live reviews.
 * The mechanism is T-109's to choose; `Ledger.last_full_harvest_at` already
 * answers the question under a fixed `now` without a schema change.
 * `naive-reconcile.mjs` uses a per-record marker, and this law asserts only that
 * *some* guard is present, by rejecting the version with none.
 *
 * ## What is currently proven, honestly stated
 *
 * `core/reconcile/index.mjs` is a scaffold returning the prior ledger unchanged,
 * which is trivially idempotent. Its conformance below proves nothing and is
 * labelled as such. The law's teeth are the two rejections. T-109 turns the
 * scaffold assertion into a real one.
 */

const RUNS = 1000;

/**
 * Whether a generated case leaves at least one prior record unobserved, which is
 * the only way the streak path runs at all.
 *
 * @param {{ prior: Map<string, any>, observed: ReadonlyArray<any> }} sample
 * @returns {boolean}
 */
function hasAbsentRecord({ prior, observed }) {
  const observedIds = new Set(observed.map((entry) => entry.identity_hash));

  return [...prior.keys()].some((id) => !observedIds.has(id));
}

describe('PT-01 — reconciliation is idempotent (INV-04)', () => {
  it('applying the same harvest twice equals applying it once', () => {
    fc.assert(
      fc.property(ledgerAndHarvest(), (input) => {
        const once = referenceReconcile(input);
        const twice = referenceReconcile({ ...input, prior: once });

        return snapshot(twice) === snapshot(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('holds when absence is being counted, which is the hard case', () => {
    // Restricted to full/full_capped so the streak path always runs. On a
    // partial harvest the absence half returns immediately and idempotence is
    // inherited from PT-07 rather than tested here.
    fc.assert(
      fc.property(ledgerAndHarvest({ completeness: completeHarvest() }), (input) => {
        const once = referenceReconcile(input);
        const twice = referenceReconcile({ ...input, prior: once });

        return snapshot(twice) === snapshot(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('holds for ANY number of applications, not just the second', () => {
    // Distinct from the two-application case, and not implied by it in practice:
    // a guard that clears itself after use satisfies f(f(x)) = f(x) and then
    // drifts on the third application. A shard can be retried more than once,
    // so "twice is safe" is not the claim that needs to be true.
    fc.assert(
      fc.property(
        ledgerAndHarvest({ completeness: completeHarvest() }),
        fc.integer({ min: 2, max: 5 }),
        (input, applications) => {
          let ledger = referenceReconcile(input);

          for (let pass = 1; pass < applications; pass += 1) {
            ledger = referenceReconcile({ ...input, prior: ledger });
          }

          return snapshot(ledger) === snapshot(referenceReconcile(input));
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('does not mutate the prior ledger (LEDG-04)', () => {
    // Idempotence is unfalsifiable if the first application edited its input:
    // the comparison would be between two views of one mutated object.
    fc.assert(
      fc.property(ledgerAndHarvest(), (input) => {
        const before = snapshot(input.prior);
        referenceReconcile(input);

        return snapshot(input.prior) === before;
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
    // The reference with its idempotence guard removed. This is the one an
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
    const samples = fc.sample(ledgerAndHarvest({ completeness: completeHarvest() }), {
      numRuns: 200,
      seed: 11,
    });

    const withAbsences = samples.filter(hasAbsentRecord);

    expect(withAbsences.length).toBe(samples.length);
  });

  it('is vacuous against the scaffold, and says so', () => {
    // Stated rather than hidden. A function that changes nothing is trivially
    // idempotent; this proves the call shape, not the law. T-109 makes it real.
    expect(isScaffold()).toBe(true);

    const input = {
      prior: createLedger({ clientSlug: 'c', listingKey: 'main', now: NOW }),
      observed: [],
      report: /** @type {any} */ ({ stop_reason: 'target_reached' }),
      config: /** @type {any} */ ({ removalConfirmations: 3, denylist: new Set() }),
      now: NOW,
    };

    const once = reconcile(input);
    const twice = reconcile({ ...input, prior: once.ledger });

    expect(twice.ledger).toBe(once.ledger);
  });
});
