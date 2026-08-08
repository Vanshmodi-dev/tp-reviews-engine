import { describe, expect, it } from 'vitest';

import { checkStatsConsistency } from '../../../src/core/model/payload.mjs';
import { computeCoverage, computeStats, hasText } from '../../../src/core/project/stats.mjs';
import { selectPublishable } from '../../../src/core/project/payload.mjs';
import { ledgerOf, review } from '../../helpers/project-input.mjs';

/**
 * @param {ReadonlyArray<any>} reviews
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const statsOf = (reviews, overrides = {}) =>
  computeStats({
    published: selectPublishable(ledgerOf(reviews)),
    advertisedTotal: null,
    advertisedRating: null,
    completeness: 'full',
    lastFullHarvestAt: null,
    ...overrides,
  });

describe('counts are never inflated (PROJ-04, TR-PROJ-030)', () => {
  it('never substitutes advertised_total for total_count', () => {
    // The specific dishonesty this product exists to avoid: a client's page
    // claiming 247 reviews while the engine holds 3.
    const stats = statsOf([review(1), review(2), review(3)], { advertisedTotal: 247 });

    expect(stats.total_count).toBe(3);
    expect(stats.advertised_total).toBe(247);
  });

  it('never substitutes advertised_rating for mean_rating', () => {
    const stats = statsOf([review(1, { rating: 1 }), review(2, { rating: 1 })], {
      advertisedRating: 4.9,
    });

    expect(stats.mean_rating).toBe(1);
    expect(stats.advertised_rating).toBe(4.9);
  });

  it('publishes both side by side so divergence is visible', () => {
    // TR-PROJ-031. Divergence means coverage is incomplete or extraction is
    // wrong, and a monitoring check must see that without internals.
    const stats = statsOf([review(1, { rating: 3 })], {
      advertisedTotal: 100,
      advertisedRating: 4.8,
    });

    expect(stats).toMatchObject({
      total_count: 1,
      advertised_total: 100,
      mean_rating: 3,
      advertised_rating: 4.8,
    });
  });
});

describe('arithmetic', () => {
  it('computes the mean to two decimal places', () => {
    const stats = statsOf([
      review(1, { rating: 5 }),
      review(2, { rating: 4 }),
      review(3, { rating: 4 }),
    ]);

    expect(stats.mean_rating).toBe(4.33);
  });

  it('builds a distribution that sums to total_count', () => {
    const stats = statsOf([
      review(1, { rating: 5 }),
      review(2, { rating: 5 }),
      review(3, { rating: 1 }),
    ]);

    expect(stats.distribution).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 2 });
    expect(checkStatsConsistency(stats)).toEqual([]);
  });

  it('keeps every rating key present even when unused', () => {
    // A missing key makes a consumer's star bar fall back to undefined and draw
    // nothing, which reads as a bug on the client's site.
    expect(Object.keys(statsOf([]).distribution)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('reports a mean of zero when nothing is rated', () => {
    expect(statsOf([]).mean_rating).toBe(0);
  });

  it('ignores an out-of-range rating rather than counting it', () => {
    const stats = statsOf([review(1, { rating: 9 }), review(2, { rating: 4 })]);

    expect(stats.mean_rating).toBe(4);
    expect(checkStatsConsistency(stats)[0]).toContain('distribution sums to 1');
  });

  it('ignores a null rating in the mean', () => {
    const stats = statsOf([review(1, { rating: null }), review(2, { rating: 4 })]);

    expect(stats.mean_rating).toBe(4);
  });

  it('counts reviews with text and with replies', () => {
    const stats = statsOf([
      review(1, { text: 'Lovely' }),
      review(2, { text: null }),
      review(3, { text: 'Good', owner_reply: { text: 'Thanks' } }),
    ]);

    expect(stats.with_text_count).toBe(2);
    expect(stats.with_reply_count).toBe(1);
  });

  it('reports the newest and oldest pinned dates', () => {
    const stats = statsOf([
      review(1, { date_estimated: '2025-01-01T00:00:00.000Z' }),
      review(2, { date_estimated: '2026-06-01T00:00:00.000Z' }),
      review(3, { date_estimated: '2025-08-01T00:00:00.000Z' }),
    ]);

    expect(stats.newest_review_date).toBe('2026-06-01T00:00:00.000Z');
    expect(stats.oldest_review_date).toBe('2025-01-01T00:00:00.000Z');
  });

  it('reports null dates when no estimate exists', () => {
    const stats = statsOf([review(1, { date_estimated: null })]);

    expect(stats.newest_review_date).toBeNull();
    expect(stats.oldest_review_date).toBeNull();
  });
});

describe('languages', () => {
  it('counts per detected code', () => {
    const stats = statsOf([
      review(1, { language: 'en' }),
      review(2, { language: 'fr' }),
      review(3, { language: 'en' }),
    ]);

    expect(stats.languages).toEqual({ en: 2, fr: 1 });
  });

  it('excludes null rather than bucketing it as a language', () => {
    // "We could not tell" is not a language. Bucketing it would let an adapter
    // with broken detection report a confident-looking distribution.
    const stats = statsOf([review(1, { language: null }), review(2, { language: '' })]);

    expect(stats.languages).toEqual({});
  });

  it('orders keys deterministically', () => {
    // Insertion order follows harvest order, which is unstable. Two runs would
    // serialise the same object into different bytes (TR-PROJ-012).
    const forward = statsOf([review(1, { language: 'zu' }), review(2, { language: 'ar' })]);
    const backward = statsOf([review(1, { language: 'ar' }), review(2, { language: 'zu' })]);

    expect(Object.keys(forward.languages)).toEqual(['ar', 'zu']);
    expect(JSON.stringify(forward.languages)).toBe(JSON.stringify(backward.languages));
  });
});

describe('computeCoverage', () => {
  it('is the ratio of held to advertised', () => {
    expect(computeCoverage(80, 100)).toBe(0.8);
  });

  it('is null when the advertised total is unknown or zero', () => {
    // Dividing by it would produce Infinity or NaN, neither of which a consumer
    // can interpret from JSON.
    expect(computeCoverage(80, null)).toBeNull();
    expect(computeCoverage(80, 0)).toBeNull();
  });

  it('is NOT clamped to 1', () => {
    // Holding more than the source currently advertises is real and
    // informative: it happens when reviews are removed at the source but are
    // still inside our confirmation window. Clamping hides what G-12 watches.
    expect(computeCoverage(120, 100)).toBe(1.2);
  });

  it('rounds to four places', () => {
    expect(computeCoverage(1, 3)).toBe(0.3333);
  });
});

describe('hasText', () => {
  it('is false for null, empty and whitespace-only text', () => {
    expect(hasText({ text: null })).toBe(false);
    expect(hasText({ text: '' })).toBe(false);
    expect(hasText({ text: '   ' })).toBe(false);
    expect(hasText({})).toBe(false);
  });

  it('is true for real text', () => {
    expect(hasText({ text: 'Good' })).toBe(true);
  });
});

describe('freshness and completeness pass through', () => {
  it('carries the harvest completeness and last full harvest', () => {
    const stats = statsOf([review(1)], {
      completeness: 'partial',
      lastFullHarvestAt: '2026-02-01T00:00:00.000Z',
    });

    expect(stats.completeness).toBe('partial');
    expect(stats.last_full_harvest_at).toBe('2026-02-01T00:00:00.000Z');
  });
});
