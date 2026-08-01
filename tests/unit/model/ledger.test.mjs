import { describe, expect, it } from 'vitest';

import {
  LEDGER_VERSION,
  OUTCOMES,
  checkLedgerInvariants,
  createLedger,
  fromJSON,
  insertReview,
  isTerminal,
  markMissing,
  publishableRecords,
  recordHarvest,
  suppressReview,
  toJSON,
  touchReview,
  updateReview,
} from '../../../src/core/model/ledger.mjs';
import { markNormalised } from '../../../src/core/model/review.mjs';

/**
 * The ledger is the only durable copy. Nothing regenerates it.
 *
 * The tests that matter most here are the ones asserting what does NOT happen:
 * a tombstone never resurrects, a pinned date never moves, `first_seen_at`
 * never changes, and a partial harvest changes nothing at all.
 */

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';
const T3 = '2026-04-01T00:00:00.000Z';

/**
 * @param {object} [overrides]
 * @returns {import('../../../src/core/model/review.mjs').NormalizedReview}
 */
function review(overrides = {}) {
  return {
    identity_hash: 'a'.repeat(32),
    content_hash: 'c1',
    author_key: 'ak1',
    author: {
      name: markNormalised('Dana'),
      initials: 'D',
      avatar_url: null,
      profile_url: null,
      is_local_guide: null,
      review_count_hint: null,
    },
    rating: 5,
    text: markNormalised('Great service'),
    text_truncated: false,
    text_clipped: false,
    date_estimated: '2025-11-01T00:00:00.000Z',
    date_precision: 'month',
    date_confidence: 'medium',
    relative_date: '2 months ago',
    language: 'en',
    language_confidence: 0.9,
    likes: null,
    photo_count: null,
    owner_reply: null,
    source: 'google',
    source_url: null,
    verified: null,
    ...overrides,
  };
}

/** @returns {import('../../../src/core/model/ledger.mjs').Ledger} */
function emptyLedger() {
  return createLedger({ clientSlug: 'commerce-insight', listingKey: 'main', now: T0 });
}

/**
 * Fetches a record, failing the test if it is absent.
 *
 * @param {import('../../../src/core/model/ledger.mjs').Ledger} ledger
 * @param {string} id
 * @returns {import('../../../src/core/model/review.mjs').LedgerReview}
 */
function requireRecord(ledger, id) {
  const record = ledger.records.get(id);
  if (record === undefined) throw new Error(`expected a record for ${id}`);
  return record;
}

/** @returns {import('../../../src/core/model/ledger.mjs').Ledger} */
function ledgerWithOne() {
  return insertReview(emptyLedger(), review(), T0).ledger;
}

describe('shape', () => {
  it('is map-backed, not array-backed (TR-REC-031, IR-24)', () => {
    // An array forces a nested scan per observed review, which is O(n squared)
    // allocation at the thousand-review listings this is built for.
    expect(emptyLedger().records).toBeInstanceOf(Map);
  });

  it('carries the versions that govern migration', () => {
    const ledger = emptyLedger();

    expect(ledger.ledger_version).toBe(LEDGER_VERSION);
    expect(ledger.identity_algo_version).toBe(1);
  });

  it('carries the immutable primary key (TR-GIT-003)', () => {
    const ledger = emptyLedger();

    expect(ledger.client_slug).toBe('commerce-insight');
    expect(ledger.listing_key).toBe('main');
  });

  it('starts with no full harvest recorded', () => {
    expect(emptyLedger().last_full_harvest_at).toBeNull();
  });
});

describe('INSERT', () => {
  it('sets first_seen_at, starts revision at 1, and leaves history empty', () => {
    const { ledger, outcome } = insertReview(emptyLedger(), review(), T0);
    const record = ledger.records.get('a'.repeat(32));

    expect(outcome).toBe(OUTCOMES.INSERTED);
    expect(record?.first_seen_at).toBe(T0);
    expect(record?.revision).toBe(1);
    expect(record?.content_hash_history).toEqual([]);
    expect(record?.state).toBe('active');
    expect(record?.missing_streak).toBe(0);
  });

  it('does not mutate the input ledger (TR-REC-022)', () => {
    // A reconciler that crashes halfway must leave its input intact for the
    // retry. This is what makes PT-01 idempotence achievable.
    const before = emptyLedger();
    insertReview(before, review(), T0);

    expect(before.records.size).toBe(0);
  });
});

