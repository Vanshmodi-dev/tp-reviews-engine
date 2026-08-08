import { describe, expect, it } from 'vitest';

import {
  applyDisplayFilters,
  DISPLAY_DEFAULTS,
  passesDisplayFilters,
  resolveDisplay,
} from '../../../src/core/project/filters.mjs';
import { projectLatest, projectStatsArtifact } from '../../../src/core/project/latest.mjs';
import { datePublishable, projectSchemaOrg } from '../../../src/core/project/schema-org.mjs';
import {
  canonicalise,
  hashableBytes,
  serialiseLedger,
  serialisePayload,
} from '../../../src/core/project/serialise.mjs';
import { projectArtifacts, sealArtifact } from '../../../src/core/project/index.mjs';
import { projectPayload, selectPublishable } from '../../../src/core/project/payload.mjs';
import { config, ledgerOf, projectInput, review } from '../../helpers/project-input.mjs';

describe('display filters (TRD §24.4)', () => {
  const display = (/** @type {any} */ overrides = {}) => resolveDisplay(overrides);
  const recordFor = (/** @type {any} */ overrides) =>
    selectPublishable(ledgerOf([review(1, overrides)]))[0];

  it('defaults min_rating to null (TR-PROJ-020)', () => {
    // The product position is that TradyPerch declines to filter out low
    // ratings. Setting this triggers validation rule V-8 and a written
    // justification.
    expect(DISPLAY_DEFAULTS.min_rating).toBeNull();
  });

  it('keeps a one-star review by default', () => {
    expect(passesDisplayFilters(recordFor({ rating: 1 }), display())).toBe(true);
  });

  it('excludes below min_rating when explicitly configured', () => {
    expect(passesDisplayFilters(recordFor({ rating: 2 }), display({ min_rating: 3 }))).toBe(false);
    expect(passesDisplayFilters(recordFor({ rating: 3 }), display({ min_rating: 3 }))).toBe(true);
  });

  it('excludes an unrated review when min_rating is set', () => {
    expect(passesDisplayFilters(recordFor({ rating: null }), display({ min_rating: 3 }))).toBe(
      false,
    );
  });

  it('applies min_text_length only to reviews that have text', () => {
    // Conflating this with include_rating_only would make min_text_length: 1
    // silently drop every rating-only review, which is a different policy.
    const short = recordFor({ text: 'ok' });
    const none = recordFor({ text: null });

    expect(passesDisplayFilters(short, display({ min_text_length: 10 }))).toBe(false);
    expect(passesDisplayFilters(none, display({ min_text_length: 10 }))).toBe(true);
  });

  it('honours include_rating_only', () => {
    const none = recordFor({ text: null });

    expect(passesDisplayFilters(none, display())).toBe(true);
    expect(passesDisplayFilters(none, display({ include_rating_only: false }))).toBe(false);
  });

  it('restricts by language when a list is given', () => {
    expect(
      passesDisplayFilters(recordFor({ language: 'fr' }), display({ languages: ['en'] })),
    ).toBe(false);
    expect(
      passesDisplayFilters(recordFor({ language: 'fr' }), display({ languages: ['en', 'fr'] })),
    ).toBe(true);
  });

  it('treats null languages as all languages', () => {
    expect(passesDisplayFilters(recordFor({ language: 'zu' }), display())).toBe(true);
  });

  it('counts text length in graphemes, not code units', () => {
    const emoji = recordFor({ text: '👨‍👩‍👧‍👦' });

    expect(passesDisplayFilters(emoji, display({ min_text_length: 2 }))).toBe(false);
  });

  it('lets an explicit null override a default, but not undefined', () => {
    expect(resolveDisplay({ languages: undefined }).languages).toBeNull();
    expect(resolveDisplay({ order: undefined }).order).toBe('newest');
    expect(resolveDisplay({ min_rating: null }).min_rating).toBeNull();
    expect(resolveDisplay().latest_count).toBe(20);
  });

  it('filters a set', () => {
    const records = selectPublishable(
      ledgerOf([review(1, { rating: 1 }), review(2, { rating: 5 })]),
    );

    expect(applyDisplayFilters(records, display({ min_rating: 3 }))).toHaveLength(1);
  });
});

