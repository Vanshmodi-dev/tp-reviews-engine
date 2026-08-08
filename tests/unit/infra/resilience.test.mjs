import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  admits,
  breakerKey,
  closedBreaker,
  cooldownFor,
  recordFailure,
  recordSuccess,
} from '../../../src/infra/breaker/circuit.mjs';
import {
  emptyBudget,
  isUsableBudget,
  remaining,
  reserve,
  rollWindows,
} from '../../../src/infra/limiter/token-bucket.mjs';

const T = (/** @type {string} */ iso) => iso;
const NOW = T('2026-03-01T12:00:00.000Z');

describe('the circuit breaker', () => {
  const policy = { failureThreshold: 3, cooldownMs: 1000 };

  it('starts closed and admits requests', () => {
    expect(admits(closedBreaker(), NOW).allowed).toBe(true);
  });

  it('opens only after consecutive failures reach the threshold', () => {
    let state = closedBreaker();

    state = recordFailure(state, NOW, policy);
    expect(state.state).toBe('closed');
    state = recordFailure(state, NOW, policy);
    expect(state.state).toBe('closed');
    state = recordFailure(state, NOW, policy);
    expect(state.state).toBe('open');
  });

  it('refuses requests while open', () => {
    const open = recordFailure(
      recordFailure(recordFailure(closedBreaker(), NOW, policy), NOW, policy),
      NOW,
      policy,
    );
    const verdict = admits(open, NOW);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('open until');
  });

  it('admits exactly one trial request once the cooldown elapses', () => {
    const open = tripped(policy);
    const later = T('2026-03-01T12:00:02.000Z');
    const verdict = admits(open, later);

    expect(verdict.allowed).toBe(true);
    expect(verdict.next.state).toBe('half_open');

    // The caller persists `half_open` BEFORE the trial. A second concurrent
    // request must not also be admitted, or the probe becomes the burst the
    // breaker exists to prevent.
    expect(admits(verdict.next, later).allowed).toBe(false);
  });

  it('reopens immediately when a trial fails, without re-accumulating', () => {
    // The trial already answered the question the threshold exists to ask.
    const halfOpen = { ...tripped(policy), state: 'half_open' };
    const reopened = recordFailure(halfOpen, NOW, policy);

    expect(reopened.state).toBe('open');
    expect(reopened.trips).toBe(2);
  });

  it('closes when a trial succeeds', () => {
    const halfOpen = { ...tripped(policy), state: 'half_open' };
    const closed = recordSuccess(halfOpen);

    expect(closed.state).toBe('closed');
    expect(closed.failures).toBe(0);
    expect(admits(closed, NOW).allowed).toBe(true);
  });

  it('PRESERVES the trip count across a recovery', () => {
    // A source that has tripped four times is not the same risk as one that
    // never has. Resetting escalation on recovery produces a circuit that flaps
    // at the shortest cooldown forever.
    const recovered = recordSuccess({ ...tripped(policy), state: 'half_open' });

    expect(recovered.trips).toBe(1);
    expect(cooldownFor(recovered.trips + 1, policy)).toBeGreaterThan(
      cooldownFor(recovered.trips, policy),
    );
  });

  it('escalates the cooldown on each trip', () => {
    expect(cooldownFor(1, policy)).toBe(1000);
    expect(cooldownFor(2, policy)).toBe(2000);
    expect(cooldownFor(3, policy)).toBe(4000);
  });

  it('caps the cooldown, so a bad morning is not a muted Friday', () => {
    expect(cooldownFor(50)).toBe(MAX_COOLDOWN_MS);
    expect(cooldownFor(1)).toBe(DEFAULT_COOLDOWN_MS);
  });

  it('clears the failure count when it opens', () => {
    expect(tripped(policy).failures).toBe(0);
  });

  it('keys per source-access pair', () => {
    // `google:api` being rate-limited says nothing about `google:dom`, and
    // tripping both would take out a working path with a broken one.
    expect(breakerKey('google', 'api')).not.toBe(breakerKey('google', 'dom'));
  });

  it('returns frozen states, so a caller cannot edit the circuit open', () => {
    expect(Object.isFrozen(closedBreaker())).toBe(true);
    expect(Object.isFrozen(tripped(policy))).toBe(true);
    expect(Object.isFrozen(recordSuccess(closedBreaker()))).toBe(true);
  });

  it('handles an open breaker with no retryAt rather than admitting it', () => {
    const malformed = { ...closedBreaker(), state: 'open', retryAt: null };

    expect(admits(malformed, NOW).allowed).toBe(false);
  });
});

