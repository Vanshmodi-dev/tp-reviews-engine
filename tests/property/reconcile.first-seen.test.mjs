import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { reconcile } from '../../src/core/reconcile/index.mjs';
import {
  anyStopReason,
  instantAt,
  realLedgerAndHarvest,
  seedLedger,
} from '../helpers/reconcile-generators.mjs';
import { harvest, identity, recordOf, review } from '../helpers/reconcile-input.mjs';

/**
 * PT-05 — `first_seen_at` never changes after INSERT (T-108).
 * PT-06 — a pinned date is never recomputed (TR-REC-021).
 *
 * Both are stated here because they are the same mistake wearing two hats: the
 * incoming review carries a plausible-looking value for each, and using it is
 * the natural thing to write.
 *
 * ## Why `first_seen_at` matters more than it looks
 *
 * It is the only durable answer to "how long have we known about this review".
 * Payload sorting, the `new since` signal, and every freshness claim a client
 * makes rest on it. A reconciler that refreshed it on update would make every
 * edited review look brand new, and a listing where the owner replies to old
 * reviews would reorder itself constantly for no reason a visitor could see.
 *
 * ## Why the pinned date matters more still
 *
 * Sources publish *relative* dates — "2 months ago". Resolving that against the
 * clock is only correct at the moment of first observation; doing it again on
 * the next harvest yields "3 months ago" for the same review, and the date walks
 * forward on every run. Pinning at INSERT and preserving thereafter is what stops
 * a review's date from drifting for as long as it exists.
 *
 * Both protections live in `core/model/ledger.mjs`'s constructors rather than in
 * the merge, because that is the single place every mutation goes through.
 */

const RUNS = 1000;

describe('PT-05 — first_seen_at is written once and never again', () => {
  it('survives any sequence of harvests', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            observe: fc.boolean(),
            edit: fc.boolean(),
            stopReason: anyStopReason(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (sequence) => {
          let ledger = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));
          const original = recordOf(ledger, identity('a')).first_seen_at;

          for (const [index, step] of sequence.entries()) {
            const observed = step.observe
              ? [review('a', step.edit ? { content_hash: `edit-${index}`.padEnd(64, '0') } : {})]
              : [];

            ledger = reconcile(
              harvest({
                prior: ledger,
                observed,
                stopReason: step.stopReason,
                now: instantAt(index + 1),
              }),
            ).ledger;

            if (ledger.records.get(identity('a'))?.first_seen_at !== original) return false;
          }

          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('is preserved across every record in a generated harvest', () => {
    fc.assert(
      fc.property(realLedgerAndHarvest(), ({ prior, observed, stopReason, now }) => {
        const out = reconcile(harvest({ prior, observed, stopReason, now }));

        for (const [id, before] of prior.records) {
          const after = out.ledger.records.get(id);
          if (after !== undefined && after.first_seen_at !== before.first_seen_at) return false;
        }

        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('ignores a first_seen_at the incoming review tries to supply', () => {
    // The natural mistake, made deliberately. The record shape has no such
    // field, but a future adapter could add one and the merge must not read it.
    const prior = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));
    const original = recordOf(prior, identity('a')).first_seen_at;

    const out = reconcile(
      harvest({
        prior,
        observed: [
          review('a', {
            content_hash: 'changed'.padEnd(64, '0'),
            first_seen_at: '1999-01-01T00:00:00.000Z',
          }),
        ],
        now: instantAt(5),
      }),
    );

    expect(recordOf(out.ledger, identity('a')).first_seen_at).toBe(original);
  });

  it('sets it to `now` on insert, and only on insert', () => {
    const prior = seedLedger([], instantAt(0));
    const inserted = reconcile(
      harvest({ prior, observed: [review('a')], now: instantAt(1) }),
    ).ledger;

    expect(recordOf(inserted, identity('a')).first_seen_at).toBe(instantAt(1));

    const later = reconcile(
      harvest({ prior: inserted, observed: [review('a')], now: instantAt(2) }),
    ).ledger;

    expect(recordOf(later, identity('a')).first_seen_at).toBe(instantAt(1));
    expect(recordOf(later, identity('a')).last_seen_at).toBe(instantAt(2));
  });
});

describe('PT-06 — a pinned date is never recomputed', () => {
  it('preserves date_estimated, precision and confidence through an update', () => {
    const prior = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));
    const pinned = recordOf(prior, identity('a')).review;

    const out = reconcile(
      harvest({
        prior,
        observed: [
          review('a', {
            content_hash: 'changed'.padEnd(64, '0'),
            // What a later harvest would genuinely derive: the same review, now
            // described as older, resolved against a later clock.
            date_estimated: '2026-05-15T00:00:00.000Z',
            date_precision: 'day',
            date_confidence: 'high',
            relative_date: '5 months ago',
          }),
        ],
        now: instantAt(5),
      }),
    );

    const after = recordOf(out.ledger, identity('a')).review;

    expect(after.date_estimated).toBe(pinned.date_estimated);
    expect(after.date_precision).toBe(pinned.date_precision);
    expect(after.date_confidence).toBe(pinned.date_confidence);
  });

  it('does not let the date drift across a long sequence of harvests', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (harvests) => {
        let ledger = seedLedger([{ label: 'a', state: 'active' }], instantAt(0));
        const pinned = recordOf(ledger, identity('a')).review.date_estimated;

        for (let index = 1; index <= harvests; index += 1) {
          ledger = reconcile(
            harvest({
              prior: ledger,
              observed: [
                review('a', {
                  content_hash: `rev-${index}`.padEnd(64, '0'),
                  date_estimated: `2026-0${Math.min(9, index)}-01T00:00:00.000Z`,
                }),
              ],
              now: instantAt(index),
            }),
          ).ledger;
        }

        return recordOf(ledger, identity('a')).review.date_estimated === pinned;
      }),
      { numRuns: RUNS },
    );
  });
});
