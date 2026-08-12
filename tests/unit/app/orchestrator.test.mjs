import { describe, expect, it } from 'vitest';

import { missingOutcomes, runShard } from '../../../src/app/orchestrator.mjs';
import { OUTCOME_STATES, runTarget } from '../../../src/app/target-runner.mjs';
import { buildManifest, checkManifest } from '../../../src/app/run-manifest.mjs';

/**
 * A clock that only moves when a test says so.
 *
 * Wall-clock timing in a budget test measures the machine, not the logic.
 *
 * @param {number} [start]
 * @returns {{ now: () => number, advance: (ms: number) => void }}
 */
function clock(start = 1_000) {
  let value = start;

  return { now: () => value, advance: (ms) => (value += ms) };
}

/**
 * @param {number} count
 * @returns {any[]}
 */
const targets = (count) =>
  Array.from({ length: count }, (_, index) => ({
    clientSlug: `c${index}`,
    listingKey: 'main',
  }));

describe('TR-APP-001 — one target cannot end another', () => {
  it('keeps going after a target throws', async () => {
    // Thirty clients share a run. The one whose source is having a bad morning
    // must not take the other twenty-nine with it (INV-09).
    const time = clock();
    const run = await runShard(targets(4), {
      runId: 'run-1',
      now: time.now,
      stages: async (target) => {
        if (target.clientSlug === 'c2') throw new Error('the source fell over');

        return { stopReason: 'target_reached', finalCount: 10 };
      },
    });

    expect(run.outcomes).toHaveLength(4);
    expect(run.outcomes.filter((o) => o.state === 'succeeded')).toHaveLength(3);

    const failed = run.outcomes.find((o) => o.state === 'failed');

    expect(failed?.clientSlug).toBe('c2');
    expect(failed?.detail).toContain('the source fell over');
  });

  it('survives a rejection with no message and a non-Error throw', async () => {
    // Not every rejection is an Error. A stage that rejects with a string would
    // make `error.message` undefined, and an envelope that assumed otherwise
    // would throw inside the very code meant to contain the failure.
    const time = clock();
    /** @param {unknown} value @returns {Promise<never>} */
    const rejectWith = (value) => Promise.reject(value);
    const run = await runShard(targets(2), {
      runId: 'r',
      now: time.now,
      stages: () => rejectWith('a bare string'),
    });

    expect(run.outcomes.every((o) => o.state === 'failed')).toBe(true);
    expect(run.outcomes[0]?.detail).toBe('a bare string');
  });
});

describe('TR-APP-004 — a per-target budget aborts the target, not the run', () => {
  it('marks it ERR-BUDGET-TARGET and moves on', async () => {
    const time = clock();
    const run = await runShard(targets(3), {
      runId: 'r',
      now: time.now,
      budgetTargetMs: 20,
      stages: async (target) =>
        target.clientSlug === 'c1'
          ? new Promise(() => {}) // never settles
          : { stopReason: 'target_reached', finalCount: 5 },
    });

    const overran = run.outcomes.find((o) => o.code === 'ERR-BUDGET-TARGET');

    expect(overran?.state).toBe('failed');
    expect(run.outcomes.filter((o) => o.state === 'succeeded')).toHaveLength(2);
  });
});

