import { describe, expect, it } from 'vitest';

import { OUTCOMES } from '../../../src/core/model/ledger.mjs';
import {
  decideAbsent,
  decideObserved,
  isNoOpOutcome,
} from '../../../src/core/reconcile/decide.mjs';
import { identity, ledgerWith, review } from '../../helpers/reconcile-input.mjs';

/**
 * T-100's acceptance is one test per branch, and its verification is that a
 * reviewer can trace each branch by hand. So each test below names the branch it
 * covers and asserts the outcome *and* the reason, because the reason is what an
 * on-call engineer reads in the decision log at 2am — a correct outcome with a
 * misleading reason is a bug they will chase for an hour.
 */

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const context = (overrides = {}) => ({
  completeness: 'full',
  removalConfirmations: 3,
  denylist: new Set(),
  ...overrides,
});

/**
 * A `LedgerReview` as stored, at a chosen state and streak.
 *
 * @param {string | number} label
 * @param {{ state?: string, missing_streak?: number, contentHash?: string }} [options]
 * @returns {any}
 */
const stored = (label, { state = 'active', missing_streak = 0, contentHash } = {}) => {
  const base = ledgerWith([review(label)]).records.get(identity(label));

  return {
    ...base,
    state,
    missing_streak,
    review: contentHash === undefined ? base.review : { ...base.review, content_hash: contentHash },
  };
};