describe('the latest artifact recomputes nothing (T-118)', () => {
  const base = projectPayload(
    projectInput({ ledger: ledgerOf(Array.from({ length: 30 }, (_, i) => review(i))) }),
  );

  it('is the head of the same ordered payload', () => {
    const latest = projectLatest(base, { latest_count: 5 });

    expect(latest.reviews).toHaveLength(5);
    expect(latest.reviews).toEqual(base.reviews.slice(0, 5));
  });

  it('carries the WHOLE listing stats, not stats over the slice', () => {
    // Otherwise a badge reads "4.9 from 20" because the twenty newest happen to
    // be the good ones, while the full payload on the same page says 4.2 from
    // 180. The number a visitor sees would depend on which file loaded.
    const latest = projectLatest(base, { latest_count: 5 });

    expect(latest.stats).toBe(base.stats);
    expect(latest.stats.total_count).toBe(30);
  });

  it('defaults to twenty', () => {
    expect(projectLatest(base).reviews).toHaveLength(20);
  });

  it('is marked as its own artifact kind', () => {
    expect(projectLatest(base).artifact).toBe('latest');
  });
});

describe('the stats artifact omits reviews entirely', () => {
  const base = projectPayload(projectInput());
  const statsArtifact = projectStatsArtifact(base);

  it('has no reviews key at all', () => {
    // An empty array says "we published nothing"; absence says "this artifact
    // is not about individual reviews". A badge rendered from an empty array
    // would show a zero state for a listing that has reviews.
    expect(Object.hasOwn(statsArtifact, 'reviews')).toBe(false);
    expect(Object.hasOwn(statsArtifact, 'pagination')).toBe(false);
  });

  it('keeps the aggregates', () => {
    expect(statsArtifact.stats.total_count).toBe(3);
    expect(statsArtifact.artifact).toBe('stats');
  });
});

