import { describe, expect, it } from 'vitest';

import {
  bucketByAuthor,
  collapseIntraRun,
  findNearDuplicates,
  isKnownIdentity,
} from '../../../src/core/reconcile/duplicates.mjs';
import { markNormalised } from '../../../src/core/model/review.mjs';
import { identity, ledgerWith, review } from '../../helpers/reconcile-input.mjs';

describe('tier 1 — exact identity match against the ledger (T-102)', () => {
  it('recognises a repeat observation', () => {
    const ledger = ledgerWith([review('a')]);

    expect(isKnownIdentity(ledger, identity('a'))).toBe(true);
    expect(isKnownIdentity(ledger, identity('z'))).toBe(false);
  });

  it('is a map lookup, so it stays O(1) at a thousand records', () => {
    const ledger = ledgerWith(Array.from({ length: 500 }, (_, i) => review(i)));

    expect(ledger.records).toBeInstanceOf(Map);
    expect(isKnownIdentity(ledger, identity(499))).toBe(true);
  });
});

describe('intra-run collapse (T-105, TR-REC-001, TR-REC-002)', () => {
  it('collapses a collision to exactly one record', () => {
    const { records, collisions } = collapseIntraRun([review('a'), review('a'), review('b')]);

    expect(records).toHaveLength(2);
    expect(collisions).toBe(1);
  });

  it('reports zero collisions when every identity is distinct', () => {
    expect(collapseIntraRun([review('a'), review('b')]).collisions).toBe(0);
  });

  it('prefers the record with more non-null fields', () => {
    const sparse = review('a', { likes: null, photo_count: null, source_url: null });
    const rich = review('a', { likes: 3, photo_count: 2, source_url: 'https://example.test/r' });

    for (const order of [
      [sparse, rich],
      [rich, sparse],
    ]) {
      expect(collapseIntraRun(order).records[0].likes).toBe(3);
    }
  });

  it('walks the author object rather than counting it as one field', () => {
    // Two renderings of one review differ exactly here: one loaded the avatar
    // and profile URL, the other was clipped before they arrived.
    const clipped = review('a', {
      author: { name: markNormalised('Dana'), initials: null, avatar_url: null, profile_url: null },
    });
    const full = review('a', {
      author: {
        name: markNormalised('Dana'),
        initials: 'D',
        avatar_url: 'https://example.test/a.png',
        profile_url: 'https://example.test/p',
      },
    });

    expect(collapseIntraRun([clipped, full]).records[0].author.avatar_url).not.toBeNull();
    expect(collapseIntraRun([full, clipped]).records[0].author.avatar_url).not.toBeNull();
  });

  it('falls back to the longer text when field counts tie', () => {
    const short = review('a', { text: markNormalised('Good.') });
    const long = review('a', { text: markNormalised('Good, and the staff were lovely.') });

    expect(String(collapseIntraRun([short, long]).records[0].text)).toContain('lovely');
    expect(String(collapseIntraRun([long, short]).records[0].text)).toContain('lovely');
  });

  it('falls back to the earlier node ordinal when text ties', () => {
    const later = review('a', { node_ordinal: 9 });
    const earlier = review('a', { node_ordinal: 2 });

    expect(collapseIntraRun([later, earlier]).records[0].node_ordinal).toBe(2);
    expect(collapseIntraRun([earlier, later]).records[0].node_ordinal).toBe(2);
  });

  it('prefers a record that has an ordinal over one that does not', () => {
    const withOrdinal = review('a', { node_ordinal: 4 });
    const without = review('a');

    expect(collapseIntraRun([without, withOrdinal]).records[0].node_ordinal).toBe(4);
  });

  it('is deterministic when every normative test ties', () => {
    // The case TR-REC-002 does not cover. Without a final tiebreak the winner
    // is whichever the loop reached first, which is iteration order - exactly
    // what DUP-03 forbids.
    const one = review('a', { content_hash: 'aaa'.padEnd(64, '0') });
    const two = review('a', { content_hash: 'bbb'.padEnd(64, '0') });

    expect(collapseIntraRun([one, two]).records[0].content_hash).toBe('aaa'.padEnd(64, '0'));
    expect(collapseIntraRun([two, one]).records[0].content_hash).toBe('aaa'.padEnd(64, '0'));
  });

  it('returns records in identity order regardless of input order', () => {
    const forward = collapseIntraRun([review('c'), review('a'), review('b')]);
    const backward = collapseIntraRun([review('b'), review('c'), review('a')]);

    expect(forward.records.map((r) => r.identity_hash)).toEqual(
      backward.records.map((r) => r.identity_hash),
    );
  });

  it('is idempotent — collapsing an already-collapsed harvest changes nothing', () => {
    const once = collapseIntraRun([review('a'), review('a'), review('b')]);
    const twice = collapseIntraRun(once.records);

    expect(twice.records).toEqual(once.records);
    expect(twice.collisions).toBe(0);
  });

  it('handles an empty harvest', () => {
    expect(collapseIntraRun([])).toEqual({ records: [], collisions: 0 });
  });
});

describe('bucketing by author (DUP-02, IR-15)', () => {
  it('groups records sharing an author key', () => {
    const buckets = bucketByAuthor([
      review('a', { author_key: 'k1' }),
      review('b', { author_key: 'k1' }),
      review('c', { author_key: 'k2' }),
    ]);

    expect(buckets.get('k1')).toHaveLength(2);
    expect(buckets.get('k2')).toHaveLength(1);
  });

  it('drops records with no usable author key rather than pooling them', () => {
    // A shared anonymous bucket would compare every anonymous reviewer against
    // every other: both the quadratic case bucketing avoids and a guaranteed
    // source of false positives.
    const buckets = bucketByAuthor([
      review('a', { author_key: null }),
      review('b', { author_key: '' }),
      review('c', { author_key: 'k1' }),
    ]);

    expect([...buckets.keys()]).toEqual(['k1']);
  });
});

