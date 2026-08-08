import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareForPublication, orderForPublication } from '../../src/core/project/order.mjs';
import { projectArtifacts, sealArtifact } from '../../src/core/project/index.mjs';
import { projectPayload, selectPublishable } from '../../src/core/project/payload.mjs';
import { serialisePayload } from '../../src/core/project/serialise.mjs';
import { config, ledgerOf, meta, review } from '../helpers/project-input.mjs';

/**
 * PT-12 — projection determinism (T-122).
 * PT-13 — the sort key is total (T-115, PROJ-01).
 *
 * ## What PT-12 actually protects
 *
 * "Identical ledger plus identical config produces byte-identical artifacts" is
 * the claim three separate mechanisms rest on:
 *
 * - **Hash-gating.** The publisher skips a write when the new bytes equal the
 *   current bytes. If projection were nondeterministic, the bytes would differ
 *   every run, nothing would ever be skipped, and every client would produce a
 *   commit on every cycle — roughly fifty times the commit volume, for nothing.
 * - **Surviving a permanently failed push (CH-12).** The recovery is "the next
 *   run reproduces byte-identical artifacts". That is only a recovery if it is
 *   true.
 * - **The git history as an audit log.** A diff that appears when nothing
 *   changed is noise, and enough of it makes the history unreadable, which is
 *   the whole reason the ledger is pretty-printed.
 *
 * The two ways determinism breaks here are object key order and sort
 * instability, and there is a law for each.
 *
 * ## Why PT-13 is about totality rather than about order
 *
 * A comparator returning 0 for two distinct reviews leaves their relative order
 * to the sort implementation and to arrival order. Sources publish relative
 * dates, so pinned estimates cluster hard — twenty reviews sharing a date to the
 * day is ordinary. Ties are the common case here, not the edge case, which is
 * why the key ends in `identity_hash` and why this law is stated as "no two
 * distinct reviews compare equal".
 */

const RUNS = 1000;

/** Dates drawn from a deliberately small set, so ties are frequent. */
const clusteredDate = () =>
  fc.constantFrom(
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '2026-02-01T00:00:00.000Z',
    null,
  );

/** A ledger whose records collide on date constantly. */
const clusteredLedger = () =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: 400 }), { minLength: 2, maxLength: 12 })
    .chain((labels) =>
      fc.tuple(
        ...labels.map((label) =>
          fc
            .record({
              date_estimated: clusteredDate(),
              rating: fc.integer({ min: 1, max: 5 }),
              language: fc.constantFrom('en', 'fr', 'de'),
            })
            .map((overrides) => review(label, overrides)),
        ),
      ),
    )
    .map((reviews) => ledgerOf(reviews));

/** A permutation of an array. */
const permutationOf = (/** @type {ReadonlyArray<any>} */ items) =>
  fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });

describe('PT-13 — the publication order is total (PROJ-01)', () => {
  it('never returns 0 for two distinct reviews', () => {
    fc.assert(
      fc.property(clusteredLedger(), (ledger) => {
        const records = selectPublishable(ledger);

        return everyDistinctPairOrders(records);
      }),
      { numRuns: RUNS },
    );
  });

  it('produces the same order from any input order', () => {
    fc.assert(
      fc.property(
        clusteredLedger().chain((ledger) =>
          fc.record({
            ledger: fc.constant(ledger),
            shuffled: permutationOf(selectPublishable(ledger)),
          }),
        ),
        ({ ledger, shuffled }) => {
          const canonical = orderForPublication(selectPublishable(ledger));
          const reordered = orderForPublication(shuffled);

          return idsOf(canonical).join(',') === idsOf(reordered).join(',');
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('is antisymmetric and reflexive', () => {
    fc.assert(
      fc.property(clusteredLedger(), (ledger) => {
        const records = selectPublishable(ledger);

        for (const left of records) {
          if (compareForPublication(left, left) !== 0) return false;

          for (const right of records) {
            const forward = Math.sign(compareForPublication(left, right));
            const backward = Math.sign(compareForPublication(right, left));

            if (forward !== -backward) return false;
          }
        }

        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('shows the generator actually produces ties', () => {
    // Without shared dates the tiebreak is never exercised and the law passes
    // for the wrong reason.
    const samples = fc.sample(clusteredLedger(), { numRuns: 200, seed: 21 });
    const withTies = samples.filter((ledger) => hasDateTie(selectPublishable(ledger)));

    expect(withTies.length).toBeGreaterThan(0);
  });

  it('sorts newest first, and reverses cleanly', () => {
    const ledger = ledgerOf([
      review(1, { date_estimated: '2025-01-01T00:00:00.000Z' }),
      review(2, { date_estimated: '2026-06-01T00:00:00.000Z' }),
    ]);
    const records = selectPublishable(ledger);

    expect(orderForPublication(records)[0].review.date_estimated).toBe('2026-06-01T00:00:00.000Z');
    expect(orderForPublication(records, 'oldest')[0].review.date_estimated).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('sorts null dates last, not as the oldest', () => {
    // A review with no usable date is unknown, not ancient. Sorting it as the
    // oldest is a guess presented as a fact, and it would push genuinely old
    // reviews off the end of latest.json in its favour.
    const ledger = ledgerOf([
      review(1, { date_estimated: null }),
      review(2, { date_estimated: '2020-01-01T00:00:00.000Z' }),
    ]);
    const ordered = orderForPublication(selectPublishable(ledger));

    expect(ordered.at(-1)?.review.date_estimated).toBeNull();
  });

  it('does not sort its input in place', () => {
    const records = selectPublishable(ledgerOf([review(2), review(1)]));
    const before = idsOf(records).join(',');

    orderForPublication(records);

    expect(idsOf(records).join(',')).toBe(before);
  });
});

describe('PT-12 — projection is byte-identical for identical inputs', () => {
  it('produces identical bytes across two runs', () => {
    fc.assert(
      fc.property(clusteredLedger(), (ledger) => {
        const input = { ledger, config: config(), meta: meta(), generatedAt: FIXED_AT };

        return sealOne(input).bytes === sealOne(input).bytes;
      }),
      { numRuns: RUNS },
    );
  });

  it('produces identical bytes regardless of ledger insertion order', () => {
    // A Map preserves insertion order, so a ledger rebuilt in a different order
    // is a different object with the same content. The payload must not notice.
    fc.assert(
      fc.property(
        clusteredLedger().chain((ledger) =>
          fc.record({
            ledger: fc.constant(ledger),
            shuffled: permutationOf([...ledger.records.entries()]),
          }),
        ),
        ({ ledger, shuffled }) => {
          const reordered = { ...ledger, records: new Map(shuffled) };

          return bytesOf(ledger) === bytesOf(reordered);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('produces identical hashes when only generated_at differs (EDR-022)', () => {
    fc.assert(
      fc.property(clusteredLedger(), (ledger) => {
        const early = sealOne({
          ledger,
          config: config(),
          meta: meta(),
          generatedAt: '2026-03-01T00:00:00.000Z',
        });
        const late = sealOne({
          ledger,
          config: config(),
          meta: meta(),
          generatedAt: '2027-11-11T11:11:11.000Z',
        });

        // Same hash - so hash-gating skips the write - but different bytes,
        // because consumers legitimately need the timestamp.
        return early.contentHash === late.contentHash && early.bytes !== late.bytes;
      }),
      { numRuns: RUNS },
    );
  });

  it('changes the hash when the data actually changes', () => {
    // The other half. A hash that never changed would also make hash-gating
    // "work", by never publishing anything again.
    const before = projectArtifacts({
      ledger: ledgerOf([review(1, { rating: 5 })]),
      config: config(),
      meta: meta(),
      generatedAt: FIXED_AT,
    });
    const after = projectArtifacts({
      ledger: ledgerOf([review(1, { rating: 1 })]),
      config: config(),
      meta: meta(),
      generatedAt: FIXED_AT,
    });

    expect(after.reviews.contentHash).not.toBe(before.reviews.contentHash);
  });

  it('changes the hash when config changes', () => {
    const wide = projectArtifacts({
      ledger: ledgerOf([review(1, { rating: 1 }), review(2, { rating: 5 })]),
      config: config(),
      meta: meta(),
      generatedAt: FIXED_AT,
    });
    const filtered = projectArtifacts({
      ledger: ledgerOf([review(1, { rating: 1 }), review(2, { rating: 5 })]),
      config: config({ display: { min_rating: 3 } }),
      meta: meta(),
      generatedAt: FIXED_AT,
    });

    expect(filtered.reviews.contentHash).not.toBe(wide.reviews.contentHash);
  });

  it('serialises with stable key order whatever the object literal order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer(), { maxKeys: 8 }),
        (record) => {
          const shuffled = Object.fromEntries(Object.entries(record).reverse());

          return serialisePayload(record) === serialisePayload(shuffled);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

const FIXED_AT = '2026-03-01T12:00:00.000Z';

/**
 * @param {any} ledger
 * @returns {string}
 */
function bytesOf(ledger) {
  return sealOne({ ledger, config: config(), meta: meta(), generatedAt: FIXED_AT }).bytes;
}

/**
 * Seals only the `reviews` artifact.
 *
 * The determinism laws are about one artifact's bytes, and `projectArtifacts`
 * hashes five. Sealing one costs a fifth of the work per case and exercises the
 * same claim; the full artifact set is covered by its own unit tests, and by the
 * composition test below.
 *
 * @param {any} input
 * @returns {{ bytes: string, contentHash: string }}
 */
function sealOne(input) {
  return sealArtifact(projectPayload(input));
}

/**
 * @param {ReadonlyArray<any>} records
 * @returns {string[]}
 */
function idsOf(records) {
  return records.map((record) => record.review.identity_hash);
}

/**
 * Whether the comparator separates every pair of distinct records.
 *
 * @param {ReadonlyArray<any>} records
 * @returns {boolean}
 */
function everyDistinctPairOrders(records) {
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      if (compareForPublication(records[i], records[j]) === 0) return false;
    }
  }

  return true;
}

/**
 * @param {ReadonlyArray<any>} records
 * @returns {boolean}
 */
function hasDateTie(records) {
  const dates = records.map((record) => record.review.date_estimated);

  return new Set(dates).size < dates.length;
}
