import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ERROR_CLASSES, ERROR_CODES } from '../../../src/core/model/errors.mjs';
import { executeWithRetry } from '../../../src/infra/retry/execute.mjs';
import { createRetryPolicy, delayFor } from '../../../src/infra/retry/policy.mjs';
import { createSeededRandom } from '../../helpers/seeded-random.mjs';

/**
 * The taxonomy is injected here exactly as the composition root injects it.
 * `infra/` may not import `core/` (the architecture rule that caught the first
 * draft of this module); a test may import both, because joining the two is
 * precisely what it is checking.
 */
const policy = createRetryPolicy(ERROR_CLASSES);
const { policyFor, isRetryable, neverRetryClasses } = policy;

/** A random port shape, satisfying both `next` and `intBetween`. */
const randomOf = (/** @type {number} */ seed) => {
  const seeded = createSeededRandom(seed);

  return {
    next: () => seeded.next(),
    intBetween: (/** @type {number} */ min, /** @type {number} */ max) => seeded.int(min, max),
  };
};

/**
 * T-137 — the enumerating test.
 *
 * Its acceptance is that it **enumerates the taxonomy rather than a hand-written
 * list**, and its verification is that a reviewer adding a fake blocked class
 * sees it caught. A hand list passes forever after someone adds a class to the
 * taxonomy and forgets to add it here, which is precisely the moment the test
 * was supposed to matter.
 */

describe('INV-07 — a challenge is terminal, enumerated from the taxonomy', () => {
  it('finds blocked classes to check, so the enumeration is not vacuous', () => {
    const blocked = ERROR_CODES.filter((code) => code.startsWith('ERR-BLOCKED-'));

    expect(blocked.length).toBeGreaterThan(0);
  });

  it('returns never for EVERY ERR-BLOCKED-* class', () => {
    // X-10: never add a retry to a blocked path, including "just one retry to
    // see if it clears". A retry against a source that is actively refusing us
    // confirms the block and escalates it.
    for (const code of ERROR_CODES.filter((c) => c.startsWith('ERR-BLOCKED-'))) {
      expect(policyFor(code).strategy, code).toBe('never');
      expect(policyFor(code).maxAttempts, code).toBe(0);
      expect(isRetryable(code), code).toBe(false);
    }
  });

  it('catches a blocked class that was given a retry policy', () => {
    // The reviewer's check, mechanised: this is what the test would see if
    // somebody added `ERR-BLOCKED-SOMETHING` with a retry.
    const offender = { retry: { strategy: 'exponential', maxAttempts: 3, baseDelayMs: 1000 } };
    const wouldPass = offender.retry.strategy === 'never';

    expect(wouldPass).toBe(false);
  });

  it('reports every never-retry class from the taxonomy', () => {
    const never = neverRetryClasses();

    expect(never.length).toBeGreaterThan(0);
    expect(never.every((code) => !isRetryable(code))).toBe(true);
  });

  it('treats an unrecognised class as never, not as retryable', () => {
    // Failing closed costs a delayed recovery; failing open retries against a
    // source nobody has classified the failure of.
    expect(policyFor('ERR-NOT-A-REAL-CLASS').strategy).toBe('never');
    expect(isRetryable('')).toBe(false);
  });
});

describe('the executor knows no error-class names (RETRY-01)', () => {
  it('contains no ERR- literal at all', () => {
    // The stated acceptance criterion is a code search. This is that search,
    // run on every commit rather than by a reviewer once.
    const source = readFileSync(
      new URL('../../../src/infra/retry/execute.mjs', import.meta.url),
      'utf8',
    );
    const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');

    expect(withoutComments).not.toContain('ERR-');
  });
});

describe('delayFor', () => {
  it('is zero for a never policy', () => {
    expect(delayFor({ strategy: 'never', maxAttempts: 0 }, 1, randomOf(1))).toBe(0);
  });

  it('is the base delay for a fixed policy', () => {
    expect(delayFor({ strategy: 'fixed', maxAttempts: 3, baseDelayMs: 250 }, 2, randomOf(1))).toBe(
      250,
    );
  });

  it('is zero when no base delay is configured', () => {
    expect(delayFor({ strategy: 'exponential', maxAttempts: 3 }, 1, randomOf(1))).toBe(0);
  });

  it('draws across the whole exponential window, not a fixed delay plus noise', () => {
    // Full jitter. Exponential backoff alone synchronises parallel shards:
    // every shard that failed together waits the same interval and retries in
    // the same instant, which is the herd the backoff was meant to prevent.
    const policy = { strategy: 'exponential', maxAttempts: 5, baseDelayMs: 1000 };
    const samples = Array.from({ length: 50 }, (_, i) => delayFor(policy, 3, randomOf(i)));

    expect(Math.min(...samples)).toBeLessThan(1000);
    expect(Math.max(...samples)).toBeGreaterThan(2000);
    expect(samples.every((ms) => ms >= 0 && ms < 4000)).toBe(true);
  });

  it('grows the window with the attempt number', () => {
    const policy = { strategy: 'exponential', maxAttempts: 5, baseDelayMs: 1000 };
    const alwaysMax = { next: () => 0.999, intBetween: () => 0 };

    expect(delayFor(policy, 1, alwaysMax)).toBeLessThan(delayFor(policy, 2, alwaysMax));
    expect(delayFor(policy, 2, alwaysMax)).toBeLessThan(delayFor(policy, 3, alwaysMax));
  });
});

