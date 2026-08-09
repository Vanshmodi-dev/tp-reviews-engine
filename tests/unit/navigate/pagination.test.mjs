import { describe, expect, it } from 'vitest';

import { STOP_REASONS } from '../../../src/core/model/report.mjs';
import { classifyCompleteness } from '../../../src/core/validate/completeness.mjs';
import {
  BASE_SETTLE_MS,
  DEFAULT_STALL_THRESHOLD,
  EXHAUSTED_RATIO,
  backoffFor,
  evaluateStop,
  quietIterations,
  scrollStep,
} from '../../../src/adapters/acquisition/google-dom/pagination.mjs';
import {
  CONSENT_WALL_ERROR,
  classifyConsent,
} from '../../../src/adapters/acquisition/google-dom/consent.mjs';

const LIMITS = { maxReviews: 5_000, paginationBudgetMs: 120_000 };

/**
 * @param {number[]} growthCurve
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
const at = (growthCurve, over = {}) =>
  evaluateStop(
    { growthCurve, elapsedMs: 0, advertisedTotal: null, ...over },
    { ...LIMITS, ...(over['limits'] ?? {}) },
  );

describe('§19.4 — the five stop conditions, in the normative order', () => {
  it('does not stop while the count is still growing', () => {
    expect(at([10, 22, 34])).toMatchObject({ stop: false, reason: null });
  });

  it('cap_reached when the count meets our own ceiling', () => {
    expect(at([100], { limits: { maxReviews: 100 } })).toMatchObject({
      stop: true,
      reason: 'cap_reached',
    });
  });

  it('target_reached when the count meets the advertised total', () => {
    expect(at([118], { advertisedTotal: 118 })).toMatchObject({
      stop: true,
      reason: 'target_reached',
    });
  });

  it('checks the CAP BEFORE the target, and the order is load-bearing', () => {
    // A harvest that hit both is `cap_reached`, therefore `full_capped`, not
    // `full`. The difference decides whether a later count drop is measured
    // against the cap or against the source's advertised total — so reversing
    // these two produces a system that publishes correctly and reconciles
    // wrongly, which is the worst combination available.
    const both = at([100], { advertisedTotal: 100, limits: { maxReviews: 100 } });

    expect(both.reason).toBe('cap_reached');
    expect(classifyCompleteness({ stop_reason: both.reason })).toBe('full_capped');
  });

  it('stalled after the threshold of consecutive quiet iterations', () => {
    expect(at([50, 50, 50, 50], { advertisedTotal: 500 })).toMatchObject({
      stop: true,
      reason: 'stalled',
    });
  });

  it('does not declare a stall one iteration early', () => {
    expect(at([50, 50, 50], { advertisedTotal: 500 }).stop).toBe(false);
    expect(DEFAULT_STALL_THRESHOLD).toBe(3);
  });

  it('budget_exhausted when the clock runs out while still growing', () => {
    expect(at([10, 20], { elapsedMs: 120_000 })).toMatchObject({
      stop: true,
      reason: 'budget_exhausted',
    });
  });

  it('checks growth BEFORE the clock', () => {
    // A harvest that finished on its final iteration must not be reported as
    // having run out of budget on the same tick — `target_reached` and
    // `budget_exhausted` map to opposite completeness values.
    expect(at([118], { advertisedTotal: 118, elapsedMs: 999_999 }).reason).toBe('target_reached');
  });

  it('produces only reasons the model knows about', () => {
    // A stop reason the vocabulary does not contain is classified `failed` by
    // the fail-closed default — safe, but it would silently stop every publish.
    const produced = [
      at([100], { limits: { maxReviews: 100 } }),
      at([118], { advertisedTotal: 118 }),
      at([50, 50, 50, 50], { advertisedTotal: 500 }),
      at([96, 96, 96, 96], { advertisedTotal: 100 }),
      at([10, 20], { elapsedMs: 120_000 }),
    ].map((decision) => decision.reason);

    for (const reason of produced) expect(STOP_REASONS).toContain(reason);
  });
});

describe('TR-NAV-021 — `exhausted` is not `stalled`', () => {
  it('reports exhausted when growth stopped within 95% of advertised', () => {
    // The clause that separates them. Without it, a listing whose advertised
    // total is stale is `partial` forever: removals are never confirmed and
    // tombstoning silently stops working.
    const decision = at([96, 96, 96, 96], { advertisedTotal: 100 });

    expect(decision.reason).toBe('exhausted');
    expect(classifyCompleteness({ stop_reason: 'exhausted' })).toBe('full');
  });

  it('reports stalled when growth stopped well short', () => {
    const decision = at([12, 12, 12, 12], { advertisedTotal: 118 });

    expect(decision.reason).toBe('stalled');
    expect(classifyCompleteness({ stop_reason: 'stalled' })).toBe('partial');
  });

  it('reports stalled — never exhausted — when there is no advertised total', () => {
    // With nothing to compare against, "we have it all" is a guess. Guessing
    // in this direction authorises deletions.
    const decision = at([40, 40, 40, 40], { advertisedTotal: null });

    expect(decision.reason).toBe('stalled');
    expect(decision.detail).toContain('no advertised total');
  });

  it('treats an advertised total of zero as absent rather than as reached', () => {
    // `count >= 0` is true for every harvest. A zero advertised total that
    // counted as a target would classify every run `target_reached`.
    expect(at([5, 5, 5, 5], { advertisedTotal: 0 }).reason).toBe('stalled');
  });

  it('sits exactly on the boundary the ratio names', () => {
    const boundary = Math.ceil(100 * EXHAUSTED_RATIO);

    expect(at([boundary, boundary, boundary, boundary], { advertisedTotal: 100 }).reason).toBe(
      'exhausted',
    );
    expect(
      at([boundary - 1, boundary - 1, boundary - 1, boundary - 1], { advertisedTotal: 100 }).reason,
    ).toBe('stalled');
  });
});

describe('the two no-growth reasons map to opposite treatments', () => {
  it('exhausted permits absence to count; stalled does not', () => {
    // This pair is the whole reason the distinction exists. `full` lets the
    // reconciler treat a missing review as evidence of removal; `partial`
    // forbids it.
    expect(classifyCompleteness({ stop_reason: 'exhausted' })).toBe('full');
    expect(classifyCompleteness({ stop_reason: 'stalled' })).toBe('partial');
    expect(classifyCompleteness({ stop_reason: 'budget_exhausted' })).toBe('partial');
    expect(classifyCompleteness({ stop_reason: 'error' })).toBe('failed');
  });

  it('still fails closed on a reason nobody mapped', () => {
    expect(classifyCompleteness({ stop_reason: 'invented_later' })).toBe('failed');
  });
});

describe('TR-NAV-020 — stall detection backs off', () => {
  it('increases the wait on each consecutive quiet iteration', () => {
    expect(backoffFor(1)).toBe(BASE_SETTLE_MS);
    expect(backoffFor(2)).toBe(BASE_SETTLE_MS * 2);
    expect(backoffFor(3)).toBe(BASE_SETTLE_MS * 4);
  });

  it('never waits less than the base, whatever it is handed', () => {
    // A stall declared after three IMMEDIATE re-scrolls is a stall declared
    // about the network, not about the source — and a false `stalled` marks a
    // complete harvest `partial`.
    expect(backoffFor(0)).toBe(BASE_SETTLE_MS);
    expect(backoffFor(-5)).toBe(BASE_SETTLE_MS);
  });

  it('counts only the TRAILING quiet run', () => {
    // A plateau in the middle of a harvest that later resumed is not a stall.
    expect(quietIterations([10, 10, 10, 25, 40])).toBe(0);
    expect(quietIterations([10, 25, 40, 40, 40])).toBe(2);
    expect(quietIterations([])).toBe(0);
    expect(quietIterations([7])).toBe(0);
  });
});

describe('EDR-013 — scrolling is by ratio, never to the bottom', () => {
  it('scrolls a fraction of the container height', () => {
    expect(scrollStep(1_000, 0.9)).toBe(900);
    expect(scrollStep(1_000, 0.5)).toBe(500);
  });

  it('never exceeds one container height', () => {
    // Past the virtualisation window the intervening rows are never
    // materialised, so the harvest silently returns fewer reviews than exist —
    // a correctness failure disguised as a performance win, raising no error.
    expect(scrollStep(1_000, 5)).toBe(1_000);
  });

  it('never scrolls nowhere', () => {
    // A zero step means pagination can only ever end by budget.
    expect(scrollStep(1_000, 0)).toBeGreaterThan(0);
    expect(scrollStep(0, 0.9)).toBeGreaterThan(0);
  });
});

describe('TR-NAV-012 — only benign, dismissible interstitials', () => {
  it('reports absent when there is no interstitial', () => {
    expect(
      classifyConsent({
        interstitialPresent: false,
        surfacePresentAfter: true,
        dismissAttempted: false,
      }).state,
    ).toBe('absent');
  });

  it('reports dismissed when the surface appears afterwards', () => {
    expect(
      classifyConsent({
        interstitialPresent: true,
        surfacePresentAfter: true,
        dismissAttempted: true,
      }).state,
    ).toBe('dismissed');
  });

  it('reports a WALL when dismissal ran and the surface did not appear', () => {
    // And stops. A component that tries five ways past an obstacle is working
    // around a decision the source made, which is the line ADR-010 draws.
    const outcome = classifyConsent({
      interstitialPresent: true,
      surfacePresentAfter: false,
      dismissAttempted: true,
    });

    expect(outcome.state).toBe('wall');
    expect(outcome.detail).toContain('TR-NAV-012');
  });

  it('reports a wall when the pack declares no dismissal control', () => {
    expect(
      classifyConsent({
        interstitialPresent: true,
        surfacePresentAfter: false,
        dismissAttempted: false,
      }).state,
    ).toBe('wall');
  });

  it('uses its own error class, not the challenge class', () => {
    // A consent wall is a page state, not an access decision. Reporting it as
    // a block would open the breaker for the whole source-access pair over
    // something that is not evidence of blocking.
    expect(CONSENT_WALL_ERROR).toBe('ERR-NAV-CONSENT-WALL');
  });
});