describe('tier 2 — near-duplicates are reported, never merged (T-103, DUP-01)', () => {
  const longText = 'The staff were lovely and the service was quick and I will return soon.';

  it('reports a pair when one author posts near-identical text twice', () => {
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: markNormalised(longText) }),
        review('b', { author_key: 'k1', text: markNormalised(`${longText} Thanks!`) }),
      ],
      0.92,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs.at(0)?.author_key).toBe('k1');
    expect(pairs.at(0)?.similarity).toBeGreaterThanOrEqual(0.92);
  });

  it('twelve identical short reviews from twelve authors produce twelve survivors', () => {
    // T-103's stated verification, constructed exactly. Short text collides
    // constantly across authors and almost never means anything.
    const records = Array.from({ length: 12 }, (_, i) =>
      review(i, { author_key: `author-${i}`, text: markNormalised('Great!') }),
    );

    expect(findNearDuplicates(records, 0.92)).toEqual([]);
    expect(collapseIntraRun(records).records).toHaveLength(12);
  });

  it('never compares across author keys, however similar the text', () => {
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: markNormalised(longText) }),
        review('b', { author_key: 'k2', text: markNormalised(longText) }),
      ],
      0.92,
    );

    expect(pairs).toEqual([]);
  });

  it('does not report a pair below the threshold', () => {
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: markNormalised('The coffee was excellent.') }),
        review('b', { author_key: 'k1', text: markNormalised('Parking is impossible here.') }),
      ],
      0.92,
    );

    expect(pairs).toEqual([]);
  });

  it('never reports a record against itself', () => {
    const one = review('a', { author_key: 'k1', text: markNormalised(longText) });

    expect(findNearDuplicates([one], 0.92)).toEqual([]);
    expect(findNearDuplicates(collapseIntraRun([one, one]).records, 0.92)).toEqual([]);
  });

  it('reports pairs in a stable order independent of input order', () => {
    const records = [
      review('a', { author_key: 'k1', text: markNormalised(longText) }),
      review('b', { author_key: 'k1', text: markNormalised(`${longText} Thanks!`) }),
      review('c', { author_key: 'k1', text: markNormalised(`${longText} Cheers!`) }),
    ];

    const forward = findNearDuplicates(records, 0.92);
    const backward = findNearDuplicates([...records].reverse(), 0.92);

    expect(backward).toEqual(forward);
  });

  it('reports a pair in identity order however the records arrive', () => {
    // `left` and `right` name the identities, not the arrival positions. The
    // comparison walks the bucket sorted by text length, so without an explicit
    // ordering the two sides would swap whenever the longer review happened to
    // come first - and two runs over identical data would disagree.
    const shortText = markNormalised(longText);
    const longer = markNormalised(`${longText} Thanks very much indeed!`);

    const forward = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: shortText }),
        review('b', { author_key: 'k1', text: longer }),
      ],
      0.8,
    );
    const backward = findNearDuplicates(
      [
        review('b', { author_key: 'k1', text: longer }),
        review('a', { author_key: 'k1', text: shortText }),
      ],
      0.8,
    );

    expect(forward.at(0)?.left).toBe(identity('a'));
    expect(forward.at(0)?.right).toBe(identity('b'));
    expect(backward).toEqual(forward);
  });

  it('never prunes a comparison it should have made', () => {
    // The length bound is an optimisation, and an optimisation that changes
    // results is a bug. Two texts of very different lengths cannot reach 0.92,
    // but they can reach 0.3, and the bound must let that through.
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: markNormalised('The coffee was good') }),
        review('b', { author_key: 'k1', text: markNormalised(`The coffee was good. ${longText}`) }),
      ],
      0.3,
    );

    expect(pairs).toHaveLength(1);
  });

  it('handles reviews with no text at all', () => {
    // A photo-only review. Folded to nothing, it produces no bigrams, and the
    // length bound must not prune it into a false match with another empty one.
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: null }),
        review('b', { author_key: 'k1', text: null }),
        review('c', { author_key: 'k1', text: markNormalised(longText) }),
      ],
      0.92,
    );

    // Two empty texts fold to the same string, so they ARE a duplicate pair;
    // the one with text is not similar to either.
    expect(pairs).toHaveLength(1);
    expect(pairs.at(0)?.left).toBe(identity('a'));
    expect(pairs.at(0)?.right).toBe(identity('b'));
  });

  it('skips a record compared against itself when input was not collapsed', () => {
    // `findNearDuplicates` is called on collapsed records inside the merge, but
    // it is exported and must not report a review as its own near-duplicate.
    const one = review('a', { author_key: 'k1', text: markNormalised(longText) });

    expect(findNearDuplicates([one, one], 0.92)).toEqual([]);
  });

  it('orders pairs by author key when several authors match', () => {
    const records = ['k2', 'k1'].flatMap((key, index) => [
      review(`${index}0`, { author_key: key, text: markNormalised(longText) }),
      review(`${index}1`, { author_key: key, text: markNormalised(`${longText} Thanks!`) }),
    ]);

    const pairs = findNearDuplicates(records, 0.92);

    expect(pairs.map((pair) => pair.author_key)).toEqual(['k1', 'k2']);
  });

  it('rounds the reported similarity so two runs produce identical bytes', () => {
    const pairs = findNearDuplicates(
      [
        review('a', { author_key: 'k1', text: markNormalised(longText) }),
        review('b', { author_key: 'k1', text: markNormalised(`${longText} Thanks!`) }),
      ],
      0.92,
    );

    expect(String(pairs.at(0)?.similarity).split('.').at(1)?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
