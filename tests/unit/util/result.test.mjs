import { describe, expect, it } from 'vitest';

import {
  all,
  andThen,
  err,
  fromNullable,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  orElse,
  partition,
  unwrapOr,
  unwrapOrElse,
} from '../../../src/core/util/result.mjs';

/**
 * Every combinator is unit-tested (T-047 acceptance). The contract that matters
 * most is negative: `core/` never throws, so no combinator here may throw on an
 * error Result. That is asserted explicitly rather than assumed.
 */

describe('construction', () => {
  it('wraps a success', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('wraps a failure', () => {
    expect(err('ERR-PARSE-STRUCTURE')).toEqual({ ok: false, error: 'ERR-PARSE-STRUCTURE' });
  });

  it('preserves falsy success values rather than treating them as absent', () => {
    // A rating of 0, an empty review body, and `false` are all real values.
    // Conflating them with failure is how a legitimate record gets quarantined.
    expect(isOk(ok(0))).toBe(true);
    expect(isOk(ok(''))).toBe(true);
    expect(isOk(ok(false))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
  });

  it('freezes both variants', () => {
    expect(Object.isFrozen(ok(1))).toBe(true);
    expect(Object.isFrozen(err('e'))).toBe(true);
  });
});

describe('discrimination', () => {
  it('narrows in both directions', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err('e'))).toBe(false);
    expect(isErr(err('e'))).toBe(true);
  });
});

describe('map', () => {
  it('transforms a success', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it('leaves a failure untouched and does not call the function', () => {
    let called = false;
    const result = map(err('E'), () => {
      called = true;
      return 1;
    });

    expect(result).toEqual({ ok: false, error: 'E' });
    expect(called).toBe(false);
  });
});

describe('mapErr', () => {
  it('transforms a failure', () => {
    expect(mapErr(err('E'), (e) => `${e}:context`)).toEqual({ ok: false, error: 'E:context' });
  });

  it('leaves a success untouched and does not call the function', () => {
    let called = false;
    const result = mapErr(ok(1), () => {
      called = true;
      return 'X';
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(called).toBe(false);
  });
});

describe('andThen', () => {
  it('chains a fallible step', () => {
    expect(andThen(ok(2), (n) => ok(n + 1))).toEqual({ ok: true, value: 3 });
  });

  it('propagates the failure of the chained step', () => {
    expect(andThen(ok(2), () => err('E2'))).toEqual({ ok: false, error: 'E2' });
  });

  it('short-circuits at the first failure', () => {
    let called = false;
    const result = andThen(err('E1'), () => {
      called = true;
      return ok(1);
    });

    expect(result).toEqual({ ok: false, error: 'E1' });
    expect(called).toBe(false);
  });
});

describe('orElse', () => {
  it('recovers from a failure', () => {
    expect(orElse(err('E'), () => ok('recovered'))).toEqual({ ok: true, value: 'recovered' });
  });

  it('leaves a success untouched and does not call the function', () => {
    let called = false;
    const result = orElse(ok(1), () => {
      called = true;
      return ok(2);
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(called).toBe(false);
  });
});

describe('unwrapOr / unwrapOrElse', () => {
  it('returns the value on success', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOrElse(ok(1), () => 99)).toBe(1);
  });

  it('returns the fallback on failure', () => {
    expect(unwrapOr(err('E'), 99)).toBe(99);
    expect(unwrapOrElse(err('E'), (e) => e.length)).toBe(1);
  });

  it('does not evaluate the fallback function on success', () => {
    let called = false;
    unwrapOrElse(ok(1), () => {
      called = true;
      return 0;
    });

    expect(called).toBe(false);
  });
});

describe('match', () => {
  it('selects the ok branch', () => {
    expect(match(ok(2), { ok: (n) => `v${n}`, err: (e) => `e${e}` })).toBe('v2');
  });

  it('selects the err branch', () => {
    expect(match(err('E'), { ok: (n) => `v${n}`, err: (e) => `e${e}` })).toBe('eE');
  });
});

describe('all', () => {
  it('collects successes in order', () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('returns ok with an empty array for no inputs', () => {
    expect(all([])).toEqual({ ok: true, value: [] });
  });

  it('returns the EARLIEST failure, not an arbitrary one', () => {
    // Determinism: two runs over the same input must report the same error, or
    // a defect becomes irreproducible from its report.
    expect(all([ok(1), err('FIRST'), err('SECOND')])).toEqual({ ok: false, error: 'FIRST' });
  });
});

describe('partition', () => {
  it('separates successes from failures, preserving order in both', () => {
    const result = partition([ok(1), err('A'), ok(2), err('B'), ok(3)]);

    expect(result.values).toEqual([1, 2, 3]);
    expect(result.errors).toEqual(['A', 'B']);
  });

  it('handles all-success and all-failure inputs', () => {
    expect(partition([ok(1)])).toEqual({ values: [1], errors: [] });
    expect(partition([err('A')])).toEqual({ values: [], errors: ['A'] });
    expect(partition([])).toEqual({ values: [], errors: [] });
  });
});

describe('fromNullable', () => {
  it('fails on null and undefined', () => {
    expect(fromNullable(null, 'E')).toEqual({ ok: false, error: 'E' });
    expect(fromNullable(undefined, 'E')).toEqual({ ok: false, error: 'E' });
  });

  it('succeeds on every other value, including falsy ones', () => {
    // The distinction between "absent" and "empty" is load-bearing in the
    // payload: an absent field and a null field mean different things.
    expect(fromNullable(0, 'E')).toEqual({ ok: true, value: 0 });
    expect(fromNullable('', 'E')).toEqual({ ok: true, value: '' });
    expect(fromNullable(false, 'E')).toEqual({ ok: true, value: false });
  });
});

/** @type {<T>(v: T) => T} */
const identity = (v) => v;
const fallback = () => 'fallback';
const one = () => 1;
const two = () => 2;

describe('ERR-03: nothing here throws', () => {
  it('survives every combinator applied to a failure', () => {
    const e = err('ERR-INTERNAL-INVARIANT');
    const constantError = () => e;

    // The callbacks are hoisted out of the assertion rather than inlined: four
    // levels of nested arrow function breaches max-nested-callbacks, and the
    // limit is right - this reads better flat.
    const applyEveryCombinator = () => {
      map(e, identity);
      mapErr(e, identity);
      andThen(e, ok);
      orElse(e, constantError);
      unwrapOr(e, 'fallback');
      unwrapOrElse(e, fallback);
      match(e, { ok: one, err: two });
      all([e]);
      partition([e]);
      isOk(e);
      isErr(e);
    };

    expect(applyEveryCombinator).not.toThrow();
  });

  it('exposes no unwrap that throws', async () => {
    const mod = await import('../../../src/core/util/result.mjs');

    // A throwing unwrap() would be reintroduced at every call site that finds
    // unwrapping tedious - which is the exact failure EDR-002 exists to stop.
    expect(Object.keys(mod)).not.toContain('unwrap');
    expect(Object.keys(mod)).not.toContain('expect');
  });
});