describe('decideObserved — a review that appeared', () => {
  it('INSERT when the identity is not in the ledger', () => {
    const decision = decideObserved(review('a'), undefined, context());

    expect(decision.outcome).toBe(OUTCOMES.INSERTED);
    expect(decision.reason).toContain('not previously');
  });

  it('UNCHANGED when the content hash is identical', () => {
    const decision = decideObserved(review('a'), stored('a'), context());

    expect(decision.outcome).toBe(OUTCOMES.UNCHANGED);
  });

  it('UPDATE when the content hash differs', () => {
    const decision = decideObserved(review('a'), stored('a', { contentHash: 'other' }), context());

    expect(decision.outcome).toBe(OUTCOMES.UPDATED);
  });

  it('IGNORED_TERMINAL when the prior record is tombstoned', () => {
    const decision = decideObserved(review('a'), stored('a', { state: 'tombstoned' }), context());

    expect(decision.outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
    expect(decision.reason).toContain('tombstoned');
  });

  it('IGNORED_TERMINAL when the prior record is suppressed', () => {
    const decision = decideObserved(review('a'), stored('a', { state: 'suppressed' }), context());

    expect(decision.outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });

  it('SUPPRESSED when denylisted, even though the identity is brand new', () => {
    // The record does not exist yet and the denylist still wins. If suppression
    // only applied to records already present, rebuilding `state` from scratch -
    // a documented recovery procedure - would re-insert every erased review.
    const denylist = new Set([identity('a')]);
    const decision = decideObserved(review('a'), undefined, context({ denylist }));

    expect(decision.outcome).toBe(OUTCOMES.SUPPRESSED);
    expect(decision.reason).toContain('denylisted');
  });

  it('suppression outranks a terminal state', () => {
    const denylist = new Set([identity('a')]);
    const prior = stored('a', { state: 'tombstoned' });

    expect(decideObserved(review('a'), prior, context({ denylist })).outcome).toBe(
      OUTCOMES.SUPPRESSED,
    );
  });

  it('never consults completeness — an appearance is trusted regardless', () => {
    // TRD 22.5.1: a record cannot appear spuriously. A stalled scroll does not
    // invent reviews, so there is no completeness under which an observation
    // means less.
    for (const completeness of ['full', 'full_capped', 'partial', 'failed']) {
      expect(decideObserved(review('a'), undefined, context({ completeness })).outcome).toBe(
        OUTCOMES.INSERTED,
      );
    }
  });
});

describe('decideAbsent — a review that did not appear', () => {
  it('HELD on a partial harvest, changing nothing', () => {
    const decision = decideAbsent(stored('a'), context({ completeness: 'partial' }));

    expect(decision.outcome).toBe(OUTCOMES.HELD);
    expect(decision.reason).toContain('did not look');
  });

  it('HELD on a failed harvest', () => {
    expect(decideAbsent(stored('a'), context({ completeness: 'failed' })).outcome).toBe(
      OUTCOMES.HELD,
    );
  });

  it('MISSING on a full harvest below the threshold', () => {
    const decision = decideAbsent(stored('a', { missing_streak: 0 }), context());

    expect(decision.outcome).toBe(OUTCOMES.MISSING);
    expect(decision.reason).toContain('1 of 3');
  });

  it('MISSING on a full_capped harvest — TR-REC-010 counts both', () => {
    // The IMPL-PLAN's LEDG-01 says `full` only; TRD TR-REC-010 says `full` or
    // `full_capped`, and the TRD outranks the plan. A capped harvest stopped at
    // OUR ceiling, so everything below the cap genuinely was looked at.
    expect(decideAbsent(stored('a'), context({ completeness: 'full_capped' })).outcome).toBe(
      OUTCOMES.MISSING,
    );
  });

  it('TOMBSTONED when the streak reaches the confirmation threshold', () => {
    const decision = decideAbsent(stored('a', { missing_streak: 2 }), context());

    expect(decision.outcome).toBe(OUTCOMES.TOMBSTONED);
    expect(decision.reason).toContain('3 consecutive');
  });

  it('respects a non-default confirmation threshold at both bounds', () => {
    const atTwo = context({ removalConfirmations: 2 });
    const atTen = context({ removalConfirmations: 10 });

    expect(decideAbsent(stored('a', { missing_streak: 1 }), atTwo).outcome).toBe(
      OUTCOMES.TOMBSTONED,
    );
    expect(decideAbsent(stored('a', { missing_streak: 8 }), atTen).outcome).toBe(OUTCOMES.MISSING);
    expect(decideAbsent(stored('a', { missing_streak: 9 }), atTen).outcome).toBe(
      OUTCOMES.TOMBSTONED,
    );
  });

  it('IGNORED_TERMINAL for a record that is already terminal', () => {
    expect(decideAbsent(stored('a', { state: 'tombstoned' }), context()).outcome).toBe(
      OUTCOMES.IGNORED_TERMINAL,
    );
    expect(decideAbsent(stored('a', { state: 'suppressed' }), context()).outcome).toBe(
      OUTCOMES.IGNORED_TERMINAL,
    );
  });

  it('checks terminality BEFORE completeness', () => {
    // Order matters for the log, not the ledger: both outcomes change nothing,
    // but reporting HELD for a tombstoned record would imply the engine is still
    // waiting to decide about a record it decided about months ago.
    const decision = decideAbsent(
      stored('a', { state: 'tombstoned' }),
      context({ completeness: 'partial' }),
    );

    expect(decision.outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });

  it('HELD when this harvest instant has already been counted', () => {
    // The PT-01 idempotence guard. Without it a retried shard advances every
    // absent record's streak a second time.
    const decision = decideAbsent(stored('a'), context({ alreadyCounted: true }));

    expect(decision.outcome).toBe(OUTCOMES.HELD);
    expect(decision.reason).toContain('already been counted');
  });

  it('counts normally when the flag is absent or false', () => {
    expect(decideAbsent(stored('a'), context({ alreadyCounted: false })).outcome).toBe(
      OUTCOMES.MISSING,
    );
    expect(decideAbsent(stored('a'), context()).outcome).toBe(OUTCOMES.MISSING);
  });
});

describe('isNoOpOutcome', () => {
  it('is true exactly for the outcomes that change nothing', () => {
    expect(isNoOpOutcome(OUTCOMES.HELD)).toBe(true);
    expect(isNoOpOutcome(OUTCOMES.IGNORED_TERMINAL)).toBe(true);
    expect(isNoOpOutcome(OUTCOMES.MISSING)).toBe(false);
    expect(isNoOpOutcome(OUTCOMES.TOMBSTONED)).toBe(false);
    expect(isNoOpOutcome(OUTCOMES.UNCHANGED)).toBe(false);
  });
});

describe('every decision is frozen and fully shaped', () => {
  it('returns identity_hash, outcome and reason, frozen', () => {
    const decisions = [
      decideObserved(review('a'), undefined, context()),
      decideAbsent(stored('a'), context()),
    ];

    for (const decision of decisions) {
      expect(Object.keys(decision).sort()).toEqual(['identity_hash', 'outcome', 'reason']);
      expect(Object.isFrozen(decision)).toBe(true);
      expect(decision.identity_hash).toBe(identity('a'));
    }
  });
});