describe('UPDATE', () => {
  it('preserves first_seen_at (TR-REC-020, PT-05)', () => {
    const one = ledgerWithOne();
    const { ledger } = updateReview(one, review({ content_hash: 'c2' }), T1);

    expect(ledger.records.get('a'.repeat(32))?.first_seen_at).toBe(T0);
  });

  it('preserves the pinned date even when the incoming review carries a different one', () => {
    // TR-REC-021 / PT-06. This is the natural mistake: the incoming review has
    // a plausible date_estimated, and using it walks the date forward on every
    // harvest as "2 months ago" becomes "3 months ago".
    const one = ledgerWithOne();
    const { ledger } = updateReview(
      one,
      review({ content_hash: 'c2', date_estimated: '2025-12-25T00:00:00.000Z' }),
      T1,
    );

    expect(ledger.records.get('a'.repeat(32))?.review.date_estimated).toBe(
      '2025-11-01T00:00:00.000Z',
    );
  });

  it('advances the revision and appends the prior content hash', () => {
    const one = ledgerWithOne();
    const { ledger, outcome } = updateReview(one, review({ content_hash: 'c2' }), T1);
    const record = ledger.records.get('a'.repeat(32));

    expect(outcome).toBe(OUTCOMES.UPDATED);
    expect(record?.revision).toBe(2);
    expect(record?.content_hash_history).toEqual(['c1']);
    expect(record?.review.content_hash).toBe('c2');
  });

  it('accumulates history across several edits', () => {
    let ledger = ledgerWithOne();
    ledger = updateReview(ledger, review({ content_hash: 'c2' }), T1).ledger;
    ledger = updateReview(ledger, review({ content_hash: 'c3' }), T2).ledger;
    const record = ledger.records.get('a'.repeat(32));

    expect(record?.revision).toBe(3);
    expect(record?.content_hash_history).toEqual(['c1', 'c2']);
  });

  it('reports ABSENT for an unknown id rather than inserting one', () => {
    const { outcome } = updateReview(emptyLedger(), review(), T1);

    expect(outcome).toBe(OUTCOMES.ABSENT);
  });
});

describe('UNCHANGED', () => {
  it('moves only last_seen_at and resets the streak', () => {
    const one = ledgerWithOne();
    const { ledger, outcome } = touchReview(one, 'a'.repeat(32), T1);
    const record = ledger.records.get('a'.repeat(32));

    expect(outcome).toBe(OUTCOMES.UNCHANGED);
    expect(record?.last_seen_at).toBe(T1);
    expect(record?.last_updated_at).toBe(T0);
    expect(record?.revision).toBe(1);
  });

  it('does not advance last_updated_at, so hash-gating still works', () => {
    // Claiming an update on an unchanged review makes every payload look
    // edited on every harvest, which defeats hash-gating entirely.
    const one = ledgerWithOne();
    const { ledger } = touchReview(one, 'a'.repeat(32), T1);

    expect(ledger.records.get('a'.repeat(32))?.last_updated_at).toBe(T0);
  });
});