describe('SCHED-03 / CH-13 — run-budget exhaustion DEFERS, never fails', () => {
  it('marks every remaining target deferred', async () => {
    // `failed` raises alerts for targets nothing went wrong with and pollutes
    // the success-rate metric with a scheduling decision. `deferred` says what
    // actually happened: we ran out of time before reaching it.
    const time = clock();
    const run = await runShard(targets(5), {
      runId: 'r',
      now: time.now,
      budgetRunMs: 100,
      stages: async () => {
        time.advance(60);

        return { stopReason: 'target_reached', finalCount: 3 };
      },
    });

    const states = run.outcomes.map((o) => o.state);

    expect(run.budgetExhausted).toBe(true);
    expect(states).toContain('deferred');
    expect(states).not.toContain('failed');
    expect(run.outcomes.filter((o) => o.state === 'deferred')[0]?.code).toBe('ERR-BUDGET-RUN');
  });

  it('finishes the target it is on rather than abandoning it mid-flight', async () => {
    // Aborting halfway leaves a partial harvest that looks like a stall — and a
    // partial harvest is the one thing the absence asymmetry must never be fed
    // by accident.
    const time = clock();
    let completed = 0;
    const run = await runShard(targets(3), {
      runId: 'r',
      now: time.now,
      budgetRunMs: 1,
      stages: async () => {
        time.advance(50);
        completed += 1;

        return { stopReason: 'target_reached', finalCount: 1 };
      },
    });

    expect(completed).toBe(1);
    expect(run.outcomes.filter((o) => o.state === 'succeeded')).toHaveLength(1);
    expect(run.outcomes.filter((o) => o.state === 'deferred')).toHaveLength(2);
  });
});

describe('TR-APP-006 — every target appears in the outcome list', () => {
  it('accounts for blocked, deferred, failed, and succeeded alike', async () => {
    const time = clock();
    const run = await runShard(targets(4), {
      runId: 'r',
      now: time.now,
      gate: async (target) => ({
        allow: target.clientSlug !== 'c0',
        code: target.clientSlug === 'c0' ? 'ERR-POLICY-KILLSWITCH' : null,
        reasons: [
          { check: 1, name: 'global-kill-switch', passed: target.clientSlug !== 'c0', detail: 'x' },
        ],
        recordedAt: '2026-01-01T00:00:00.000Z',
      }),
      stages: async (target) => {
        if (target.clientSlug === 'c1') throw new Error('boom');

        return { stopReason: 'target_reached', finalCount: 2 };
      },
    });

    expect(missingOutcomes(targets(4), run.outcomes)).toEqual([]);
    expect(new Set(run.outcomes.map((o) => o.state))).toEqual(
      new Set(['blocked', 'failed', 'succeeded']),
    );
  });

  it('names any target the loop dropped', async () => {
    // Asserted rather than trusted, because the failure is invisible: a run
    // that quietly dropped a target produces a manifest that looks complete.
    expect(missingOutcomes(targets(3), [{ clientSlug: 'c0', listingKey: 'main' }])).toEqual([
      'c1/main',
      'c2/main',
    ]);
  });

  it('reports a preflight denial as BLOCKED, not failed', async () => {
    // A kill switch or an open breaker is the system working as configured.
    // Counting it as a failure makes the success-rate metric measure policy
    // rather than health.
    const time = clock();
    const outcome = await runTarget(
      { clientSlug: 'a', listingKey: 'm' },
      {
        now: time.now,
        gate: async () => ({
          allow: false,
          code: 'ERR-POLICY-BREAKER-OPEN',
          reasons: [
            { check: 7, name: 'circuit-breaker', passed: false, detail: 'open until 10:00' },
          ],
          recordedAt: '2026-01-01T00:00:00.000Z',
        }),
        stages: async () => ({}),
      },
    );

    expect(outcome.state).toBe('blocked');
    expect(outcome.code).toBe('ERR-POLICY-BREAKER-OPEN');
    expect(outcome.detail).toContain('check 7');
  });

  it('treats a preflight that THROWS as a failure, not as permission', async () => {
    // Failing open here would run a target the gate never cleared.
    const time = clock();
    const outcome = await runTarget(
      { clientSlug: 'a', listingKey: 'm' },
      {
        now: time.now,
        gate: async () => {
          throw new Error('robots fetch exploded');
        },
        stages: async () => ({}),
      },
    );

    expect(outcome.state).toBe('failed');
    expect(outcome.code).toBe('ERR-PREFLIGHT-FAILED');
  });

  it('declares deferred as a first-class state', () => {
    expect(OUTCOME_STATES).toContain('deferred');
    expect(OUTCOME_STATES).toContain('blocked');
  });
});