/**
 * @param {any} policy
 * @returns {any}
 */
function tripped(policy) {
  let state = closedBreaker();

  for (let i = 0; i < (policy.failureThreshold ?? 5); i += 1) {
    state = recordFailure(state, NOW, policy);
  }

  return state;
}

describe('rate budget accounting is pessimistic (EDR-034)', () => {
  const limits = { perHour: 3, perDay: 5 };

  it('returns the state to persist BEFORE the request is made', () => {
    // Counting after a request loses the record of one the source definitely
    // saw. Under-counting compounds, and the thing at the other end of the gap
    // is a platform deciding we are abusing it.
    const verdict = reserve(emptyBudget(NOW), limits, NOW);

    expect(verdict.allowed).toBe(true);
    expect(verdict.next.hourCount).toBe(1);
    expect(verdict.next.dayCount).toBe(1);
  });

  it('refuses once the hourly limit is reached', () => {
    let budget = emptyBudget(NOW);

    for (let i = 0; i < limits.perHour; i += 1) budget = reserve(budget, limits, NOW).next;

    const verdict = reserve(budget, limits, NOW);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('hourly');
  });

  it('refuses once the daily limit is reached, even in a fresh hour', () => {
    let budget = emptyBudget(NOW);
    const hours = ['T12', 'T13'];

    for (const hour of hours) {
      const at = `2026-03-01${hour}:00:00.000Z`;
      for (let i = 0; i < limits.perHour; i += 1) {
        const verdict = reserve(budget, limits, at);
        if (verdict.allowed) budget = verdict.next;
      }
    }

    const verdict = reserve(budget, limits, '2026-03-01T14:00:00.000Z');

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('daily');
  });

  it('rolls the hourly counter into a new hour', () => {
    const spent = reserve(emptyBudget(NOW), limits, NOW).next;
    const rolled = rollWindows(spent, '2026-03-01T13:00:00.000Z');

    expect(rolled.hourCount).toBe(0);
    expect(rolled.dayCount).toBe(1);
  });

  it('rolls both counters into a new day', () => {
    const spent = reserve(emptyBudget(NOW), limits, NOW).next;
    const rolled = rollWindows(spent, '2026-03-02T00:00:00.000Z');

    expect(rolled.hourCount).toBe(0);
    expect(rolled.dayCount).toBe(0);
  });

  it('reports what remains, never negative', () => {
    // A budget reading -3 after a limit was lowered mid-day renders as nonsense
    // in a status output; zero says the same thing and is true.
    const overspent = { ...emptyBudget(NOW), hourCount: 99, dayCount: 99 };

    expect(remaining(overspent, limits, NOW)).toEqual({ hour: 0, day: 0 });
    expect(remaining(emptyBudget(NOW), limits, NOW)).toEqual({ hour: 3, day: 5 });
  });

  it('fails closed on an unusable budget', () => {
    // "The state file was corrupt" and "the budget is exhausted" must produce
    // the same outcome at the call site.
    expect(isUsableBudget(null)).toBe(false);
    expect(isUsableBudget('nonsense')).toBe(false);
    expect(isUsableBudget({})).toBe(false);
    expect(isUsableBudget({ hourKey: 'x', dayKey: 'y', hourCount: -1, dayCount: 0 })).toBe(false);
    expect(isUsableBudget({ hourKey: 'x', dayKey: 'y', hourCount: 1.5, dayCount: 0 })).toBe(false);
    expect(isUsableBudget(emptyBudget(NOW))).toBe(true);
  });

  it('keys windows on the UTC hour and day', () => {
    const budget = emptyBudget('2026-03-01T12:34:56.000Z');

    expect(budget.hourKey).toBe('2026-03-01T12');
    expect(budget.dayKey).toBe('2026-03-01');
  });
});
