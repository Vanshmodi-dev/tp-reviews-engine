import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Proof that the property-testing harness works (IMPL PLAN 21.5 criterion 4).
 *
 * Fifteen property laws are load-bearing for INV-03 and INV-04, and they are
 * written as failing tests *before* the D4/D5 modules they govern. That plan
 * only holds if the harness genuinely explores the input space and genuinely
 * shrinks a failure to something a human can read.
 *
 * So this file does not test the engine. It tests the thing the engine's most
 * important tests are built on, once, in week 1 - because a property suite that
 * silently runs three cases and reports an unshrunk 400-element counterexample
 * is worse than no property suite, and looks identical from the outside.
 */

const RUNS = 1000;
const THRESHOLD = 100;

describe('fast-check harness', () => {
  it('runs the configured number of cases', () => {
    let calls = 0;

    const result = fc.check(
      fc.property(fc.integer(), () => {
        calls += 1;
        return true;
      }),
      { numRuns: RUNS },
    );

    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(RUNS);
    expect(calls).toBe(RUNS);
  });

  it('finds a counterexample to a deliberately false property', () => {
    // False for every integer at or above THRESHOLD, true below it. A harness
    // that is not exploring will never reach the boundary.
    const result = fc.check(
      fc.property(fc.integer(), (n) => n < THRESHOLD),
      { numRuns: RUNS },
    );

    expect(result.failed).toBe(true);
    expect(result.counterexample).not.toBeNull();
  });

  it('shrinks that counterexample to the minimal failing input', () => {
    const result = fc.check(
      fc.property(fc.integer(), (n) => n < THRESHOLD),
      { numRuns: RUNS },
    );

    // The smallest integer that fails is exactly THRESHOLD. Anything larger
    // means shrinking stopped early, and every future property failure would
    // arrive as a number nobody can reason about.
    expect(result.counterexample?.[0]).toBe(THRESHOLD);
  });

  it('shrinks a failing array to the shortest one that still fails', () => {
    const result = fc.check(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 })), (xs) => xs.length < 3),
      { numRuns: RUNS },
    );

    expect(result.failed).toBe(true);
    // Three elements is the shortest failure. The values are free; the length
    // is the property, and the length is what must shrink.
    expect(result.counterexample?.[0]).toHaveLength(3);
  });

  it('reports a seed that reproduces the failure exactly', () => {
    const first = fc.check(
      fc.property(fc.integer(), (n) => n < THRESHOLD),
      { numRuns: RUNS },
    );

    // exactOptionalPropertyTypes forbids passing an explicit undefined for an
    // optional property, so the replay path is included only when there is one.
    const params =
      first.counterexamplePath === null
        ? { numRuns: RUNS, seed: first.seed }
        : { numRuns: RUNS, seed: first.seed, path: first.counterexamplePath };

    const replay = fc.check(
      fc.property(fc.integer(), (n) => n < THRESHOLD),
      params,
    );

    // A property failure in CI is only actionable if the seed printed in the
    // log reproduces it on a developer machine.
    expect(replay.counterexample?.[0]).toBe(first.counterexample?.[0]);
  });
});
