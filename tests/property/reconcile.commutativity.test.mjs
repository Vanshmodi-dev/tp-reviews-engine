import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createLedger } from '../../src/core/model/ledger.mjs';
import { isScaffold, reconcile } from '../../src/core/reconcile/index.mjs';
import { naiveOrderDependent, referenceReconcile, snapshot } from '../helpers/naive-reconcile.mjs';
import {
  NOW,
  completeHarvest,
  ledgerAndHarvestShuffled,
  permutationOf,
} from '../helpers/reconcile-generators.mjs';

/**
 * PT-02 — reconcile commutativity (T-098).
 *
 * Shuffling `observed` yields an identical ledger.
 *
 * ## Why order-independence is not a nicety here
 *
 * Upstream ordering is unstable and personalised. The same listing, fetched
 * twice, returns the same reviews in a different order — sometimes because the
 * source re-ranks by "most relevant", sometimes because a page re-rendered
 * mid-scroll. None of that is a change to the data.
 *
 * An order-dependent reconciler turns that noise into a different ledger, and a
 * different ledger means a different payload, and a different payload is
 * published. So every run writes, every run pushes, and the artifacts never
 * settle — while nothing about the reviews has actually changed. The git history
 * fills with diffs that mean nothing, hash-gating stops suppressing anything,
 * and the one signal that a payload changed for a real reason is gone.
 *
 * ## Where order-dependence actually enters
 *
 * Not from iterating a list — from **intra-run duplicates**. One crawl can yield
 * the same `identity_hash` twice with different content, because a paginated
 * list re-rendered while it was being read. Something must choose a survivor,
 * and "last write wins" is the natural choice and the wrong one.
 *
 * DUP-03 requires the survivor be chosen by a **total ordering** over the
 * records themselves. This is the law that makes that requirement enforceable,
 * and it is why the generator produces duplicates deliberately: with unique
 * identities every reconciler is commutative, including the broken ones, and
 * the law would pass against anything.
 *
 * ## What is currently proven, honestly stated
 *
 * `core/reconcile/index.mjs` ignores `observed` entirely, so it is commutative
 * vacuously. That case is labelled. The law's teeth are the rejection of
 * `naiveOrderDependent`. T-105 and T-109 make it real.
 */

const RUNS = 1000;

describe('PT-02 — reconciliation is order-independent', () => {
  it('a shuffled harvest yields an identical ledger', () => {
    fc.assert(
      fc.property(ledgerAndHarvestShuffled(), ({ input, shuffled }) => {
        const inOrder = referenceReconcile(input);
        const reordered = referenceReconcile({ ...input, observed: shuffled });

        return snapshot(reordered) === snapshot(inOrder);
      }),
      { numRuns: RUNS },
    );
  });

  it('holds when absence is also being counted', () => {
    // The absence half iterates the ledger rather than the harvest, so it has
    // its own opportunity to be order-sensitive - particularly since it writes
    // to the same map it is iterating.
    fc.assert(
      fc.property(
        ledgerAndHarvestShuffled({ completeness: completeHarvest() }),
        ({ input, shuffled }) => {
          const inOrder = referenceReconcile(input);
          const reordered = referenceReconcile({ ...input, observed: shuffled });

          return snapshot(reordered) === snapshot(inOrder);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('holds across many independent reorderings of one harvest', () => {
    // Two orderings agreeing can be luck when a harvest is small. Requiring one
    // canonical result across several permutations is the claim that matters:
    // there is a single answer, not a pair that happen to coincide.
    fc.assert(
      fc.property(
        ledgerAndHarvestShuffled({ completeness: completeHarvest() }).chain(({ input }) =>
          fc.record({
            input: fc.constant(input),
            orderings: fc.array(permutationOf(input.observed), { minLength: 2, maxLength: 4 }),
          }),
        ),
        ({ input, orderings }) => allOrderingsAgree(input, orderings),
      ),
      { numRuns: 300 },
    );
  });

  it('REJECTS a reconciler that lets the last duplicate win', () => {
    // The law's teeth. naiveOrderDependent resolves duplicates by iteration
    // order, which is exactly what DUP-03 forbids.
    const result = fc.check(
      fc.property(
        ledgerAndHarvestShuffled({ completeness: completeHarvest() }),
        ({ input, shuffled }) => {
          const inOrder = naiveOrderDependent(input);
          const reordered = naiveOrderDependent({ ...input, observed: shuffled });

          return snapshot(reordered) === snapshot(inOrder);
        },
      ),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-02 failed to catch last-write-wins duplicate resolution').toBe(true);
  });

  it('shows the generator produces the duplicates the law depends on', () => {
    // Without intra-run duplicates every reconciler is commutative, including
    // the broken one, and the rejection above becomes impossible. This asserts
    // the generator reaches the case rather than assuming it.
    const samples = fc.sample(ledgerAndHarvestShuffled({ completeness: completeHarvest() }), {
      numRuns: 200,
      seed: 13,
    });

    const withDuplicates = samples.filter(({ input }) => hasDuplicateIdentity(input.observed));
    const reordered = samples.filter(
      ({ input, shuffled }) => !sameOrder(input.observed, shuffled) && shuffled.length > 1,
    );

    expect(withDuplicates.length).toBeGreaterThan(0);
    expect(reordered.length).toBeGreaterThan(0);
  });

  it('is vacuous against the scaffold, and says so', () => {
    // The scaffold ignores `observed` completely, so shuffling it cannot change
    // anything. This proves the call shape, not the law.
    expect(isScaffold()).toBe(true);

    const base = {
      prior: createLedger({ clientSlug: 'c', listingKey: 'main', now: NOW }),
      report: /** @type {any} */ ({ stop_reason: 'target_reached' }),
      config: /** @type {any} */ ({ removalConfirmations: 3, denylist: new Set() }),
      now: NOW,
    };

    const forward = reconcile({
      ...base,
      observed: [{ identity_hash: 'a' }, { identity_hash: 'b' }],
    });
    const backward = reconcile({
      ...base,
      observed: [{ identity_hash: 'b' }, { identity_hash: 'a' }],
    });

    expect(forward.ledger.records.size).toBe(backward.ledger.records.size);
  });
});

/**
 * Whether every ordering of one harvest produces the same ledger.
 *
 * @param {any} input
 * @param {ReadonlyArray<any[]>} orderings
 * @returns {boolean}
 */
function allOrderingsAgree(input, orderings) {
  const canonical = snapshot(referenceReconcile(input));

  return orderings.every(
    (observed) => snapshot(referenceReconcile({ ...input, observed })) === canonical,
  );
}

/**
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function hasDuplicateIdentity(observed) {
  return new Set(observed.map((entry) => entry.identity_hash)).size < observed.length;
}

/**
 * @param {ReadonlyArray<any>} left
 * @param {ReadonlyArray<any>} right
 * @returns {boolean}
 */
function sameOrder(left, right) {
  return left.every((entry, index) => entry.order_marker === right[index]?.order_marker);
}
