import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  STRATEGY_KINDS,
  checkPack,
  compareVersions,
  loadPack,
} from '../../../src/core/selectors/loader.mjs';
import {
  degradedFields,
  mustQuarantine,
  resolveAll,
  resolveField,
  strategyHealth,
} from '../../../src/core/selectors/resolver.mjs';

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const pack = (overrides = {}) => ({
  meta: {
    source: 'google',
    version: 'v1',
    min_engine_version: '1.0.0',
    authored_at: '2026-03-01',
  },
  fields: {
    rating: {
      required: true,
      strategies: [
        { kind: 'role', selector: "[role='img']", notes: 'The accessible star widget.' },
        { kind: 'css', selector: '.rating', notes: 'Last-resort visual fallback.' },
      ],
    },
  },
  ...overrides,
});

describe('T-187/T-188 — a malformed pack fails at load, loudly', () => {
  it('accepts a well-formed pack', () => {
    expect(checkPack(pack())).toEqual([]);
    expect(loadPack(JSON.stringify(pack())).ok).toBe(true);
  });

  it('reports invalid JSON as ERR-PARSE-SELECTOR-PACK', () => {
    const result = loadPack('{ not json');

    expect(result.ok).toBe(false);
    expect(/** @type {any} */ (result).error.code).toBe('ERR-PARSE-SELECTOR-PACK');
  });

  it('reports every problem, not the first', () => {
    // A pack author fixing one rejection per load spends an afternoon on what
    // one message could have said.
    const broken = pack({
      fields: {
        a: { required: true, strategies: [{ kind: 'css', selector: '.a', notes: 'short' }] },
        b: { required: true, strategies: [] },
      },
    });

    expect(checkPack(broken).length).toBeGreaterThan(2);
  });

  it('rejects a pack that is not an object', () => {
    expect(checkPack(null)).toEqual(['pack is not an object']);
    expect(checkPack({ meta: {} })).toContain('fields is missing');
  });
});

describe('TR-SEL-010 — two strategies of DIFFERENT kinds', () => {
  it('rejects a single-strategy required field', () => {
    const single = pack({
      fields: {
        rating: {
          required: true,
          strategies: [{ kind: 'role', selector: 'x', notes: 'Only strategy here.' }],
        },
      },
    });

    expect(checkPack(single).join(' ')).toContain('TR-SEL-010');
  });

  it('rejects TWO strategies of the SAME kind', () => {
    // Two css strategies are one strategy with a spare: the redesign that
    // breaks the first breaks the second. This is the check JSON Schema cannot
    // express, which is why it lives in the loader.
    const sameKind = pack({
      fields: {
        rating: {
          required: true,
          strategies: [
            { kind: 'css', selector: '.a', notes: 'First visual selector.' },
            { kind: 'css', selector: '.b', notes: 'Second visual selector.' },
          ],
        },
      },
    });

    expect(checkPack(sameKind).join(' ')).toContain('DIFFERENT kinds');
  });

  it('accepts a single-strategy OPTIONAL field', () => {
    // The rule protects required fields. An optional field that does not
    // resolve yields a null the capability declaration already explains.
    const optional = pack({
      fields: {
        text: {
          required: false,
          strategies: [{ kind: 'css', selector: '.t', notes: 'The review body element.' }],
        },
      },
    });

    expect(checkPack(optional)).toEqual([]);
  });
});

describe('TR-SEL-011 — css may never stand alone for a required field', () => {
  it('names the rule when css is the only kind', () => {
    const cssOnly = pack({
      fields: {
        rating: {
          required: true,
          strategies: [
            { kind: 'css', selector: '.a', notes: 'A visual selector here.' },
            { kind: 'css', selector: '.b', notes: 'Another visual selector.' },
          ],
        },
      },
    });

    expect(checkPack(cssOnly).join(' ')).toContain('TR-SEL-011');
  });

  it('accepts css as a fallback beneath a stabler kind', () => {
    expect(checkPack(pack())).toEqual([]);
  });
});