describe('the absence asymmetry (TR-REC-010, TR-REC-011, PT-07)', () => {
  /** @param {string} completeness */
  const opts = (completeness) => ({ completeness, removalConfirmations: 3, now: T1 });

  it('increments the streak after a full harvest', () => {
    const { ledger, outcome } = markMissing(ledgerWithOne(), 'a'.repeat(32), opts('full'));

    expect(outcome).toBe(OUTCOMES.MISSING);
    expect(ledger.records.get('a'.repeat(32))?.missing_streak).toBe(1);
    expect(ledger.records.get('a'.repeat(32))?.state).toBe('unconfirmed');
  });

  it('increments after full_capped too', () => {
    const { ledger } = markMissing(ledgerWithOne(), 'a'.repeat(32), opts('full_capped'));

    expect(ledger.records.get('a'.repeat(32))?.missing_streak).toBe(1);
  });

  it('CHANGES NOTHING after a partial harvest', () => {
    // One partial page load must not begin a countdown to deleting a client's
    // entire review set.
    const before = ledgerWithOne();
    const { ledger, outcome } = markMissing(before, 'a'.repeat(32), opts('partial'));
    const record = ledger.records.get('a'.repeat(32));

    expect(outcome).toBe(OUTCOMES.HELD);
    expect(record?.missing_streak).toBe(0);
    expect(record?.state).toBe('active');
    expect(record?.last_seen_at).toBe(T0);
    expect(ledger).toBe(before);
  });

  it('CHANGES NOTHING after a failed harvest', () => {
    const before = ledgerWithOne();
    const { ledger, outcome } = markMissing(before, 'a'.repeat(32), opts('failed'));

    expect(outcome).toBe(OUTCOMES.HELD);
    expect(ledger).toBe(before);
  });

  it('changes nothing for an unrecognised completeness', () => {
    // Fails closed. A completeness value nobody remembered to handle must not
    // silently start authorising deletions.
    const before = ledgerWithOne();
    const { outcome } = markMissing(before, 'a'.repeat(32), opts('something-new'));

    expect(outcome).toBe(OUTCOMES.HELD);
  });

  it('tombstones only at the confirmation threshold, not before', () => {
    let ledger = ledgerWithOne();
    const id = 'a'.repeat(32);

    ledger = markMissing(ledger, id, opts('full')).ledger;
    expect(ledger.records.get(id)?.state).toBe('unconfirmed');

    ledger = markMissing(ledger, id, opts('full')).ledger;
    expect(ledger.records.get(id)?.state).toBe('unconfirmed');

    const third = markMissing(ledger, id, {
      completeness: 'full',
      removalConfirmations: 3,
      now: T2,
    });
    expect(third.outcome).toBe(OUTCOMES.TOMBSTONED);
    expect(third.ledger.records.get(id)?.state).toBe('tombstoned');
    expect(third.ledger.records.get(id)?.tombstoned_at).toBe(T2);
  });

  it('resets the streak when the review reappears (TR-REC-013)', () => {
    let ledger = ledgerWithOne();
    const id = 'a'.repeat(32);

    ledger = markMissing(ledger, id, opts('full')).ledger;
    ledger = markMissing(ledger, id, opts('full')).ledger;
    expect(ledger.records.get(id)?.missing_streak).toBe(2);

    ledger = touchReview(ledger, id, T2).ledger;
    expect(ledger.records.get(id)?.missing_streak).toBe(0);
    expect(ledger.records.get(id)?.state).toBe('active');
  });
});

