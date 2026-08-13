/**
 * INV-10 — identity survives a change of adapter (S7, ADR-023, SAD §15.7).
 *
 * The migration contingency for RISK-03 rests entirely on one property: the
 * same review, harvested by a different adapter, must reconcile to the same
 * ledger record.
 *
 * If it did not, switching a client from `google:dom` to an official API would
 * orphan their entire corpus. Every existing review would go missing on the
 * first API harvest and every API review would be an insert — so the site would
 * appear to lose and then regain every review, `first_seen_at` would reset for
 * all of them, and the reconciler would spend two more full harvests deciding
 * whether to tombstone the originals.
 *
 * This is why identity is derived from listing + author + content and never
 * from a source-specific id (ADR-007). The engineering note in SAD §15.7 calls
 * step 5 of the migration "the subtle one", and this is that step.
 *
 * The drill was executed by hand once (`docs/runbooks/migration-drill.md`).
 * A drill that ran once is evidence; a test is a guarantee.
 */

import { describe, expect, it } from 'vitest';

import { normaliseRecords } from '../../src/app/stages/normalize-records.mjs';

const CTX = {
  listingKey: 'google:ChIJmigration',
  source: 'google',
  observedAtMs: Date.parse('2026-08-13T00:00:00.000Z'),
};

/** Two reviews as the DOM adapter presents them: a relative-date field. */
const VIA_DOM = [
  {
    rating: 5,
    text: 'Turned up on time and cleared the blockage in twenty minutes.',
    author: { name: 'Dana R.' },
    relative_date_raw: '2026-07-28',
  },
  {
    rating: 4,
    text: 'Good work and a fair price for it.',
    author: { name: 'Sam T.' },
    relative_date_raw: '2026-06-15',
  },
];

/** The same two, as an official API presents them: an absolute `date`. */
const VIA_API = [
  {
    rating: 5,
    text: 'Turned up on time and cleared the blockage in twenty minutes.',
    author: { name: 'Dana R.' },
    date: '2026-07-28',
  },
  {
    rating: 4,
    text: 'Good work and a fair price for it.',
    author: { name: 'Sam T.' },
    date: '2026-06-15',
  },
];

describe('the same reviews through two adapters', () => {
  const dom = normaliseRecords(VIA_DOM, CTX);
  const api = normaliseRecords(VIA_API, CTX);

  it('normalises both without quarantining anything', () => {
    expect(dom.quarantined).toEqual([]);
    expect(api.quarantined).toEqual([]);
    expect(dom.records).toHaveLength(2);
    expect(api.records).toHaveLength(2);
  });

  it('produces IDENTICAL identity hashes', () => {
    // The property the whole migration depends on. A mismatch here means a
    // client switching adapters loses their history.
    expect(api.records.map((record) => record.identity_hash)).toEqual(
      dom.records.map((record) => record.identity_hash),
    );
  });

  it('produces identical content hashes, so nothing republishes on migration', () => {
    // If these differed, the migration would rewrite every payload on the day
    // it happened — hash gating would see a change in every review at once,
    // which is indistinguishable from the source having been rewritten.
    expect(api.records.map((record) => record.content_hash)).toEqual(
      dom.records.map((record) => record.content_hash),
    );
  });

  it('pins the same dates from both date forms', () => {
    // One adapter says "2026-07-28" in a relative-date field, the other in an
    // absolute one. PT-06 pins the estimate once and never recomputes it, so
    // the two must agree or the migration would shift every review's date.
    expect(api.records.map((record) => record.date_estimated)).toEqual(
      dom.records.map((record) => record.date_estimated),
    );
  });

  it('derives the same author keys', () => {
    expect(api.records.map((record) => record.author_key)).toEqual(
      dom.records.map((record) => record.author_key),
    );
  });
});

describe('identity is content-derived, not source-derived', () => {
  it('changes when the review text changes', () => {
    // The other half. Identity that never changed would be a constant, and a
    // constant makes every review the same review.
    const edited = normaliseRecords(
      [{ ...VIA_DOM[0], text: 'Completely different text from the same author.' }],
      CTX,
    );
    const original = normaliseRecords([VIA_DOM[0]], CTX);

    expect(edited.records[0].identity_hash).not.toBe(original.records[0].identity_hash);
  });

  it('changes when the listing changes', () => {
    // The same words from the same name at a DIFFERENT business is a different
    // review. Without the listing in the hash, two branches of a chain would
    // share identities and reconcile into each other.
    const elsewhere = normaliseRecords([VIA_DOM[0]], { ...CTX, listingKey: 'google:ChIJother' });
    const here = normaliseRecords([VIA_DOM[0]], CTX);

    expect(elsewhere.records[0].identity_hash).not.toBe(here.records[0].identity_hash);
  });
});
