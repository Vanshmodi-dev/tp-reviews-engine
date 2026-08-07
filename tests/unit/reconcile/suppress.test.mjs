import { describe, expect, it } from 'vitest';

import * as suppressModule from '../../../src/core/reconcile/suppress.mjs';
import {
  applySuppression,
  buildDenylist,
  suppressedAmong,
} from '../../../src/core/reconcile/suppress.mjs';
import { identity } from '../../helpers/reconcile-input.mjs';

describe('applySuppression', () => {
  const denylist = new Set([identity('a')]);

  it('suppresses a denylisted identity', () => {
    expect(applySuppression(identity('a'), 'active', denylist)).toEqual({
      suppressed: true,
      nextState: 'suppressed',
    });
  });

  it('leaves a non-denylisted identity in its prior state', () => {
    expect(applySuppression(identity('b'), 'unconfirmed', denylist)).toEqual({
      suppressed: false,
      nextState: 'unconfirmed',
    });
  });

  it('suppresses unconditionally, including an already-tombstoned record', () => {
    // An erasure obligation is not a lifecycle event and does not queue behind
    // one. "Already removed" is not "erased" - a tombstoned record is still in
    // the ledger and still recoverable.
    expect(applySuppression(identity('a'), 'tombstoned', denylist).nextState).toBe('suppressed');
    expect(applySuppression(identity('a'), 'unconfirmed', denylist).nextState).toBe('suppressed');
  });

  it('returns a frozen outcome', () => {
    expect(Object.isFrozen(applySuppression(identity('a'), 'active', denylist))).toBe(true);
    expect(Object.isFrozen(applySuppression(identity('b'), 'active', denylist))).toBe(true);
  });
});

describe('suppressedAmong', () => {
  it('intersects an identity set with the denylist', () => {
    const denylist = new Set([identity('a'), identity('c')]);

    expect(suppressedAmong([identity('a'), identity('b'), identity('c')], denylist)).toEqual([
      identity('a'),
      identity('c'),
    ]);
  });

  it('is empty for an empty input or an empty denylist', () => {
    expect(suppressedAmong([], new Set([identity('a')]))).toEqual([]);
    expect(suppressedAmong([identity('a')], new Set())).toEqual([]);
  });
});

describe('buildDenylist', () => {
  it('accepts bare hash strings', () => {
    const { denylist, skipped } = buildDenylist([identity('a'), identity('b')]);

    expect([...denylist].sort()).toEqual([identity('a'), identity('b')].sort());
    expect(skipped).toBe(0);
  });

  it('accepts entry objects carrying identity_hash', () => {
    const { denylist } = buildDenylist([
      { identity_hash: identity('a'), reason: 'erasure request', added_at: '2026-01-01' },
    ]);

    expect(denylist.has(identity('a'))).toBe(true);
  });

  it('skips malformed entries rather than throwing', () => {
    // A denylist that fails to load is a denylist that suppresses nothing, and
    // failing open on an erasure obligation is the worst available outcome. One
    // bad row must not discard the good ones.
    const { denylist, skipped } = buildDenylist([
      identity('a'),
      null,
      {},
      { identity_hash: 42 },
      '',
      { identity_hash: identity('b') },
    ]);

    expect([...denylist].sort()).toEqual([identity('a'), identity('b')].sort());
    expect(skipped).toBe(4);
  });

  it('returns an empty denylist for a non-array', () => {
    expect(buildDenylist(undefined).denylist.size).toBe(0);
    expect(buildDenylist('nonsense').denylist.size).toBe(0);
    expect(buildDenylist({ identity_hash: identity('a') }).denylist.size).toBe(0);
  });
});

describe('PT-04 — there is no un-suppress path, and there must never be one', () => {
  it('exports nothing that would reverse a suppression', () => {
    // T-107's stated verification is that a reviewer looks for an un-suppress
    // path and finds none. Mechanised so it stays true after future edits
    // rather than only on the day someone looked.
    const forbidden = ['unsuppress', 'restore', 'clear', 'undo', 'reactivate', 'enable', 'remove'];

    for (const name of Object.keys(suppressModule)) {
      for (const word of forbidden) {
        expect(name.toLowerCase(), `suppress.mjs exports "${name}"`).not.toContain(word);
      }
    }
  });

  it('takes no flag that would re-enable a suppressed id', () => {
    expect(applySuppression.length).toBe(3);
  });

  it('has no branch that returns a non-suppressed outcome for a denylisted id', () => {
    // Exhaustive over every state a record can hold. There is no state, and no
    // combination, that survives the denylist.
    for (const state of ['active', 'unconfirmed', 'tombstoned', 'suppressed']) {
      expect(applySuppression(identity('a'), state, new Set([identity('a')])).suppressed).toBe(
        true,
      );
    }
  });
});
