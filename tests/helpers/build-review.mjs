import { markNormalised } from '../../src/core/model/review.mjs';

/**
 * Builds a valid `NormalizedReview` (TR-TEST-033).
 *
 * Deferred from T-042 in PH-00 because the record shape did not exist yet —
 * writing a builder for fields that had not been defined would have meant
 * inventing them, and every later test would have inherited the invention. The
 * shape landed with `core/model/review.mjs` in PH-01, so the builder lands now.
 *
 * Every default is a plausible value from a real listing, and every one is
 * overridable. A builder whose defaults are edge cases makes every test that
 * uses it accidentally an edge-case test.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function buildNormalizedReview(overrides = {}) {
  return {
    identity_hash: 'a'.repeat(32),
    content_hash: 'c'.repeat(64),
    author_key: 'b'.repeat(32),
    author: {
      name: markNormalised('Dana Smith'),
      initials: 'DS',
      avatar_url: null,
      profile_url: null,
      is_local_guide: null,
      review_count_hint: null,
    },
    rating: 5,
    text: markNormalised('The staff were lovely and the service was quick.'),
    text_truncated: false,
    text_clipped: false,
    date_estimated: '2026-01-15T00:00:00.000Z',
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