describe('schema.org is off by default (TR-PROJ-040)', () => {
  const base = projectPayload(projectInput());

  it('returns null unless explicitly opted in', () => {
    // Emitting markup that violates a search engine's policy can cause a manual
    // action against the CLIENT's site. The engine must not cause that by
    // default, and must not cause it silently.
    expect(projectSchemaOrg(base)).toBeNull();
    expect(projectSchemaOrg(base, {})).toBeNull();
    expect(projectSchemaOrg(base, { schema_org: false })).toBeNull();
    expect(projectSchemaOrg(base, { schema_org: 'yes' })).toBeNull();
  });

  it('emits markup when opted in', () => {
    const markup = markupOf(base);

    expect(markup['@type']).toBe('LocalBusiness');
    expect(markup.review).toHaveLength(3);
  });

  it('never inflates reviewCount with advertised_total', () => {
    const markup = markupOf(base);

    expect(markup.aggregateRating.reviewCount).toBe(3);
    expect(base.stats.advertised_total).toBe(100);
  });

  it('omits aggregateRating entirely when nothing is published', () => {
    // A value of 0 renders as a one-star business in a search result.
    const empty = projectPayload(projectInput({ ledger: ledgerOf([]) }));

    expect(markupOf(empty).aggregateRating).toBeUndefined();
  });

  it('emits datePublished only for day or week precision', () => {
    // A wrong date in structured data is worse than an absent one: consumers
    // treat it as authoritative.
    expect(datePublishable({ date: '2026-01-01T00:00:00.000Z', date_precision: 'day' })).toBe(true);
    expect(datePublishable({ date: '2026-01-01T00:00:00.000Z', date_precision: 'week' })).toBe(
      true,
    );
    expect(datePublishable({ date: '2026-01-01T00:00:00.000Z', date_precision: 'month' })).toBe(
      false,
    );
    expect(datePublishable({ date: null, date_precision: 'day' })).toBe(false);
    expect(datePublishable({ date: '2026-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('omits datePublished for a month-precision review', () => {
    const ledger = ledgerOf([review(1, { date_precision: 'month' })]);
    const payload = projectPayload(projectInput({ ledger }));
    const markup = markupOf(payload);

    expect(Object.hasOwn(markup.review[0], 'datePublished')).toBe(false);
  });

  it('emits a date for a day-precision review', () => {
    const ledger = ledgerOf([review(1, { date_precision: 'day' })]);
    const payload = projectPayload(projectInput({ ledger }));
    const markup = markupOf(payload);

    expect(markup.review[0].datePublished).toBe('2026-01-15');
  });

  it('falls back through name, initials, then Anonymous', () => {
    const ledger = ledgerOf([
      review(1, { author: { name: null, initials: 'DS' } }),
      review(2, { author: { name: null, initials: null } }),
    ]);
    const payload = projectPayload(projectInput({ ledger }));
    const markup = markupOf(payload);
    const names = markup.review.map((/** @type {any} */ r) => r.author.name);

    expect(names).toContain('DS');
    expect(names).toContain('Anonymous');
  });

  it('omits reviewBody when there is no text', () => {
    const ledger = ledgerOf([review(1, { text: null })]);
    const payload = projectPayload(projectInput({ ledger }));
    const markup = markupOf(payload);

    expect(Object.hasOwn(markup.review[0], 'reviewBody')).toBe(false);
  });

  it('omits url when the listing has none', () => {
    const bare = projectPayload(
      projectInput({ config: config({ listing: { ...config().listing, source_url: null } }) }),
    );

    expect(Object.hasOwn(markupOf(bare), 'url')).toBe(false);
  });
});

describe('canonical serialisation (EDR-021, PROJ-02)', () => {
  it('orders object keys regardless of insertion order', () => {
    expect(serialisePayload({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(serialisePayload({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('orders nested keys too', () => {
    expect(serialisePayload({ z: { d: 1, c: 2 } })).toBe('{"z":{"c":2,"d":1}}');
  });

  it('leaves array order alone, because it is the publication order', () => {
    expect(serialisePayload({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });

  it('minifies payloads and pretty-prints ledgers with a trailing newline', () => {
    expect(serialisePayload({ a: 1 })).toBe('{"a":1}');
    expect(serialiseLedger({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('handles primitives and null', () => {
    expect(canonicalise(null)).toBeNull();
    expect(canonicalise(5)).toBe(5);
    expect(canonicalise('x')).toBe('x');
    expect(canonicalise([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });

  it('excludes generated_at from the hashable bytes (EDR-022, PROJ-03)', () => {
    const one = { artifact: 'reviews', generated_at: '2026-01-01T00:00:00.000Z', n: 1 };
    const two = { artifact: 'reviews', generated_at: '2027-09-09T00:00:00.000Z', n: 1 };

    expect(hashableBytes(one)).toBe(hashableBytes(two));
    expect(serialisePayload(one)).not.toBe(serialisePayload(two));
  });
});

describe('the artifact set and its manifest (T-121)', () => {
  const artifacts = projectArtifacts(projectInput());

  it('produces reviews, latest, stats and an index', () => {
    expect(artifacts.reviews.payload.artifact).toBe('reviews');
    expect(artifacts.latest.payload.artifact).toBe('latest');
    expect(artifacts.stats.payload.artifact).toBe('stats');
    expect(artifacts.index.payload.artifact).toBe('index');
  });

  it('omits schema.org unless opted in', () => {
    expect(artifacts.schemaOrg).toBeNull();

    const optedIn = projectArtifacts(
      projectInput({ config: config({ publish: { schema_org: true } }) }),
    );

    expect(optedIn.schemaOrg).not.toBeNull();
    expect(optedIn.index.payload.artifacts.schemaOrg).toBeDefined();
  });

  it('carries every artifact hash in the index — the freshness pointer', () => {
    // Consumers read index.json (short TTL) then fetch what it names (long
    // TTL). That gives freshness and cacheability with no cache-purge
    // capability, which the zero-cost hosting does not offer.
    for (const name of ['reviews', 'latest', 'stats']) {
      expect(artifacts.index.payload.artifacts[name].content_hash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('seals the content hash into provenance', () => {
    expect(artifacts.reviews.payload.provenance.content_hash).toBe(artifacts.reviews.contentHash);
  });

  it('gives different artifacts different hashes', () => {
    expect(artifacts.reviews.contentHash).not.toBe(artifacts.latest.contentHash);
  });

  it('produces bytes that parse back to the sealed payload', () => {
    expect(JSON.parse(artifacts.reviews.bytes)).toEqual(artifacts.reviews.payload);
  });

  it('hashes over the sealed shape, so sealing is stable', () => {
    const once = sealArtifact(projectPayload(projectInput()));
    const twice = sealArtifact(projectPayload(projectInput()));

    expect(twice.contentHash).toBe(once.contentHash);
  });
});

/**
 * The schema.org markup for an opted-in payload.
 *
 * Asserts it is present rather than reaching through `?.`: these tests are
 * about the opted-in case, and a null slipping through would make every
 * assertion below compare undefined against undefined and pass.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function markupOf(payload) {
  const markup = projectSchemaOrg(payload, { schema_org: true });

  if (markup === null) throw new Error('expected schema.org markup for an opted-in payload');

  return markup;
}