describe('TR-SEL-012 — strategies are ordered most stable first', () => {
  it('rejects a strategy appended out of rank', () => {
    // Appending for convenience means the pack tries the least reliable option
    // first and records a healthy-looking strategy-0 hit rate while actually
    // depending on css.
    const misordered = pack({
      fields: {
        rating: {
          required: true,
          strategies: [
            { kind: 'css', selector: '.a', notes: 'Visual selector, listed first.' },
            { kind: 'role', selector: 'x', notes: 'Accessibility role, listed second.' },
          ],
        },
      },
    });

    expect(checkPack(misordered).join(' ')).toContain('most stable first');
  });

  it('ranks the kinds in the documented order', () => {
    expect(STRATEGY_KINDS).toEqual([
      'role',
      'aria-label-pattern',
      'data-attribute',
      'structural-relative',
      'text-pattern',
      'css',
    ]);
  });
});

describe('TR-SEL-013 — every strategy explains itself', () => {
  it('rejects a strategy with no usable notes', () => {
    // Six months later nobody remembers why strategy 2 exists, and a pack of
    // undocumented selectors cannot be safely edited by anyone who did not
    // write it — which, on a six-month-old pack, is everybody.
    const undocumented = pack({
      fields: {
        rating: {
          required: true,
          strategies: [
            { kind: 'role', selector: 'x', notes: 'ok' },
            { kind: 'css', selector: '.a', notes: 'Documented properly here.' },
          ],
        },
      },
    });

    expect(checkPack(undocumented).join(' ')).toContain('TR-SEL-013');
  });

  it('rejects an unknown strategy kind', () => {
    const unknown = pack({
      fields: {
        rating: {
          required: true,
          strategies: [
            { kind: 'xpath', selector: '//x', notes: 'Not a documented kind.' },
            { kind: 'css', selector: '.a', notes: 'Documented properly here.' },
          ],
        },
      },
    });

    expect(checkPack(unknown).join(' ')).toContain('unknown kind');
  });
});

describe('TR-SEL-031 — a pack requiring a newer engine is refused', () => {
  it('refuses rather than trying and failing mid-harvest', () => {
    const future = pack({ meta: { ...pack().meta, min_engine_version: '2.0.0' } });

    expect(checkPack(future, { engineVersion: '1.0.0' }).join(' ')).toContain('requires engine');
  });

  it('accepts a pack the engine can run', () => {
    expect(checkPack(pack(), { engineVersion: '1.0.0' })).toEqual([]);
    expect(checkPack(pack(), { engineVersion: '1.5.0' })).toEqual([]);
  });

  it('compares versions numerically, not lexically', () => {
    // '1.10.0' > '1.9.0' is false as strings and true as versions.
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });
});

describe('T-189 — ordered resolution records which strategy won', () => {
  const spec = {
    required: true,
    strategies: [
      { kind: 'role', selector: 'a', notes: 'Primary strategy here.' },
      { kind: 'css', selector: 'b', notes: 'Fallback strategy here.' },
    ],
  };

  it('uses the first strategy that resolves', () => {
    const result = resolveField('rating', spec, (strategy) => (strategy.selector === 'a' ? 5 : 4));

    expect(result).toMatchObject({ ok: true, value: 5, strategyIndex: 0, kind: 'role' });
  });

  it('falls back and records index 1', () => {
    // The early-warning signal. Extraction still works and the payload is still
    // correct, but the margin is gone.
    const result = resolveField('rating', spec, (strategy) =>
      strategy.selector === 'a' ? null : 4,
    );

    expect(result).toMatchObject({ ok: true, value: 4, strategyIndex: 1, kind: 'css' });
    expect(result.attempted).toEqual(['role', 'css']);
  });

  it('keeps trying when a strategy THROWS', () => {
    // A malformed selector in strategy 0 must not stop strategy 1 being tried
    // — that is the entire point of having one.
    const result = resolveField('rating', spec, (strategy) => {
      if (strategy.selector === 'a') throw new Error('invalid selector');

      return 4;
    });

    expect(result.strategyIndex).toBe(1);
  });

  it('treats an empty string as a non-resolution', () => {
    const result = resolveField('rating', spec, (strategy) => (strategy.selector === 'a' ? '' : 4));

    expect(result.strategyIndex).toBe(1);
  });

  it('reports -1 when nothing resolves', () => {
    const result = resolveField('rating', spec, () => null);

    expect(result).toMatchObject({ ok: false, strategyIndex: -1, kind: null });
  });
});

