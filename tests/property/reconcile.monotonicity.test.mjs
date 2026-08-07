import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  OUTCOMES,
  createLedger,
  insertReview,
  suppressReview,
} from '../../src/core/model/ledger.mjs';
import { isTerminalState } from '../../src/core/reconcile/removal.mjs';
import { reconcile } from '../../src/core/reconcile/index.mjs';
import { naiveResurrects } from '../helpers/naive-reconcile.mjs';
import { buildNormalizedReview } from '../helpers/build-review.mjs';
import {
  REMOVAL_CONFIRMATIONS,
  anyStopReason,
  instantAt,
  observationsFrom,
  seedLedger,
  terminalLedgerAndHarvest,
} from '../helpers/reconcile-generators.mjs';
import { harvest, identity, review } from '../helpers/reconcile-input.mjs';

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
 * Both terminal states are generated, because a reconciler guarding only
 * `tombstoned` would leave the one with legal weight unprotected — and that is
 * the easy half to forget, since suppression is applied elsewhere and looks like
 * somebody else's problem.
 *
 * ## Why this is stated over sequences rather than single harvests
 *
 * The law says "under any observation sequence". One harvest cannot state that.
 * The adversarial case is the source serving the deleted review on **every**
 * run, so the sequence forces every terminal identity into every harvest, at
 * arbitrary completeness, for up to five consecutive runs.
 */

const RUNS = 1000;

/** A real ledger where the given labels are terminal and the rest are active. */
const realTerminalLedger = () =>
  fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: 0, max: 300 }), { minLength: 2, maxLength: 6 }),
      fc.constantFrom('tombstoned', 'suppressed'),
      fc.integer({ min: 1, max: 3 }),
    )
    .map(([labels, terminalState, requested]) => {
      const terminalCount = Math.min(requested, labels.length - 1);
      const specs = labels.map((label, index) => ({
        label,
        state: index < terminalCount ? terminalState : 'active',
      }));

      return {
        prior: seedLedger(specs, instantAt(0)),
        terminalIds: labels.slice(0, terminalCount).map((label) => identity(label)),
        allLabels: labels,
      };
    });

/** 1-5 harvests, each observing an arbitrary subset at its own instant. */
const sequenceOver = (/** @type {ReadonlyArray<number>} */ labels) =>
  fc.array(fc.record({ observed: fc.subarray([...labels]), stopReason: anyStopReason() }), {
    minLength: 1,
    maxLength: 5,
  });