describe('TR-APP-003 — ordering is seeded, and pacing sits between targets', () => {
  it('orders by the run id, not by the input order', async () => {
    const time = clock();
    /** @type {string[]} */
    const order = [];
    const run = await runShard(targets(6), {
      runId: 'run-XYZ',
      now: time.now,
      stages: async (target) => {
        order.push(target.clientSlug);

        return {};
      },
    });

    expect(order).toHaveLength(6);
    expect(run.outcomes.map((o) => o.clientSlug)).toEqual(order);
    expect(order).not.toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('paces between targets but not before the first', async () => {
    const time = clock();
    /** @type {number[]} */
    const delays = [];

    await runShard(targets(3), {
      runId: 'r',
      now: time.now,
      interTargetDelayMs: 500,
      pace: async (ms) => {
        delays.push(ms);
      },
      stages: async () => ({}),
    });

    // A single-target run should not pay for pacing it does not need.
    expect(delays).toEqual([500, 500]);
  });
});

describe('DEL-72 — the run manifest answers the questions people ask', () => {
  /**
   * @returns {Promise<any>}
   */
  async function manifest() {
    const time = clock();
    const planned = targets(3);
    const run = await runShard(planned, {
      runId: 'run-1',
      now: time.now,
      budgetRunMs: 100,
      gate: async () => ({
        allow: true,
        code: null,
        reasons: [{ check: 1, name: 'global-kill-switch', passed: true, detail: 'not engaged' }],
        recordedAt: '2026-08-10T00:00:00.000Z',
      }),
      stages: async () => {
        time.advance(60);

        return { stopReason: 'stalled', finalCount: 12, growthCurve: [4, 12, 12, 12] };
      },
    });

    return buildManifest({
      runId: 'run-1',
      generatedAt: '2026-08-10T00:01:00.000Z',
      run,
      planned,
      shardPlan: { shards: [{ index: 0, targets: planned, cost: 30 }], balance: 1, totalCost: 30 },
      engine: { version: '1.0.0' },
    });
  }

  it('accounts for every planned target', async () => {
    expect(checkManifest(await manifest())).toEqual([]);
  });

  it('catches a manifest that lost a target', () => {
    const problems = checkManifest({
      planned_count: 5,
      counts: { succeeded: 2, failed: 0, blocked: 0, deferred: 0, skipped: 0 },
      targets: [],
    });

    expect(problems.join(' ')).toContain('accounts for 2 of 5');
    expect(problems.join(' ')).toContain('TR-APP-006');
  });

  it('reports every state at zero rather than omitting it', async () => {
    // A dashboard that shows a missing key as blank rather than as zero is a
    // dashboard that hides the interesting run.
    const built = await manifest();

    for (const state of OUTCOME_STATES) {
      expect(typeof built.counts[state]).toBe('number');
    }
  });

  it('carries the stop reason and the growth curve, not just a count', async () => {
    // VAL-01: completeness comes from the stop reason. Carrying only the count
    // would invite a reader to infer completeness from it.
    const built = await manifest();
    const succeeded = built.targets.find((/** @type {any} */ t) => t.state === 'succeeded');

    expect(succeeded.stop_reason).toBe('stalled');
    expect(succeeded.growth_curve).toEqual([4, 12, 12, 12]);
  });

  it('records the preflight verdict on an ALLOW (TR-APP-010)', async () => {
    const built = await manifest();
    const succeeded = built.targets.find((/** @type {any} */ t) => t.state === 'succeeded');

    expect(succeeded.preflight.allow).toBe(true);
    expect(succeeded.preflight.checks).toHaveLength(1);
    expect(succeeded.preflight.recorded_at).toBe('2026-08-10T00:00:00.000Z');
  });

  it('records the shard balance, so drift is visible before it is a timeout', async () => {
    const built = await manifest();

    expect(built.shard.balance).toBe(1);
    expect(built.shard.shards[0]).toMatchObject({ index: 0, target_count: 3, cost: 30 });
  });

  it('records that the run budget was exhausted', async () => {
    const built = await manifest();

    expect(built.budget_exhausted).toBe(true);
    expect(built.counts.deferred).toBeGreaterThan(0);
  });
});
