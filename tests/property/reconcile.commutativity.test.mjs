import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../../src/core/reconcile/index.mjs';
import { naiveOrderDependent, snapshot } from '../helpers/naive-reconcile.mjs';
import {
  completeHarvest,
  ledgerAndHarvestShuffled,
  permutationOf,
  qualifyingStopReason,
  realLedgerAndHarvest,
} from '../helpers/reconcile-generators.mjs';
import { harvest } from '../helpers/reconcile-input.mjs';
import { ledgerSnapshot } from '../helpers/ledger-snapshot.mjs';

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
 * `collapseIntraRun` chooses by TR-REC-002's total ordering — more non-null
 * fields, then longer text, then the earlier node ordinal, then content hash —
 * every test of which reads the records themselves rather than their positions
 * (DUP-03). The node ordinal is a *field*, so reading it does not smuggle
 * arrival order back in (TR-EXT-031).
 */

const RUNS = 1000;

describe('PT-02 — reconciliation is order-independent', () => {
  it('a shuffled harvest yields an identical ledger', () => {
    fc.assert(
      fc.property(
        realLedgerAndHarvest().chain((sample) =>
          fc.record({ sample: fc.constant(sample), shuffled: permutationOf(sample.observed) }),
        ),
        ({ sample, shuffled }) => {
          const { prior, observed, stopReason, now } = sample;
          const inOrder = reconcile(harvest({ prior, observed, stopReason, now }));
          const reordered = reconcile(harvest({ prior, observed: shuffled, stopReason, now }));

          return ledgerSnapshot(reordered.ledger) === ledgerSnapshot(inOrder.ledger);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('holds when absence is also being counted', () => {
    // The absence pass iterates the ledger rather than the harvest, so it has
    // its own opportunity to be order-sensitive.
    fc.assert(
      fc.property(
        realLedgerAndHarvest({ stopReason: qualifyingStopReason() }).chain((sample) =>
          fc.record({ sample: fc.constant(sample), shuffled: permutationOf(sample.observed) }),
        ),
        ({ sample, shuffled }) => {
          const { prior, observed, stopReason, now } = sample;
          const inOrder = reconcile(harvest({ prior, observed, stopReason, now }));
          const reordered = reconcile(harvest({ prior, observed: shuffled, stopReason, now }));

          return ledgerSnapshot(reordered.ledger) === ledgerSnapshot(inOrder.ledger);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('produces an identical decision tally under any ordering', () => {
    // The ledger being equal is not quite enough. A reconciler that reached the
    // same ledger by a different route would report different counts, and the
    // decision log is what an operator reads to understand a run.
    fc.assert(
      fc.property(
        realLedgerAndHarvest().chain((sample) =>
          fc.record({ sample: fc.constant(sample), shuffled: permutationOf(sample.observed) }),
        ),
        ({ sample, shuffled }) => {
          const { prior, observed, stopReason, now } = sample;
          const inOrder = reconcile(harvest({ prior, observed, stopReason, now })).decisions;
          const reordered = reconcile(
            harvest({ prior, observed: shuffled, stopReason, now }),
          ).decisions;

          return tallyOf(inOrder) === tallyOf(reordered);
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
        realLedgerAndHarvest({ stopReason: qualifyingStopReason() }).chain((sample) =>
          fc.record({
            sample: fc.constant(sample),
            orderings: fc.array(permutationOf(sample.observed), { minLength: 2, maxLength: 4 }),
          }),
        ),
        ({ sample, orderings }) => allOrderingsAgree(sample, orderings),
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
    // the broken one, and the rejection above becomes impossible.
    const samples = fc.sample(realLedgerAndHarvest(), { numRuns: 200, seed: 13 });
    const withDuplicates = samples.filter(({ observed }) => hasDuplicateIdentity(observed));

    expect(withDuplicates.length).toBeGreaterThan(0);
  });
});

/**
 * @param {any} sample
 * @param {ReadonlyArray<any[]>} orderings
 * @returns {boolean}
 */
function allOrderingsAgree({ prior, observed, stopReason, now }, orderings) {
  const canonical = ledgerSnapshot(reconcile(harvest({ prior, observed, stopReason, now })).ledger);

  return orderings.every(
    (ordering) =>
      ledgerSnapshot(reconcile(harvest({ prior, observed: ordering, stopReason, now })).ledger) ===
      canonical,
  );
}

/**
 * The decision counts, without the per-record list — which is ordered by the
 * pass that produced it and is not itself a commutativity claim.
 *
 * @param {any} decisions
 * @returns {string}
 */
function tallyOf(decisions) {
  const { decisions: _perRecord, ...counts } = decisions;

  return JSON.stringify(counts);
}

/**
 * @param {ReadonlyArray<any>} observed
 * @returns {boolean}
 */
function hasDuplicateIdentity(observed) {
  return new Set(observed.map((entry) => entry.identity_hash)).size < observed.length;
}
