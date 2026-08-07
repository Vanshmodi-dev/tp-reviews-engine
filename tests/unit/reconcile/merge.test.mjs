import { describe, expect, it } from 'vitest';

import { OUTCOMES } from '../../../src/core/model/ledger.mjs';
import { markNormalised } from '../../../src/core/model/review.mjs';
import { reconcile } from '../../../src/core/reconcile/index.mjs';
import {
  T0,
  T1,
  harvest,
  identity,
  ledgerWith,
  recordOf,
  review,
} from '../../helpers/reconcile-input.mjs';

/**
 * T-109 — the composition.
 *
 * The parts are tested in isolation elsewhere; this is about them being wired
 * together in the right order and reporting honestly about it.
 */

describe('the merge composes the passes in the required order', () => {
  it('inserts, updates, touches and holds in a single run', () => {
    const prior = ledgerWith([review('a'), review('b'), review('c')], T0);
    const out = reconcile(
      harvest({
        prior,
        observed: [
          review('a'),
          review('b', { content_hash: 'edited'.padEnd(64, '0') }),
          review('d'),
        ],
        stopReason: 'stalled',
        now: T1,
      }),
    );

    expect(out.decisions.unchanged).toBe(1);
    expect(out.decisions.updated).toBe(1);
    expect(out.decisions.inserted).toBe(1);
    expect(out.decisions.held).toBe(1);
    expect(out.ledger.records.size).toBe(4);
  });

  it('applies suppression after everything else, so it wins', () => {
    // A record inserted by this very harvest is still suppressed by the sweep.
    const out = reconcile(
      harvest({
        prior: ledgerWith([review('b')], T0),
        observed: [review('b')],
        now: T1,
        denylist: new Set([identity('b')]),
      }),
    );

    expect(recordOf(out.ledger, identity('b')).state).toBe('suppressed');
  });

  it('collapses intra-run duplicates before deciding anything', () => {
    // Two entries, one identity: exactly one decision, not two.
    const out = reconcile(
      harvest({
        prior: ledgerWith([], T0),
        observed: [review('a'), review('a', { content_hash: 'other'.padEnd(64, '0') })],
        now: T1,
      }),
    );

    expect(out.decisions.inserted).toBe(1);
    expect(out.collisions).toBe(1);
    expect(out.ledger.records.size).toBe(1);
  });

  it('records the harvest last, so freshness reflects the whole run', () => {
    const out = reconcile(harvest({ prior: ledgerWith([], T0), observed: [review('a')], now: T1 }));

    expect(out.ledger.last_full_harvest_at).toBe(T1);
    expect(out.ledger.updated_at).toBe(T1);
  });
});

describe('the decision log', () => {
  it('has one entry per identity considered', () => {
    const prior = ledgerWith([review('a'), review('b')], T0);
    const out = reconcile(harvest({ prior, observed: [review('a'), review('c')], now: T1 }));

    expect(out.decisions.decisions).toHaveLength(3);
    expect(new Set(out.decisions.decisions.map((entry) => entry.identity_hash)).size).toBe(3);
  });

  it('counts add up to the number of decisions', () => {
    const prior = ledgerWith([review('a'), review('b'), review('c')], T0);
    const out = reconcile(harvest({ prior, observed: [review('a'), review('d')], now: T1 }));
    const { decisions: entries, ...counts } = out.decisions;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    expect(total).toBe(entries.length);
  });

  it('is frozen, so a caller cannot rewrite the record of what happened', () => {
    const out = reconcile(harvest({ prior: ledgerWith([], T0), observed: [], now: T1 }));

    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.decisions)).toBe(true);
    expect(Object.isFrozen(out.decisions.decisions)).toBe(true);
  });

  it('reports a tombstone at the third consecutive qualifying absence', () => {
    let ledger = ledgerWith([review('a')], T0);

    for (let step = 1; step <= 2; step += 1) {
      const out = reconcile(
        harvest({ prior: ledger, observed: [], now: `2026-03-0${step}T00:00:00.000Z` }),
      );
      ledger = out.ledger;
      expect(out.decisions.missing).toBe(1);
      expect(out.decisions.tombstoned).toBe(0);
    }

    const third = reconcile(
      harvest({ prior: ledger, observed: [], now: '2026-03-03T00:00:00.000Z' }),
    );

    expect(third.decisions.tombstoned).toBe(1);
    expect(recordOf(third.ledger, identity('a')).state).toBe('tombstoned');
  });

  it('resets the streak when a review reappears (TR-REC-013)', () => {
    const prior = ledgerWith([review('a')], T0);
    const missed = reconcile(harvest({ prior, observed: [], now: '2026-03-01T00:00:00.000Z' }));

    expect(recordOf(missed.ledger, identity('a')).missing_streak).toBe(1);

    const back = reconcile(
      harvest({ prior: missed.ledger, observed: [review('a')], now: '2026-03-02T00:00:00.000Z' }),
    );

    expect(recordOf(back.ledger, identity('a')).missing_streak).toBe(0);
    expect(recordOf(back.ledger, identity('a')).state).toBe('active');
  });
});

