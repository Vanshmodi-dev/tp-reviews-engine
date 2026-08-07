import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  OUTCOMES,
  createLedger,
  insertReview,
  suppressReview,
} from '../../src/core/model/ledger.mjs';
import { isTerminalState } from '../../src/core/reconcile/removal.mjs';
import { isScaffold } from '../../src/core/reconcile/index.mjs';
import { naiveResurrects, referenceReconcile } from '../helpers/naive-reconcile.mjs';
import { buildNormalizedReview } from '../helpers/build-review.mjs';
import {
  REMOVAL_CONFIRMATIONS,
  instantAt,
  observationsFrom,
  terminalLedgerAndHarvest,
} from '../helpers/reconcile-generators.mjs';

/**
 * PT-03 — tombstone monotonicity (T-106, TR-REC-014, FR-056).
 *
 * A tombstoned or suppressed `identity_hash` never becomes `active` again under
 * **any** observation sequence — including one where the review genuinely
 * reappears at the source.
 *
 * ## Why "the review is right there on the page" is not an argument
 *
 * The natural objection to this law is that it makes the engine wrong on
 * purpose: the source is serving the review, and we refuse to publish it. That
 * is correct, and it is the point. Terminality is reached for two reasons, and
 * both outrank freshness:
 *
 * - **Tombstoned.** Three consecutive complete harvests failed to observe it.
 *   If it is back, something is unstable — the source, the selector pack, or the
 *   identity derivation. Republishing on the strength of one observation makes a
 *   flapping review flap on the client's website.
 * - **Suppressed.** Somebody asked for it to be erased. Republishing is not a
 *   freshness improvement, it is a compliance failure, and "the source still
 *   serves it" is not a defence anyone will accept.
 *
 * "Deleted review comes back" is embarrassing when it is a mistake and legally
 * significant when it is an erasure request. Both terminal states are generated
 * here, because a reconciler guarding only `tombstoned` would leave the one with
 * legal weight unprotected — and that is the easy half to forget, since
 * suppression is applied elsewhere and looks like somebody else's problem.
 *
 * ## Why this is stated over sequences rather than single harvests
 *
 * The law says "under any observation sequence". One harvest cannot state that.
 * The adversarial case is the source serving the deleted review on **every**
 * run, so the sequence forces every terminal identity into every harvest, at
 * arbitrary completeness, for up to five consecutive runs.
 *
 * ## What is currently proven, honestly stated
 *
 * The merge is a scaffold. But unlike PT-01 and PT-02 this law is **not**
 * vacuous today: `isTerminalState` in `reconcile/removal.mjs` and the terminal
 * guards in `core/model/ledger.mjs` are implemented, and the tests below drive
 * them directly. T-106 extends this to the removal path it will add.
 */

const RUNS = 1000;