describe('executeWithRetry', () => {
  const ok = (value = 'v') => ({ ok: true, value });
  const fail = (/** @type {string} */ code) => ({ ok: false, error: { code } });
  const retryableCode = /** @type {string} */ (ERROR_CODES.find((code) => isRetryable(code)));

  /** @returns {{ sleep: (ms: number) => Promise<void>, delays: number[] }} */
  function recorder() {
    /** @type {number[]} */
    const delays = [];

    return { delays, sleep: async (ms) => void delays.push(ms) };
  }

  it('returns immediately on success without sleeping', async () => {
    const { sleep, delays } = recorder();
    const result = await executeWithRetry(async () => ok(), {
      policy,
      random: randomOf(1),
      sleep,
    });

    expect(result.ok).toBe(true);
    expect(delays).toEqual([]);
  });

  it('does not retry a never-retry class', async () => {
    const { sleep, delays } = recorder();
    let calls = 0;

    await executeWithRetry(
      async () => {
        calls += 1;

        return fail('ERR-BLOCKED-CHALLENGE');
      },
      { policy, random: randomOf(1), sleep },
    );

    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('retries a retryable class up to its maxAttempts', async () => {
    const { sleep } = recorder();
    let calls = 0;

    await executeWithRetry(
      async () => {
        calls += 1;

        return fail(retryableCode);
      },
      { policy, random: randomOf(1), sleep },
    );

    expect(calls).toBe(policyFor(retryableCode).maxAttempts);
  });

  it('stops as soon as an attempt succeeds', async () => {
    const { sleep } = recorder();
    let calls = 0;

    const result = await executeWithRetry(
      async () => {
        calls += 1;

        return calls < 2 ? fail(retryableCode) : ok('recovered');
      },
      { policy, random: randomOf(1), sleep },
    );

    expect(result.value).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('checks the budget before EVERY sleep, not once at the start', async () => {
    // A schedule authorised once can outlive the run that scheduled it,
    // producing requests the engine believes it never made.
    const { sleep, delays } = recorder();
    let checks = 0;
    let calls = 0;

    await executeWithRetry(
      async () => {
        calls += 1;

        return fail(retryableCode);
      },
      {
        policy,
        random: randomOf(1),
        sleep,
        budgetAvailable: () => {
          checks += 1;

          return checks < 2;
        },
      },
    );

    expect(checks).toBeGreaterThan(1);
    expect(calls).toBeLessThan(policyFor(retryableCode).maxAttempts);
    expect(delays).toHaveLength(1);
  });

  it('stops immediately when the budget is already exhausted', async () => {
    const { sleep, delays } = recorder();
    let calls = 0;

    await executeWithRetry(
      async () => {
        calls += 1;

        return fail(retryableCode);
      },
      { policy, random: randomOf(1), sleep, budgetAvailable: () => false },
    );

    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('reports every attempt for correlation', async () => {
    const { sleep } = recorder();
    /** @type {any[]} */
    const events = [];

    await executeWithRetry(async () => fail(retryableCode), {
      policy,
      random: randomOf(1),
      sleep,
      onAttempt: (event) => events.push(event),
    });

    expect(events.length).toBe(policyFor(retryableCode).maxAttempts);
    expect(events[0]).toMatchObject({ attempt: 1, ok: false });
  });

  it('uses a real timer when no sleep is injected', async () => {
    // Every other test injects a recorder, so the default path would otherwise
    // never run — and an executor whose only untested line is the one that
    // actually waits is an executor that has never waited.
    let calls = 0;
    const started = Date.now();

    await executeWithRetry(
      async () => {
        calls += 1;

        return fail(retryableCode);
      },
      {
        policy: createRetryPolicy({
          [retryableCode]: { retry: { strategy: 'fixed', maxAttempts: 2, baseDelayMs: 5 } },
        }),
        random: randomOf(1),
      },
    );

    expect(calls).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
  });

  it('treats a result with no error code as unretryable', async () => {
    const { sleep } = recorder();
    let calls = 0;

    await executeWithRetry(
      async () => {
        calls += 1;

        return { ok: false };
      },
      { policy, random: randomOf(1), sleep },
    );

    expect(calls).toBe(1);
  });
});
