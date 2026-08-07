import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { publishableRecords } from '../../src/core/model/ledger.mjs';
import { reconcile } from '../../src/core/reconcile/index.mjs';
import {
  anyStopReason,
  instantAt,
  realLedgerAndHarvest,
  seedLedger,
} from '../helpers/reconcile-generators.mjs';
import { harvest, identity, review } from '../helpers/reconcile-input.mjs';

/**
 * PT-04 — suppression is permanent (T-107, TR-REC-015).
 *
 * A suppressed `identity_hash` never appears in any projected payload, and no
 * observation sequence returns it to any other state.
 *
 * ## Why this is stronger than tombstoning
 *
 * A tombstone is the engine's own conclusion, reached from evidence, and it is
 * reversible in principle — an operator who decided it was wrong could rebuild
 * the ledger. A suppression is somebody exercising an erasure right. It must
 * survive not only re-observation but the recovery procedures: `compliance/denylist.json`
 * lives on `main` rather than in the Ledger on `state` precisely so that
 * rebuilding `state` from scratch — a documented, expected operation — cannot
 * resurrect an erased review (TR-CFG-011).
 *
 * That is why the denylist is swept across the **whole ledger** on every run
 * rather than checked only when a record is observed. A denylisted identity can
 * reach the ledger by routes the observed pass never sees: inserted by an older
 * engine version, restored from a rebuilt branch, or added to the denylist
 * between harvests while the review itself stopped appearing.
 *
 * ## The un-suppress path
 *
 * There is none, and `tests/unit/reconcile/suppress.test.mjs` asserts the module
 * exports nothing that could become one. This file asserts the behaviour; that
 * one asserts the absence of the escape hatch.
 */

const RUNS = 1000;

describe('PT-04 — a suppressed identity never returns', () => {
  it('suppresses every denylisted identity in the ledger, whatever its state', () => {
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const denylist = new Set([...prior.records.keys()].slice(0, 1));
        const out = reconcile(harvest({ prior, observed, stopReason, now, denylist }));

        return allSuppressed(out.ledger, denylist);
      }),
      { numRuns: RUNS },
    );
  });

  it('keeps them suppressed across an arbitrary sequence of later harvests', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ observe: fc.boolean(), stopReason: anyStopReason() }), {
          minLength: 1,
          maxLength: 5,
        }),
        (sequence) => {
          const denylist = new Set([identity('a')]);
          let ledger = seedLedger(
            [
              { label: 'a', state: 'active' },
              { label: 'b', state: 'active' },
            ],
            instantAt(0),
          );

          for (const [index, step] of sequence.entries()) {
            ledger = reconcile(
              harvest({
                prior: ledger,
                observed: step.observe ? [review('a'), review('b')] : [],
                stopReason: step.stopReason,
                now: instantAt(index + 1),
                denylist,
              }),
            ).ledger;

            if (ledger.records.get(identity('a'))?.state !== 'suppressed') return false;
          }

          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('never lets a suppressed record into the publishable set', () => {
    // TR-REC-015 is about projections, and this is the function every projection
    // draws from.
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        // Everything the run could possibly end up holding: the prior ledger
        // AND every identity this harvest observed. Denylisting only the prior
        // keys would leave a freshly inserted review legitimately publishable,
        // and the law would be asserting something it does not mean.
        const denylist = everythingInPlay(prior, observed);
        const out = reconcile(harvest({ prior, observed, stopReason, now, denylist }));

        return publishableRecords(out.ledger).length === 0;
      }),
      { numRuns: RUNS },
    );
  });

  it('suppresses an identity that is denylisted but never observed', () => {
    // The route the observed pass cannot see: the review stopped appearing at
    // the source, and the erasure request arrived afterwards.
    const prior = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));
    const out = reconcile(
      harvest({
        prior,
        observed: [],
        stopReason: 'stalled',
        now: instantAt(1),
        denylist: new Set([identity('a')]),
      }),
    );

    expect(out.ledger.records.get(identity('a'))?.state).toBe('suppressed');
    expect(out.decisions.suppressed).toBe(1);
  });

  it('suppresses an already-tombstoned record', () => {
    // An erasure obligation is not a lifecycle event and does not queue behind
    // one. A tombstoned record is still in the ledger and still recoverable.
    const prior = seedLedger([{ label: 'a', state: 'tombstoned' }], instantAt(0));
    const out = reconcile(
      harvest({ prior, observed: [], now: instantAt(1), denylist: new Set([identity('a')]) }),
    );

    expect(out.ledger.records.get(identity('a'))?.state).toBe('suppressed');
  });

  it('never inserts a denylisted identity that was not already present', () => {
    // The rebuild case. If suppression only applied to records already in the
    // ledger, rebuilding `state` from scratch would re-insert every erased
    // review on the first harvest.
    const prior = seedLedger([{ label: 'b', state: 'active' }], instantAt(0));
    const out = reconcile(
      harvest({
        prior,
        observed: [review('a'), review('b')],
        now: instantAt(1),
        denylist: new Set([identity('a')]),
      }),
    );

    expect(out.ledger.records.has(identity('a'))).toBe(false);
    expect(out.decisions.suppressed).toBe(1);
  });

  it('reports a suppression once, not on every subsequent harvest forever', () => {
    // A log that reports the same suppression every six hours for a year is a
    // log nobody reads.
    const denylist = new Set([identity('a')]);
    const prior = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));

    const first = reconcile(harvest({ prior, observed: [], now: instantAt(1), denylist }));
    const second = reconcile(
      harvest({ prior: first.ledger, observed: [], now: instantAt(2), denylist }),
    );

    expect(first.decisions.suppressed).toBe(1);
    expect(second.decisions.suppressed).toBe(0);
  });

  it('leaves non-denylisted records completely alone', () => {
    // A suppression sweep that touched anything else would be a very expensive
    // bug to discover.
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const withList = reconcile(
          harvest({ prior, observed, stopReason, now, denylist: new Set(['not-in-this-ledger']) }),
        );
        const without = reconcile(harvest({ prior, observed, stopReason, now }));

        return (
          JSON.stringify([...withList.ledger.records]) ===
          JSON.stringify([...without.ledger.records])
        );
      }),
      { numRuns: RUNS },
    );
  });
});

/**
 * @param {any} ledger
 * @param {ReadonlySet<string>} denylist
 * @returns {boolean}
 */
function allSuppressed(ledger, denylist) {
  for (const id of denylist) {
    if (ledger.records.get(id)?.state !== 'suppressed') return false;
  }

  return true;
}

/**
 * Every identity the run could end up holding: the prior ledger AND everything
 * this harvest observed.
 *
 * @param {any} prior
 * @param {ReadonlyArray<any>} observed
 * @returns {Set<string>}
 */
function everythingInPlay(prior, observed) {
  const ids = new Set(prior.records.keys());

  for (const entry of observed) ids.add(entry.identity_hash);

  return ids;
}
