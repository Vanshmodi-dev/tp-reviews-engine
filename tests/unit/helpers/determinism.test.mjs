import { describe, expect, it } from 'vitest';

import { createFixedClock } from '../../helpers/fixed-clock.mjs';
import { createSeededRandom } from '../../helpers/seeded-random.mjs';

/**
 * The determinism helpers are used by every test in the repository, so a defect
 * here is invisible and everywhere at once. They get their own tests (IMPL PLAN
 * 21.3, TR-TEST-032).
 */

const SECOND_MS = 1000;
const SAMPLE = 200;

describe('fixed clock', () => {
  it('does not advance on its own', () => {
    const clock = createFixedClock('2026-03-04T05:06:07.000Z');
    const first = clock.nowMs();

    for (let i = 0; i < SAMPLE; i += 1) clock.now();

    expect(clock.nowMs()).toBe(first);
  });

  it('reports the instant it was given, in every form', () => {
    const clock = createFixedClock('2026-03-04T05:06:07.000Z');

    expect(clock.nowIso()).toBe('2026-03-04T05:06:07.000Z');
    expect(clock.now().getTime()).toBe(clock.nowMs());
  });

  it('advances only when told', () => {
    const clock = createFixedClock(0);
    clock.advance(SECOND_MS);

    expect(clock.nowMs()).toBe(SECOND_MS);
  });

  it('refuses to move backwards', () => {
    // Time standing still is realistic. Time reversing is a test passing for a
    // reason its author did not intend.
    const clock = createFixedClock(0);

    expect(() => clock.advance(-1)).toThrow(RangeError);
  });

  it('rejects an unparseable instant', () => {
    expect(() => createFixedClock('not a date')).toThrow(TypeError);
  });

  it('produces an identical sequence for two clocks with the same seed instant', () => {
    const a = createFixedClock('2026-01-01T00:00:00.000Z');
    const b = createFixedClock('2026-01-01T00:00:00.000Z');

    a.advance(SECOND_MS);
    b.advance(SECOND_MS);

    expect(a.nowIso()).toBe(b.nowIso());
  });
});

describe('seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);

    const left = Array.from({ length: SAMPLE }, () => a.next());
    const right = Array.from({ length: SAMPLE }, () => b.next());

    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: SAMPLE }, createSeededRandom(1).next);
    const b = Array.from({ length: SAMPLE }, createSeededRandom(2).next);

    expect(a).not.toEqual(b);
  });

  it('returns to the start on reset', () => {
    const rng = createSeededRandom(7);
    const first = Array.from({ length: SAMPLE }, () => rng.next());
    rng.reset();
    const again = Array.from({ length: SAMPLE }, () => rng.next());

    expect(again).toEqual(first);
  });

  it('stays within [0, 1)', () => {
    const rng = createSeededRandom(99);

    for (let i = 0; i < SAMPLE; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces integers inside an inclusive range', () => {
    const rng = createSeededRandom(123);
    const seen = new Set();

    for (let i = 0; i < SAMPLE; i += 1) seen.add(rng.int(1, 5));

    expect(Math.min(...seen)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(5);
  });

  it('rejects an inverted range', () => {
    expect(() => createSeededRandom().int(5, 1)).toThrow(RangeError);
  });

  it('shuffles reproducibly without mutating the input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

    const a = createSeededRandom(5).shuffle(input);
    const b = createSeededRandom(5).shuffle(input);

    expect(a).toEqual(b);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...a].sort((x, y) => x - y)).toEqual([...input]);
  });
});
