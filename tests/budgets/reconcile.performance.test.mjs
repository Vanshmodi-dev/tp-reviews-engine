import { describe, expect, it } from 'vitest';

import { markNormalised } from '../../src/core/model/review.mjs';
import { reconcile } from '../../src/core/reconcile/index.mjs';
import { findNearDuplicates } from '../../src/core/reconcile/duplicates.mjs';
import { T0, T1, harvest, ledgerWith, review } from '../helpers/reconcile-input.mjs';

/**
 * T-104 and T-110 — the reconciler's cost at realistic and unrealistic sizes.
 *
 * ## What these budgets are actually protecting
 *
 * Two specific defects, both of which are invisible at the size of every unit
 * test in this repository and fatal at the size of a real listing:
 *
 * - **IR-24 — the ledger implemented as an array.** Every observed review would
 *   scan the whole ledger to find its match, making the merge O(n²). At 100
 *   reviews that is 10,000 comparisons and imperceptible; at 5,000 it is 25
 *   million and the run times out. `Ledger.records` is a `Map` for exactly this
 *   reason (TR-REC-031).
 * - **IR-15 — near-duplicate detection as all-pairs.** Same shape, same
 *   invisibility. Bucketing by `author_key` first makes the cost the sum of the
 *   squares of the bucket sizes, and real buckets hold one or two reviews.
 *
 * ## Why the thresholds are loose
 *
 * The published budget is 2 s CPU at 1,000 reviews (IMPL-PLAN PH-05 Exit). These
 * assertions sit well under it but are still far above what the code actually
 * takes, because a wall-clock assertion on shared CI hardware that is tight
 * enough to catch a 20% regression is also tight enough to fail for reasons that
 * have nothing to do with this repository. A flaky performance test gets
 * disabled, and a disabled test protects nothing.
 *
 * These catch the thing worth catching: a complexity class change. Quadratic
 * behaviour at these sizes misses by orders of magnitude, not by percentages.
 */

const BUDGET_MS = 2000;

/**
 * @param {number} count
 * @returns {any[]}
 */
function reviewsOf(count) {
  return Array.from({ length: count }, (_, i) =>
    review(i, { author_key: `author-${i}`, text: markNormalised(`Review number ${i}. Good.`) }),
  );
}

/**
 * @param {() => void} work
 * @returns {number} Milliseconds of wall clock elapsed.
 */
function timed(work) {
  const started = performance.now();
  work();

  return performance.now() - started;
}

/**
 * CPU milliseconds consumed by `work`, rather than wall-clock elapsed.
 *
 * The scaling assertion compares two measurements against each other, so it is
 * ruined by anything that deschedules one of them — a parallel test worker, a
 * GC pause, CI sharing a runner. `process.cpuUsage` measures time this process
 * actually spent on a CPU, which is what "is this quadratic" is really asking
 * and which does not move when the machine is busy.
 *
 * @param {() => void} work
 * @returns {number}
 */
function cpuTimed(work) {
  const started = process.cpuUsage();
  work();
  const { user, system } = process.cpuUsage(started);

  return (user + system) / 1000;
}

describe('reconcile stays within its CPU budget', () => {
  it('merges 1,000 observed reviews into a 1,000-record ledger well inside 2 s', () => {
    const reviews = reviewsOf(1000);
    const prior = ledgerWith(reviews, T0);

    const elapsed = timed(() => {
      const out = reconcile(harvest({ prior, observed: reviews, now: T1 }));

      expect(out.decisions.unchanged).toBe(1000);
    });

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('handles a full turnover — 1,000 absent and 1,000 new — inside the budget', () => {
    // The most expensive shape: every prior record takes the absence path and
    // every observed record takes the insert path.
    const prior = ledgerWith(reviewsOf(1000), T0);
    const fresh = Array.from({ length: 1000 }, (_, i) =>
      review(i + 5000, { author_key: `fresh-author-${i}` }),
    );

    const elapsed = timed(() => {
      const out = reconcile(harvest({ prior, observed: fresh, now: T1 }));

      expect(out.decisions.inserted).toBe(1000);
      expect(out.decisions.missing).toBe(1000);
    });

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('scales sub-quadratically from 1,000 to 5,000 records (IR-24)', () => {
    // The assertion that actually catches an array-backed ledger. Five times the
    // data on a linear implementation costs roughly five times the work; on a
    // quadratic one it costs twenty-five. The allowance of 12x leaves generous
    // room for constant factors and GC while still failing an O(n^2) merge.
    const small = reviewsOf(1000);
    const large = reviewsOf(5000);
    const smallPrior = ledgerWith(small, T0);
    const largePrior = ledgerWith(large, T0);

    const smallMs = cpuTimed(() =>
      reconcile(harvest({ prior: smallPrior, observed: small, now: T1 })),
    );
    const largeMs = cpuTimed(() =>
      reconcile(harvest({ prior: largePrior, observed: large, now: T1 })),
    );

    // A floor on the baseline keeps the ratio meaningful: dividing by a
    // sub-millisecond measurement produces noise, not a signal.
    expect(largeMs).toBeLessThan(Math.max(smallMs, 5) * 12);
  });

  it('keeps near-duplicate detection bucketed, not all-pairs (IR-15)', () => {
    // 2,000 reviews by 2,000 distinct authors. All-pairs would be ~2 million
    // similarity computations over real text; bucketed is 2,000 buckets of one,
    // which is none at all.
    const records = Array.from({ length: 2000 }, (_, i) =>
      review(i, {
        author_key: `author-${i}`,
        text: markNormalised(`The staff were lovely and the service was quick. Visit ${i}.`),
      }),
    );

    const elapsed = timed(() => {
      expect(findNearDuplicates(records, 0.92)).toEqual([]);
    });

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('still detects duplicates within one large author bucket', () => {
    // The other side: bucketing must not have turned detection off. One author
    // with 40 near-identical reviews is a genuine, if unusual, case.
    const text = 'The staff were lovely and the service was quick and I will return soon.';
    const records = Array.from({ length: 40 }, (_, i) =>
      review(i, { author_key: 'one-author', text: markNormalised(`${text} ${i}`) }),
    );

    const pairs = findNearDuplicates(records, 0.92);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every((pair) => pair.author_key === 'one-author')).toBe(true);
  });

  it('survives a single author bucket holding the whole listing', () => {
    // The pathological case bucketing does NOT solve: an adapter that derived
    // one author key for every reviewer puts all 1,000 records in one bucket.
    // Bucketing is per DUP-02 and within-bucket comparison is quadratic by
    // design, so the length bound in `collectPairs` is what keeps this finite.
    const records = Array.from({ length: 1000 }, (_, i) =>
      review(i, {
        author_key: 'one-key-for-everyone',
        text: markNormalised(`Review ${i}. ${'x'.repeat(i % 200)}`),
      }),
    );

    const elapsed = timed(() => findNearDuplicates(records, 0.92));

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('collapses 5,000 records with heavy duplication in linear time', () => {
    // 1,000 distinct identities, each appearing five times.
    const observed = Array.from({ length: 5000 }, (_, i) =>
      review(i % 1000, { author_key: `author-${i % 1000}` }),
    );

    const elapsed = timed(() => {
      const out = reconcile(harvest({ prior: ledgerWith([], T0), observed, now: T1 }));

      expect(out.collisions).toBe(4000);
      expect(out.ledger.records.size).toBe(1000);
    });

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