describe('T-191 — all strategies failing is a quarantine, never a silent null', () => {
  it('quarantines when a REQUIRED field cannot be resolved', () => {
    // Publishing a null would put a review on a client's site with no rating,
    // and the payload would still be schema-valid — so nothing downstream would
    // object.
    const result = resolveAll(pack(), () => null);

    expect(result.missing).toEqual(['rating']);
    expect(mustQuarantine(result)).toBe(true);
  });

  it('does NOT quarantine when only an optional field is missing', () => {
    const withOptional = pack({
      fields: {
        ...pack().fields,
        text: {
          required: false,
          strategies: [{ kind: 'css', selector: '.t', notes: 'The review body element.' }],
        },
      },
    });

    const result = resolveAll(withOptional, (field) => (field === 'rating' ? 5 : null));

    expect(result.missing).toEqual([]);
    expect(mustQuarantine(result)).toBe(false);
    expect(Object.hasOwn(result.values, 'text')).toBe(false);
  });
});

describe('T-190 — strategy health is a histogram, not an average', () => {
  const resolutions = [
    { field: 'rating', ok: true, strategyIndex: 0, kind: 'role', value: 5, attempted: [] },
    { field: 'rating', ok: true, strategyIndex: 0, kind: 'role', value: 4, attempted: [] },
    { field: 'rating', ok: true, strategyIndex: 1, kind: 'css', value: 3, attempted: [] },
    { field: 'rating', ok: false, strategyIndex: -1, kind: null, value: null, attempted: [] },
  ];

  it('counts hits per strategy index and failures separately', () => {
    // An average of 0.25 would hide that one resolution in four is already on
    // the fallback and another has failed outright.
    expect(strategyHealth(resolutions)).toEqual({
      rating: { counts: { 0: 2, 1: 1 }, failures: 1 },
    });
  });

  it('flags a field that is no longer winning on its primary strategy', () => {
    const degraded = degradedFields(strategyHealth(resolutions));

    expect(degraded).toEqual([{ field: 'rating', primaryRate: 0.5 }]);
  });

  it('does not flag a healthy field', () => {
    const healthy = strategyHealth([
      { field: 'rating', ok: true, strategyIndex: 0, kind: 'role', value: 5, attempted: [] },
    ]);

    expect(degradedFields(healthy)).toEqual([]);
  });

  it('ignores a field with no resolutions at all', () => {
    expect(degradedFields({ rating: { counts: {}, failures: 0 } })).toEqual([]);
  });
});

describe('T-192 — the shipped google-maps pack', () => {
  const shipped = JSON.parse(
    readFileSync(new URL('../../../selectors/google-maps/v1.json', import.meta.url), 'utf8'),
  );

  it('validates against every rule', () => {
    expect(checkPack(shipped, { engineVersion: '1.0.0' })).toEqual([]);
  });

  it('gives every required field at least two kinds', () => {
    for (const [name, field] of Object.entries(shipped.fields)) {
      if (/** @type {any} */ (field).required !== true) continue;

      const kinds = new Set(
        /** @type {any} */ (field).strategies.map((/** @type {any} */ s) => s.kind),
      );

      expect(kinds.size, name).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every strategy notes a human can act on', () => {
    for (const [name, field] of Object.entries(shipped.fields)) {
      for (const strategy of /** @type {any} */ (field).strategies) {
        expect(strategy.notes.length, `${name}/${strategy.kind}`).toBeGreaterThan(40);
      }
    }
  });

  it('declares the detectors the pipeline depends on', () => {
    // `challenge` drives INV-07's terminal path; `empty_state` is what
    // distinguishes a listing with no reviews from a page that failed to
    // render them (CH-06).
    expect(Object.keys(shipped.detectors)).toEqual(
      expect.arrayContaining(['challenge', 'empty_state']),
    );
  });
});