describe('PT-03 — a terminal identity never becomes active again', () => {
  it('survives an unbroken sequence of harvests that all observe it', () => {
    fc.assert(
      fc.property(
        realTerminalLedger().chain((base) =>
          fc.record({ base: fc.constant(base), sequence: sequenceOver(base.allLabels) }),
        ),
        ({ base, sequence }) => allStillTerminal(replay(base, sequence), base.terminalIds),
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
      fc.property(
        realTerminalLedger().chain((base) =>
          fc.record({ base: fc.constant(base), sequence: sequenceOver(base.allLabels) }),
        ),
        ({ base, sequence }) => {
          let ledger = base.prior;

          for (const [index, step] of sequence.entries()) {
            ledger = applyStep(ledger, base.terminalIds, step, index);
            if (!allStillTerminal(ledger, base.terminalIds)) return false;
          }

          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('leaves every field of a terminal record untouched', () => {
    // Monotonicity of `state` alone is not enough. A record whose
    // `tombstoned_at` moves, or whose content is refreshed from a later
    // observation, is being maintained as if it were live.
    fc.assert(
      fc.property(
        realTerminalLedger().chain((base) =>
          fc.record({ base: fc.constant(base), sequence: sequenceOver(base.allLabels) }),
        ),
        ({ base, sequence }) => {
          return allIdentical(replay(base, sequence), base.prior, base.terminalIds);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('reports the observation as IGNORED_TERMINAL rather than silently dropping it', () => {
    // The record not changing is necessary but not sufficient. An operator
    // looking at a run where a deleted review keeps reappearing needs to see it.
    const prior = seedLedger([{ label: 'a', state: 'tombstoned' }], instantAt(0));
    const out = reconcile(harvest({ prior, observed: [review('a')], now: instantAt(1) }));

    expect(out.decisions.ignored_terminal).toBe(1);
    expect(out.decisions.decisions).toContainEqual({
      identity_hash: identity('a'),
      outcome: OUTCOMES.IGNORED_TERMINAL,
    });
  });

  it('REJECTS a reconciler that reactivates on observation', () => {
    // The law's teeth. naiveResurrects treats "observed" as sufficient grounds
    // to be active, which is the whole of the mistake.
    const result = fc.check(
      fc.property(terminalLedgerAndHarvest(), ({ prior, terminalIds, sequence }) => {
        let ledger = prior;

        for (const [index, step] of sequence.entries()) {
          ledger = naiveResurrects({
            prior: ledger,
            observed: observationsFrom(union(step.observedIds, terminalIds), String(index)),
            completeness: step.completeness,
            removalConfirmations: REMOVAL_CONFIRMATIONS,
            now: instantAt(index),
          });
        }

        return allTerminalInPlainMap(ledger, terminalIds);
      }),
      { numRuns: RUNS },
    );

    expect(result.failed, 'PT-03 failed to catch resurrection on observation').toBe(true);
  });

  it('refuses to resurrect through the ledger constructors themselves', () => {
    // insertReview is the natural back door: a resurfaced review looks exactly
    // like a new one.
    const record = buildNormalizedReview();
    const seeded = insertReview(
      createLedger({ clientSlug: 'c', listingKey: 'main', now: instantAt(0) }),
      record,
      instantAt(0),
    ).ledger;

    const suppressed = suppressReview(seeded, record.identity_hash, instantAt(1)).ledger;
    const reobserved = insertReview(suppressed, record, instantAt(2));

    expect(reobserved.ledger.records.get(record.identity_hash)?.state).toBe('suppressed');
    expect(reobserved.outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });

  it('a tombstoned record stops accruing streak', () => {
    // Otherwise `missing_streak` climbs forever and `tombstoned_at` drifts away
    // from the harvest that actually decided it.
    const prior = seedLedger([{ label: 'a', state: 'tombstoned' }], instantAt(0));
    const before = prior.records.get(identity('a'));

    let ledger = prior;
    for (let step = 1; step <= 4; step += 1) {
      ledger = reconcile(harvest({ prior: ledger, observed: [], now: instantAt(step) })).ledger;
    }

    expect(ledger.records.get(identity('a'))).toEqual(before);
  });
});

/**
 * @param {any} base
 * @param {ReadonlyArray<any>} sequence
 * @returns {any}
 */
function replay(base, sequence) {
  let ledger = base.prior;

  for (const [index, step] of sequence.entries()) {
    ledger = applyStep(ledger, base.terminalIds, step, index);
  }

  return ledger;
}

/**
 * One harvest, at its own instant, always observing the terminal identities.
 *
 * @param {any} ledger
 * @param {ReadonlyArray<string>} terminalIds
 * @param {{ observed: number[], stopReason: string }} step
 * @param {number} index
 * @returns {any}
 */
function applyStep(ledger, terminalIds, step, index) {
  const observed = [
    ...step.observed.map((label) => review(label)),
    ...terminalIds.map((id) => ({ ...review(0), identity_hash: id })),
  ];

  return reconcile(
    harvest({ prior: ledger, observed, stopReason: step.stopReason, now: instantAt(index + 1) }),
  ).ledger;
}

/**
 * @param {any} ledger
 * @param {ReadonlyArray<string>} terminalIds
 * @returns {boolean}
 */
function allStillTerminal(ledger, terminalIds) {
  return terminalIds.every((id) => isTerminalState(ledger.records.get(id)?.state));
}

/**
 * @param {ReadonlyArray<string>} left
 * @param {ReadonlyArray<string>} right
 * @returns {string[]}
 */
function union(left, right) {
  return [...new Set([...left, ...right])];
}

/**
 * @param {any} after
 * @param {any} prior
 * @param {ReadonlyArray<string>} terminalIds
 * @returns {boolean}
 */
function allIdentical(after, prior, terminalIds) {
  for (const id of terminalIds) {
    if (JSON.stringify(after.records.get(id)) !== JSON.stringify(prior.records.get(id))) {
      return false;
    }
  }

  return true;
}

/**
 * The plain-Map equivalent, for the naive counterexample.
 *
 * @param {Map<string, any>} ledger
 * @param {ReadonlyArray<string>} terminalIds
 * @returns {boolean}
 */
function allTerminalInPlainMap(ledger, terminalIds) {
  for (const id of terminalIds) {
    if (!isTerminalState(ledger.get(id)?.state)) return false;
  }

  return true;
}