describe('PT-03 — a terminal identity never becomes active again', () => {
  it('survives an unbroken sequence of harvests that all observe it', () => {
    fc.assert(
      fc.property(terminalLedgerAndHarvest(), ({ prior, terminalIds, sequence }) =>
        allStillTerminal(replaySequence(prior, terminalIds, sequence), terminalIds),
      ),
      { numRuns: RUNS },
    );
  });

  it('never reverts the terminal state at any step, not only at the end', () => {
    // A reconciler that resurrected a record and re-tombstoned it on the next
    // harvest would pass an end-state-only assertion, while having published an
    // erased review in between. The intermediate states are the ones a visitor
    // would have seen.
    fc.assert(
      fc.property(terminalLedgerAndHarvest(), ({ prior, terminalIds, sequence }) => {
        let ledger = prior;

        for (const [index, harvest] of sequence.entries()) {
          ledger = applyHarvest(ledger, terminalIds, harvest, index);

          if (!allStillTerminal(ledger, terminalIds)) return false;
        }

        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('leaves every field of a terminal record untouched', () => {
    // Monotonicity of `state` alone is not enough. A record whose
    // `tombstoned_at` moves, or whose content is refreshed from a later
    // observation, is being maintained as if it were live.
    fc.assert(
      fc.property(terminalLedgerAndHarvest(), ({ prior, terminalIds, sequence }) =>
        allIdenticalTo(replaySequence(prior, terminalIds, sequence), prior, terminalIds),
      ),
      { numRuns: RUNS },
    );
  });

  it('REJECTS a reconciler that reactivates on observation', () => {
    // The law's teeth. naiveResurrects treats "observed" as sufficient grounds
    // to be active, which is the whole of the mistake.
    const result = fc.check(
      fc.property(terminalLedgerAndHarvest(), ({ prior, terminalIds, sequence }) => {
        let ledger = prior;

        for (const [index, harvest] of sequence.entries()) {
          ledger = naiveResurrects({
            prior: ledger,
            observed: observationsFrom(union(harvest.observedIds, terminalIds), String(index)),
            completeness: harvest.completeness,
            removalConfirmations: REMOVAL_CONFIRMATIONS,
            now: instantAt(index),
          });
        }

        return allStillTerminal(ledger, terminalIds);
      }),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-03 failed to catch resurrection on observation').toBe(true);
  });

  it('refuses to resurrect through the ledger constructors themselves', () => {
    // Driven against real merged code rather than the reference, because this is
    // where the guarantee actually lives. insertReview is the natural back door:
    // a resurfaced review looks exactly like a new one.
    const review = buildNormalizedReview();
    const seeded = insertReview(
      createLedger({ clientSlug: 'c', listingKey: 'main', now: instantAt(0) }),
      review,
      instantAt(0),
    ).ledger;

    const suppressed = suppressReview(seeded, review.identity_hash, instantAt(1)).ledger;
    const reobserved = insertReview(suppressed, review, instantAt(2));

    expect(reobserved.ledger.records.get(review.identity_hash)?.state).toBe('suppressed');
    expect(reobserved.outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });

  it('is NOT vacuous against the scaffold, unlike PT-01 and PT-02', () => {
    // Worth stating explicitly so nobody assumes the "vacuous" note on the
    // sibling laws applies here too. The terminal guards are implemented; only
    // the removal path that produces new tombstones is still to come.
    expect(isScaffold()).toBe(true);
    expect(isTerminalState('tombstoned')).toBe(true);
    expect(isTerminalState('suppressed')).toBe(true);
    expect(isTerminalState('unconfirmed')).toBe(false);
  });

  it('shows the generator actually re-observes the terminal identities', () => {
    // If the harvests never contained the terminal ids, no reconciler could
    // resurrect them and the rejection above would be impossible.
    const samples = fc.sample(terminalLedgerAndHarvest(), { numRuns: 200, seed: 17 });

    expect(samples.every(({ terminalIds }) => terminalIds.length > 0)).toBe(true);
    expect(samples.every(({ prior, terminalIds }) => prior.size > terminalIds.length)).toBe(true);
  });
});

/**
 * Whether every identity that started terminal is still terminal.
 *
 * @param {Map<string, any>} ledger
 * @param {ReadonlyArray<string>} terminalIds
 * @returns {boolean}
 */
function allStillTerminal(ledger, terminalIds) {
  return terminalIds.every((id) => isTerminalState(ledger.get(id)?.state));
}

/**
 * Whether every terminal record is unchanged in every field.
 *
 * @param {Map<string, any>} ledger
 * @param {Map<string, any>} prior
 * @param {ReadonlyArray<string>} terminalIds
 * @returns {boolean}
 */
function allIdenticalTo(ledger, prior, terminalIds) {
  return terminalIds.every(
    (id) => JSON.stringify(ledger.get(id)) === JSON.stringify(prior.get(id)),
  );
}

/**
 * Every harvest in a sequence, applied in order, with the terminal identities
 * forced into each one.
 *
 * @param {Map<string, any>} prior
 * @param {ReadonlyArray<string>} terminalIds
 * @param {ReadonlyArray<any>} sequence
 * @returns {Map<string, any>}
 */
function replaySequence(prior, terminalIds, sequence) {
  let ledger = prior;

  for (const [index, harvest] of sequence.entries()) {
    ledger = applyHarvest(ledger, terminalIds, harvest, index);
  }

  return ledger;
}

/**
 * One harvest, at its own instant, always observing the terminal identities.
 *
 * @param {Map<string, any>} ledger
 * @param {ReadonlyArray<string>} terminalIds
 * @param {{ observedIds: string[], completeness: string }} harvest
 * @param {number} index
 * @returns {Map<string, any>}
 */
function applyHarvest(ledger, terminalIds, harvest, index) {
  return referenceReconcile({
    prior: ledger,
    observed: observationsFrom(union(harvest.observedIds, terminalIds), String(index)),
    completeness: harvest.completeness,
    removalConfirmations: REMOVAL_CONFIRMATIONS,
    now: instantAt(index),
  });
}

/**
 * @param {ReadonlyArray<string>} left
 * @param {ReadonlyArray<string>} right
 * @returns {string[]}
 */
function union(left, right) {
  return [...new Set([...left, ...right])];
}
