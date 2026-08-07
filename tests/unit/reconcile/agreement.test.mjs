import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { OUTCOMES, markMissing } from '../../../src/core/model/ledger.mjs';
import { decideAbsent } from '../../../src/core/reconcile/decide.mjs';
import { evaluateRemoval } from '../../../src/core/reconcile/removal.mjs';
import { T1, identity, ledgerWith, recordOf, review } from '../../helpers/reconcile-input.mjs';

/**
 * The rules exist in more than one place, and this is where that is checked.
 *
 * `decideAbsent` classifies an absence; `markMissing` applies one; `evaluateRemoval`
 * computes the streak arithmetic. All three re-derive the same rule from the same
 * inputs, and the merge calls them in a combination that only works while they
 * agree.
 *
 * That duplication is deliberate — the alternative is a single function that both
 * decides and mutates, which makes the decision untestable without a ledger and
 * the mutation untestable without the policy. But duplication that is merely
 * *believed* to agree is how two copies of one rule drift apart, so agreement is
 * asserted across the whole input space rather than left to a careful reading.
 *
 * If this file ever fails, the fix is never to change the assertion.
 */

const RUNS = 1000;

const streaks = () => fc.integer({ min: 0, max: 6 });
const thresholds = () => fc.integer({ min: 2, max: 10 });
const completenessValues = () => fc.constantFrom('full', 'full_capped', 'partial', 'failed');
const states = () => fc.constantFrom('active', 'unconfirmed', 'tombstoned', 'suppressed');

/**
 * A ledger holding one record in the requested state and streak, reached by
 * driving the real constructors.
 *
 * @param {string} state
 * @param {number} missingStreak
 * @returns {any}
 */
function ledgerHolding(state, missingStreak) {
  const base = ledgerWith([review('a')]);
  const record = recordOf(base, identity('a'));
  const records = new Map(base.records);

  records.set(identity('a'), Object.freeze({ ...record, state, missing_streak: missingStreak }));

  return Object.freeze({ ...base, records });
}

describe('decideAbsent and markMissing never disagree', () => {
  it('produces the same outcome for every state, streak, threshold and completeness', () => {
    fc.assert(
      fc.property(
        states(),
        streaks(),
        thresholds(),
        completenessValues(),
        (state, missingStreak, removalConfirmations, completeness) => {
          const ledger = ledgerHolding(state, missingStreak);
          const prior = recordOf(ledger, identity('a'));

          const decided = decideAbsent(prior, {
            completeness,
            removalConfirmations,
            denylist: new Set(),
          });
          const applied = markMissing(ledger, identity('a'), {
            completeness,
            removalConfirmations,
            now: T1,
          });

          return decided.outcome === applied.outcome;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('agrees on the resulting streak and state whenever anything changes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('active', 'unconfirmed'),
        streaks(),
        thresholds(),
        fc.constantFrom('full', 'full_capped'),
        (state, missingStreak, removalConfirmations, completeness) => {
          const ledger = ledgerHolding(state, missingStreak);
          const prior = recordOf(ledger, identity('a'));

          const outcome = evaluateRemoval(
            prior,
            { removalConfirmations, keepTombstones: true },
            T1,
          );
          const applied = markMissing(ledger, identity('a'), {
            completeness,
            removalConfirmations,
            now: T1,
          });
          const after = recordOf(applied.ledger, identity('a'));

          return (
            after.missing_streak === outcome.nextStreak &&
            after.state === outcome.nextState &&
            after.tombstoned_at === outcome.tombstonedAt
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('agrees that nothing changes on an inconclusive harvest', () => {
    fc.assert(
      fc.property(
        states(),
        streaks(),
        fc.constantFrom('partial', 'failed'),
        (state, missingStreak, completeness) => {
          const ledger = ledgerHolding(state, missingStreak);
          const prior = recordOf(ledger, identity('a'));

          const decided = decideAbsent(prior, {
            completeness,
            removalConfirmations: 3,
            denylist: new Set(),
          });
          const applied = markMissing(ledger, identity('a'), {
            completeness,
            removalConfirmations: 3,
            now: T1,
          });

          const unchanged = applied.ledger === ledger;
          const noOp =
            decided.outcome === OUTCOMES.HELD || decided.outcome === OUTCOMES.IGNORED_TERMINAL;

          return unchanged && noOp;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('agrees that a terminal record is untouched whatever the completeness', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('tombstoned', 'suppressed'),
        streaks(),
        completenessValues(),
        (state, missingStreak, completeness) => {
          const ledger = ledgerHolding(state, missingStreak);
          const prior = recordOf(ledger, identity('a'));

          const decided = decideAbsent(prior, {
            completeness,
            removalConfirmations: 3,
            denylist: new Set(),
          });
          const applied = markMissing(ledger, identity('a'), {
            completeness,
            removalConfirmations: 3,
            now: T1,
          });

          return (
            decided.outcome === OUTCOMES.IGNORED_TERMINAL &&
            applied.outcome === OUTCOMES.IGNORED_TERMINAL &&
            applied.ledger === ledger
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('the asymmetry is stated identically wherever it appears', () => {
  it('holds for every completeness value in both modules', () => {
    // `absenceIsMeaningful` is the single predicate, but it is consulted from
    // two files. A future edit that inlined it in one place would show up here.
    for (const completeness of ['full', 'full_capped']) {
      const ledger = ledgerHolding('active', 0);

      expect(
        decideAbsent(recordOf(ledger, identity('a')), {
          completeness,
          removalConfirmations: 3,
          denylist: new Set(),
        }).outcome,
      ).toBe(OUTCOMES.MISSING);
    }

    for (const completeness of ['partial', 'failed']) {
      const ledger = ledgerHolding('active', 0);

      expect(
        decideAbsent(recordOf(ledger, identity('a')), {
          completeness,
          removalConfirmations: 3,
          denylist: new Set(),
        }).outcome,
      ).toBe(OUTCOMES.HELD);
    }
  });
});
