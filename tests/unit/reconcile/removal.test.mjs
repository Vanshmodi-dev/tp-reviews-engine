import { describe, expect, it } from 'vitest';

import {
  checkRemovalPolicy,
  evaluateRemoval,
  isTerminalState,
} from '../../../src/core/reconcile/removal.mjs';
import { T1 } from '../../helpers/reconcile-input.mjs';

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const policy = (overrides = {}) => ({
  removalConfirmations: 3,
  keepTombstones: true,
  ...overrides,
});

/**
 * @param {number} missing_streak
 * @param {string} [state]
 * @param {string | null} [tombstoned_at]
 * @returns {any}
 */
const record = (missing_streak, state = 'active', tombstoned_at = null) => ({
  missing_streak,
  state,
  tombstoned_at,
});

describe('evaluateRemoval — the confirmation window', () => {
  it('advances the streak without tombstoning below the threshold', () => {
    expect(evaluateRemoval(record(0), policy(), T1)).toEqual({
      tombstone: false,
      nextStreak: 1,
      nextState: 'unconfirmed',
      tombstonedAt: null,
    });
  });

  it('keeps an unconfirmed record published, deliberately', () => {
    // `unconfirmed` is a publishable state. Pulling a review at its first
    // absence would make every transient failure visible to visitors.
    expect(evaluateRemoval(record(1), policy(), T1).nextState).toBe('unconfirmed');
    expect(isTerminalState('unconfirmed')).toBe(false);
  });

  it('tombstones exactly at the threshold, not before or after', () => {
    expect(evaluateRemoval(record(1), policy(), T1).tombstone).toBe(false);
    expect(evaluateRemoval(record(2), policy(), T1).tombstone).toBe(true);
    expect(evaluateRemoval(record(2), policy(), T1).nextStreak).toBe(3);
  });

  it('stamps tombstoned_at from the passed clock, never its own', () => {
    const outcome = evaluateRemoval(record(2), policy(), T1);

    expect(outcome.tombstonedAt).toBe(T1);
    expect(String(evaluateRemoval)).not.toContain('Date.now');
    expect(String(evaluateRemoval)).not.toContain('new Date(');
  });

  it('honours a threshold of 2 and of 10', () => {
    expect(evaluateRemoval(record(1), policy({ removalConfirmations: 2 }), T1).tombstone).toBe(
      true,
    );
    expect(evaluateRemoval(record(8), policy({ removalConfirmations: 10 }), T1).tombstone).toBe(
      false,
    );
    expect(evaluateRemoval(record(9), policy({ removalConfirmations: 10 }), T1).tombstone).toBe(
      true,
    );
  });

  it('leaves a tombstoned record completely alone', () => {
    // Not re-tombstoned, and the streak stops moving. Otherwise `missing_streak`
    // climbs forever and `tombstoned_at` drifts away from the harvest that
    // actually decided it.
    const prior = record(3, 'tombstoned', '2026-02-15T00:00:00.000Z');

    expect(evaluateRemoval(prior, policy(), T1)).toEqual({
      tombstone: false,
      nextStreak: 3,
      nextState: 'tombstoned',
      tombstonedAt: '2026-02-15T00:00:00.000Z',
    });
  });

  it('leaves a suppressed record completely alone', () => {
    const outcome = evaluateRemoval(record(0, 'suppressed'), policy(), T1);

    expect(outcome.nextState).toBe('suppressed');
    expect(outcome.tombstone).toBe(false);
  });

  it('returns a frozen outcome on every path', () => {
    expect(Object.isFrozen(evaluateRemoval(record(0), policy(), T1))).toBe(true);
    expect(Object.isFrozen(evaluateRemoval(record(2), policy(), T1))).toBe(true);
    expect(Object.isFrozen(evaluateRemoval(record(0, 'tombstoned'), policy(), T1))).toBe(true);
  });

  it('never reads completeness — the caller gates that', () => {
    // Asserting completeness here as well would put the asymmetry in two
    // places, and two copies of one rule is how they diverge.
    expect(String(evaluateRemoval)).not.toContain('completeness');
  });
});

describe('isTerminalState', () => {
  it('is true exactly for tombstoned and suppressed', () => {
    expect(isTerminalState('tombstoned')).toBe(true);
    expect(isTerminalState('suppressed')).toBe(true);
    expect(isTerminalState('active')).toBe(false);
    expect(isTerminalState('unconfirmed')).toBe(false);
    expect(isTerminalState(undefined)).toBe(false);
  });
});

describe('checkRemovalPolicy', () => {
  it('accepts the documented defaults', () => {
    expect(checkRemovalPolicy(policy())).toEqual([]);
  });

  it('rejects keepTombstones: false rather than honouring it', () => {
    // Honouring it would mean deleting ledger records, which makes PT-03
    // unenforceable: a deleted identity is not terminal, it is absent, and
    // absent identities get re-inserted on the next harvest.
    const violations = checkRemovalPolicy(policy({ keepTombstones: false }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('never deletes');
  });

  it('rejects a threshold outside 2..10', () => {
    expect(checkRemovalPolicy(policy({ removalConfirmations: 1 }))).toHaveLength(1);
    expect(checkRemovalPolicy(policy({ removalConfirmations: 11 }))).toHaveLength(1);
    expect(checkRemovalPolicy(policy({ removalConfirmations: 2 }))).toEqual([]);
    expect(checkRemovalPolicy(policy({ removalConfirmations: 10 }))).toEqual([]);
  });

  it('rejects a non-integer threshold', () => {
    expect(checkRemovalPolicy(policy({ removalConfirmations: 2.5 }))).toHaveLength(1);
    expect(checkRemovalPolicy(policy({ removalConfirmations: Number.NaN }))).toHaveLength(1);
  });

  it('reports every violation, not the first', () => {
    expect(checkRemovalPolicy({ removalConfirmations: 0, keepTombstones: false })).toHaveLength(2);
  });
});
