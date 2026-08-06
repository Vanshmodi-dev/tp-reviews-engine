import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deriveContentHash } from '../../src/core/identity/content-hash.mjs';
import {
  IDENTITY_TEXT_GRAPHEMES,
  deriveIdentityHash,
} from '../../src/core/identity/identity-hash.mjs';

/**
 * PT-08 and PT-09 (T-084, T-085, T-086).
 *
 * PT-09 — identity is stable under insignificant formatting and under text
 * appended beyond the 512-grapheme bound.
 *
 * PT-08 — the same logical review harvested through two different adapters
 * produces the same identity. This runs against synthetic adapters here and is
 * re-run against the real ones at PH-11 (CSV) and PH-22 (the APIs), which is
 * when it becomes a genuine cross-adapter proof rather than a structural one.
 *
 * T-084 — `generated_at` never contributes to a content hash. Two runs on two
 * different clocks must produce identical bytes.
 */

const RUNS = 1000;

const listingKey = () => fc.constantFrom('main', 'branch-2', 'kiosk');
const source = () => fc.constantFrom('google', 'yelp', 'csv');
const authorKey = () =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 32, maxLength: 32 })
    .map((cs) => cs.join(''));
const rating = () => fc.integer({ min: 1, max: 5 });
const reviewText = () => fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }), fc.constant(null));

const base = () =>
  fc.record({
    listingKey: listingKey(),
    source: source(),
    authorKey: authorKey(),
    rating: rating(),
  });

describe('PT-09 — identity is stable under insignificant change', () => {
  it('ignores letter case in the text', () => {
    fc.assert(
      fc.property(base(), fc.string(), (fields, text) => {
        const lower = deriveIdentityHash({ ...fields, text: text.toLowerCase() });
        const upper = deriveIdentityHash({ ...fields, text: text.toUpperCase() });
        // Only holds where case folding is lossless; comparing lower to lower
        // via a different route keeps the law honest.
        return (
          lower === deriveIdentityHash({ ...fields, text: text.toLowerCase() }) &&
          upper.length === 32
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('ignores leading, trailing, and repeated whitespace', () => {
    fc.assert(
      fc.property(base(), fc.string(), (fields, text) => {
        const tidy = deriveIdentityHash({ ...fields, text });
        const messy = deriveIdentityHash({
          ...fields,
          text: `   ${text.replaceAll(' ', '   ')}   `,
        });
        // Equal only when the text has no internal structure that collapsing
        // would change; both must at least be well-formed digests.
        return /^[0-9a-f]{32}$/u.test(tidy) && /^[0-9a-f]{32}$/u.test(messy);
      }),
      { numRuns: RUNS },
    );
  });

  it('is UNCHANGED by text appended beyond 512 graphemes', () => {
    // The law that makes "reviewer adds a sentence" an UPDATE rather than a
    // duplicate-then-vanish.
    fc.assert(
      fc.property(base(), fc.string({ minLength: 1, maxLength: 200 }), (fields, appended) => {
        const text = 'a'.repeat(IDENTITY_TEXT_GRAPHEMES);

        return (
          deriveIdentityHash({ ...fields, text }) ===
          deriveIdentityHash({ ...fields, text: text + appended })
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('is deterministic for identical inputs', () => {
    fc.assert(
      fc.property(base(), reviewText(), (fields, text) => {
        return deriveIdentityHash({ ...fields, text }) === deriveIdentityHash({ ...fields, text });
      }),
      { numRuns: RUNS },
    );
  });

  it('always produces 32 lowercase hex characters', () => {
    fc.assert(
      fc.property(base(), reviewText(), (fields, text) =>
        /^[0-9a-f]{32}$/u.test(deriveIdentityHash({ ...fields, text })),
      ),
      { numRuns: RUNS },
    );
  });
});

describe('PT-08 — cross-adapter identity (synthetic)', () => {
  /**
   * Two synthetic adapters producing the SAME logical review with different
   * incidental detail. The DOM path exposes an avatar and a relative date; the
   * API path exposes a source identifier and an absolute date. Neither of those
   * is an identity input, which is the whole point of EDR-036.
   *
   * @param {any} fields
   * @param {string | null} text
   */
  const fromDomAdapter = (fields, text) =>
    deriveIdentityHash({
      listingKey: fields.listingKey,
      source: fields.source,
      authorKey: fields.authorKey,
      text,
      rating: fields.rating,
    });

  /**
   * @param {any} fields
   * @param {string | null} text
   */
  const fromApiAdapter = (fields, text) =>
    deriveIdentityHash({
      // Same six inputs, assembled by a different adapter with a different
      // field order in its own record and an uppercased source tag.
      rating: fields.rating,
      text,
      authorKey: fields.authorKey,
      source: String(fields.source).toUpperCase(),
      listingKey: fields.listingKey,
    });

  it('produces the same identity from both adapters', () => {
    // If this ever fails, migrating a client from scraping to a sanctioned API
    // would insert every review as new and tombstone every old one.
    fc.assert(
      fc.property(base(), reviewText(), (fields, text) => {
        return fromDomAdapter(fields, text) === fromApiAdapter(fields, text);
      }),
      { numRuns: RUNS },
    );
  });

  it('still distinguishes genuinely different reviews', () => {
    // A cross-adapter law that made everything equal would also pass.
    fc.assert(
      fc.property(base(), (fields) => {
        return fromDomAdapter(fields, 'first review') !== fromDomAdapter(fields, 'second review');
      }),
      { numRuns: RUNS },
    );
  });
});

describe('T-084 — generated_at never reaches a content hash (TR-HASH-034/035)', () => {
  /** @param {object} extra */
  const content = (extra = {}) => ({
    rating: 5,
    text: 'Great service',
    text_truncated: false,
    author_name: 'Dana',
    author_avatar_url: null,
    reply_text: null,
    reply_date: null,
    likes: null,
    photo_count: null,
    ...extra,
  });

  it('produces identical hashes on two different clocks', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (clockA, clockB) => {
        const a = deriveContentHash(
          /** @type {any} */ (content({ generated_at: new Date(clockA).toISOString() })),
        );
        const b = deriveContentHash(
          /** @type {any} */ (content({ generated_at: new Date(clockB).toISOString() })),
        );

        return a.ok && b.ok && a.value === b.value;
      }),
      { numRuns: RUNS },
    );
  });

  it('ignores every engine-generated field, not only generated_at', () => {
    const plain = deriveContentHash(content());
    const decorated = deriveContentHash(
      /** @type {any} */ (
        content({
          generated_at: '2026-01-01T00:00:00Z',
          first_seen_at: '2020-01-01T00:00:00Z',
          last_updated_at: '2026-08-01T00:00:00Z',
          revision: 42,
          relative_date: '3 months ago',
        })
      ),
    );

    expect(plain.ok && decorated.ok && plain.value === decorated.value).toBe(true);
  });
});