describe('near-duplicates are reported alongside the merge, never merged', () => {
  const longText = 'The staff were lovely and the service was quick and I will return soon.';

  it('reports a same-author pair without collapsing either record', () => {
    const out = reconcile(
      harvest({
        prior: ledgerWith([], T0),
        observed: [
          review('a', { author_key: 'k1', text: markNormalised(longText) }),
          review('b', { author_key: 'k1', text: markNormalised(`${longText} Thanks!`) }),
        ],
        now: T1,
      }),
    );

    expect(out.nearDuplicates).toHaveLength(1);
    expect(out.ledger.records.size).toBe(2);
    expect(out.decisions.inserted).toBe(2);
  });

  it('honours a configured threshold', () => {
    const observed = [
      review('a', { author_key: 'k1', text: markNormalised('The coffee here is good.') }),
      review('b', { author_key: 'k1', text: markNormalised('The coffee here is great.') }),
    ];

    const strict = reconcile(
      harvest({ prior: ledgerWith([], T0), observed, now: T1, nearDuplicateThreshold: 0.99 }),
    );
    const loose = reconcile(
      harvest({ prior: ledgerWith([], T0), observed, now: T1, nearDuplicateThreshold: 0.5 }),
    );

    expect(strict.nearDuplicates).toHaveLength(0);
    expect(loose.nearDuplicates).toHaveLength(1);
  });
});

describe('purity and edge cases', () => {
  it('takes `now` as an explicit parameter with no default (LEDG-03)', () => {
    // A Date.now() default here would void five property laws without failing a
    // single existing test.
    expect(String(reconcile)).not.toContain('Date.now');
    expect(String(reconcile)).not.toContain('new Date(');
  });

  it('does not mutate the prior ledger', () => {
    const prior = ledgerWith([review('a'), review('b')], T0);
    const before = JSON.stringify([...prior.records]);

    reconcile(harvest({ prior, observed: [review('a')], now: T1 }));

    expect(JSON.stringify([...prior.records])).toBe(before);
  });

  it('handles an empty ledger and an empty harvest', () => {
    const out = reconcile(harvest({ prior: ledgerWith([], T0), observed: [], now: T1 }));

    expect(out.ledger.records.size).toBe(0);
    expect(out.decisions.decisions).toEqual([]);
    expect(out.invariantViolations).toEqual([]);
  });

  it('holds every record when the harvest observed nothing and stalled', () => {
    const prior = ledgerWith([review('a'), review('b')], T0);
    const out = reconcile(harvest({ prior, observed: [], stopReason: 'stalled', now: T1 }));

    expect(out.decisions.held).toBe(2);
    expect(JSON.stringify([...out.ledger.records])).toBe(JSON.stringify([...prior.records]));
  });

  it('treats an unrecognised stop reason as failed, not full', () => {
    // Failing closed costs a delayed removal; failing open deletes reviews.
    const prior = ledgerWith([review('a')], T0);
    const out = reconcile(
      harvest({ prior, observed: [], stopReason: 'something_nobody_mapped', now: T1 }),
    );

    expect(out.decisions.held).toBe(1);
    expect(out.decisions.missing).toBe(0);
  });

  it('reports no invariant violations for a sound merge', () => {
    const prior = ledgerWith([review('a')], T0);
    const out = reconcile(harvest({ prior, observed: [review('b')], now: T1 }));

    expect(out.invariantViolations).toEqual([]);
  });

  it('ignores an observation of a tombstoned identity and says so', () => {
    let ledger = ledgerWith([review('a')], T0);

    for (let step = 1; step <= 3; step += 1) {
      ledger = reconcile(
        harvest({ prior: ledger, observed: [], now: `2026-03-0${step}T00:00:00.000Z` }),
      ).ledger;
    }

    const back = reconcile(
      harvest({ prior: ledger, observed: [review('a')], now: '2026-03-04T00:00:00.000Z' }),
    );

    expect(back.decisions.ignored_terminal).toBe(1);
    expect(recordOf(back.ledger, identity('a')).state).toBe('tombstoned');
    expect(back.decisions.decisions).toContainEqual({
      identity_hash: identity('a'),
      outcome: OUTCOMES.IGNORED_TERMINAL,
    });
  });
});