describe('monotonicity: terminal states never reverse (PT-03, PT-04)', () => {
  /** @returns {import('../../../src/core/model/ledger.mjs').Ledger} */
  function tombstoned() {
    let ledger = ledgerWithOne();
    const id = 'a'.repeat(32);
    for (const now of [T1, T2, T3]) {
      ledger = markMissing(ledger, id, {
        completeness: 'full',
        removalConfirmations: 3,
        now,
      }).ledger;
    }
    return ledger;
  }

  it('reaches the tombstone', () => {
    expect(tombstoned().records.get('a'.repeat(32))?.state).toBe('tombstoned');
  });

  it('refuses to re-insert a tombstoned id', () => {
    // Even if the review genuinely reappears at the source. "Deleted review
    // comes back" is embarrassing as a mistake and serious as an erasure.
    const { ledger, outcome } = insertReview(tombstoned(), review(), T3);

    expect(outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
    expect(ledger.records.get('a'.repeat(32))?.state).toBe('tombstoned');
  });

  it('refuses to update a tombstoned id', () => {
    const { outcome } = updateReview(tombstoned(), review({ content_hash: 'c9' }), T3);

    expect(outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });

  it('refuses to touch a tombstoned id back to active', () => {
    const { ledger, outcome } = touchReview(tombstoned(), 'a'.repeat(32), T3);

    expect(outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
    expect(ledger.records.get('a'.repeat(32))?.state).toBe('tombstoned');
  });

  it('suppresses permanently, and suppression outranks the lifecycle', () => {
    // An erasure obligation applies even to an already-tombstoned record.
    const { ledger, outcome } = suppressReview(tombstoned(), 'a'.repeat(32), T3);

    expect(outcome).toBe(OUTCOMES.SUPPRESSED);
    expect(ledger.records.get('a'.repeat(32))?.state).toBe('suppressed');
  });

  it('refuses to reactivate a suppressed id by any path', () => {
    const suppressed = suppressReview(ledgerWithOne(), 'a'.repeat(32), T1).ledger;

    expect(insertReview(suppressed, review(), T2).outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
    expect(updateReview(suppressed, review({ content_hash: 'c2' }), T2).outcome).toBe(
      OUTCOMES.IGNORED_TERMINAL,
    );
    expect(touchReview(suppressed, 'a'.repeat(32), T2).outcome).toBe(OUTCOMES.IGNORED_TERMINAL);
  });
});

describe('publishable records', () => {
  it('includes active and unconfirmed, excludes terminal', () => {
    // An unconfirmed record is still published deliberately: pulling it early
    // would make a transient failure visible to visitors.
    let ledger = ledgerWithOne();
    ledger = markMissing(ledger, 'a'.repeat(32), {
      completeness: 'full',
      removalConfirmations: 3,
      now: T1,
    }).ledger;

    expect(publishableRecords(ledger)).toHaveLength(1);

    const suppressed = suppressReview(ledger, 'a'.repeat(32), T2).ledger;
    expect(publishableRecords(suppressed)).toHaveLength(0);
  });
});

describe('harvest recording', () => {
  it('records a full harvest as the freshness signal', () => {
    expect(recordHarvest(emptyLedger(), 'full', T1).last_full_harvest_at).toBe(T1);
  });

  it('does not let a partial harvest claim freshness', () => {
    const after = recordHarvest(recordHarvest(emptyLedger(), 'full', T1), 'partial', T2);

    expect(after.last_full_harvest_at).toBe(T1);
    expect(after.updated_at).toBe(T2);
  });
});

describe('invariants', () => {
  it('reports none for a sound ledger', () => {
    expect(checkLedgerInvariants(ledgerWithOne())).toEqual([]);
  });

  it('catches a key that disagrees with its record', () => {
    const ledger = ledgerWithOne();
    const records = new Map(ledger.records);
    records.set('b'.repeat(32), requireRecord(ledger, 'a'.repeat(32)));

    expect(checkLedgerInvariants({ ...ledger, records }).length).toBeGreaterThan(0);
  });

  it('catches a tombstone with no timestamp', () => {
    const ledger = ledgerWithOne();
    const records = new Map(ledger.records);
    const record = requireRecord(ledger, 'a'.repeat(32));
    records.set('a'.repeat(32), { ...record, state: 'tombstoned', tombstoned_at: null });

    expect(checkLedgerInvariants({ ...ledger, records })).toContainEqual(
      expect.stringContaining('tombstoned without'),
    );
  });

  it('catches a history length that disagrees with the revision', () => {
    const ledger = ledgerWithOne();
    const records = new Map(ledger.records);
    const record = requireRecord(ledger, 'a'.repeat(32));
    records.set('a'.repeat(32), { ...record, revision: 5 });

    expect(checkLedgerInvariants({ ...ledger, records }).length).toBeGreaterThan(0);
  });
});

describe('serialisation', () => {
  it('round-trips', () => {
    const before = ledgerWithOne();
    const after = fromJSON(toJSON(before));

    expect(after.records.size).toBe(1);
    expect(after.client_slug).toBe(before.client_slug);
    expect(after.records.get('a'.repeat(32))?.first_seen_at).toBe(T0);
  });

  it('emits record keys in sorted order so bytes are stable (TR-HASH-030)', () => {
    let ledger = emptyLedger();
    ledger = insertReview(ledger, review({ identity_hash: 'c'.repeat(32) }), T0).ledger;
    ledger = insertReview(ledger, review({ identity_hash: 'a'.repeat(32) }), T0).ledger;
    ledger = insertReview(ledger, review({ identity_hash: 'b'.repeat(32) }), T0).ledger;

    const keys = Object.keys(/** @type {Record<string, unknown>} */ (toJSON(ledger).records));

    expect(keys).toEqual(['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]);
  });

  it('produces a Map again, not an object', () => {
    expect(fromJSON(toJSON(emptyLedger())).records).toBeInstanceOf(Map);
  });
});

describe('isTerminal', () => {
  it('is true only for tombstoned and suppressed', () => {
    expect(isTerminal({ state: 'active' })).toBe(false);
    expect(isTerminal({ state: 'unconfirmed' })).toBe(false);
    expect(isTerminal({ state: 'tombstoned' })).toBe(true);
    expect(isTerminal({ state: 'suppressed' })).toBe(true);
    expect(isTerminal(undefined)).toBe(false);
  });
});
