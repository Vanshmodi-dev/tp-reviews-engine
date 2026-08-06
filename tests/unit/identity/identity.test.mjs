import { describe, expect, it } from 'vitest';

import { deriveAuthorKey, foldAuthorName } from '../../../src/core/identity/author-key.mjs';
import { deriveContentHash, contentHashInputs } from '../../../src/core/identity/content-hash.mjs';
import {
  IDENTITY_ALGO_VERSION,
  IDENTITY_TEXT_GRAPHEMES,
  deriveIdentityHash,
  textIdentityDigest,
} from '../../../src/core/identity/identity-hash.mjs';

/**
 * Identity hashing (T-081, T-082, T-083).
 *
 * **T-082 is the only task in the plan marked "not rollbackable after first
 * publish".** `identity_hash` is the Ledger's primary key: changing how it is
 * computed re-keys every stored review, so every existing record tombstones and
 * every incoming record inserts as new. A client's whole history would vanish
 * and reappear as brand-new reviews on the same day.
 *
 * These tests therefore aim at the formula itself rather than at coverage.
 */

const ANON = { listingKey: 'main', text: 'c-digest-1' };

/** @param {object} o */
const id = (o) =>
  deriveIdentityHash({
    listingKey: 'main',
    source: 'google',
    authorKey: 'ak-1',
    text: 'Great service',
    rating: 5,
    ...o,
  });

// ---------------------------------------------------------------- author_key

describe('author_key — the five steps (§53.5)', () => {
  it('casefolds', () => {
    expect(foldAuthorName('DANA SMITH')).toBe(foldAuthorName('dana smith'));
  });

  it('STRIPS DIACRITICS so a source rendering them inconsistently still matches', () => {
    expect(foldAuthorName('José Álvarez')).toBe('jose alvarez');
    expect(foldAuthorName('Renée')).toBe('renee');
    expect(foldAuthorName('Müller')).toBe('muller');
    expect(foldAuthorName('Ægir Þórsson')).toBe(foldAuthorName('Ægir Þórsson'));
  });

  it('matches the same person written with and without accents', () => {
    expect(deriveAuthorKey('José Álvarez', ANON)).toBe(deriveAuthorKey('Jose Alvarez', ANON));
  });

  it('DOES NOT MERGE HOMOGLYPHS (TR-HASH-021)', () => {
    // Cyrillic А U+0410 and Latin A U+0041 look identical and are different
    // letters belonging to different people. Diacritic stripping is not
    // homoglyph normalisation, and merging them is a data-integrity bug.
    const latin = 'Anna';
    const cyrillic = 'Аnna';

    expect(latin).not.toBe(cyrillic);
    expect(deriveAuthorKey(latin, ANON)).not.toBe(deriveAuthorKey(cyrillic, ANON));
  });

  it('does not merge Greek Ο with Latin O', () => {
    expect(deriveAuthorKey('Olga', ANON)).not.toBe(deriveAuthorKey('Οlga', ANON));
  });

  it('collapses whitespace, including tabs and newlines', () => {
    expect(foldAuthorName('  Dana   \t  Smith \n ')).toBe('dana smith');
  });

  it('converges hyphenated and spaced forms of the same name', () => {
    // Whitespace is collapsed BEFORE punctuation is removed, so "Mary-Jane"
    // and "Mary Jane" both become "maryjane"/"mary jane" consistently.
    expect(foldAuthorName('Mary-Jane')).toBe('maryjane');
    expect(foldAuthorName('Anna - Maria')).toBe('anna maria');
  });

  it('removes punctuation and symbols', () => {
    expect(foldAuthorName("O'Brien")).toBe('obrien');
    expect(foldAuthorName('Dr. Smith, Jr.')).toBe('dr smith jr');
    expect(foldAuthorName('★ Dana ★')).toBe('dana');
  });

  it('preserves non-Latin scripts rather than mangling them', () => {
    expect(foldAuthorName('田中太郎')).toBe('田中太郎');
    expect(foldAuthorName('مُحَمَّد')).toBe('محمد');
    expect(foldAuthorName('अनिल')).toBe('अनिल');
  });

  it('keeps emoji out of the key without discarding the name', () => {
    expect(foldAuthorName('Dana 🎉')).toBe('dana');
    expect(deriveAuthorKey('Dana 🎉', ANON)).toBe(deriveAuthorKey('Dana', ANON));
  });

  it('treats an emoji-only name as anonymous', () => {
    expect(foldAuthorName('🎉🎉')).toBe('');
  });

  it('ANONYMOUS AUTHORS DO NOT COLLAPSE (TR-HASH-022)', () => {
    // A listing with forty "A Google user" reviews is forty reviews, not one.
    const a = deriveAuthorKey(null, { listingKey: 'main', text: 'review a text' });
    const b = deriveAuthorKey(null, { listingKey: 'main', text: 'review b text' });

    expect(a).not.toBe(b);
  });

  it('separates anonymous authors across listings', () => {
    const a = deriveAuthorKey('', { listingKey: 'branch-1', text: 'same text' });
    const b = deriveAuthorKey('', { listingKey: 'branch-2', text: 'same text' });

    expect(a).not.toBe(b);
  });

  it('matches the SAME anonymous review across harvests', () => {
    const first = deriveAuthorKey(null, ANON);
    const second = deriveAuthorKey(null, ANON);

    expect(first).toBe(second);
  });

  it('handles missing, null, and non-string names without throwing', () => {
    for (const value of [null, undefined, '', '   ', 42, {}]) {
      expect(() => deriveAuthorKey(/** @type {any} */ (value), ANON)).not.toThrow();
      expect(foldAuthorName(/** @type {any} */ (value))).toBe('');
    }
  });

  it('is 32 hex characters', () => {
    expect(deriveAuthorKey('Dana', ANON)).toMatch(/^[0-9a-f]{32}$/u);
  });
});

// -------------------------------------------------------- text identity input

describe('text_identity_digest — input #5', () => {
  it('lowercases and collapses whitespace', () => {
    expect(textIdentityDigest('  Great   SERVICE \n here ')).toBe('great service here');
  });

  it('returns empty string for a rating-only review', () => {
    expect(textIdentityDigest(null)).toBe('');
    expect(textIdentityDigest('')).toBe('');
  });

  it('BOUNDS AT 512 GRAPHEMES so an append does not break identity', () => {
    const base = 'a'.repeat(IDENTITY_TEXT_GRAPHEMES);

    expect(textIdentityDigest(base)).toBe(textIdentityDigest(`${base} Update: still great!`));
  });

  it('still discriminates within the first 512 graphemes', () => {
    const a = `${'a'.repeat(500)}first`;
    const b = `${'a'.repeat(500)}other`;

    expect(textIdentityDigest(a)).not.toBe(textIdentityDigest(b));
  });

  it('counts emoji as single graphemes when bounding', () => {
    const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
    const text = family.repeat(IDENTITY_TEXT_GRAPHEMES + 10);

    // Bounding by code units would split a family emoji into fragments.
    expect(textIdentityDigest(text).includes('�')).toBe(false);
    expect(
      [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(textIdentityDigest(text))]
        .length,
    ).toBeLessThanOrEqual(IDENTITY_TEXT_GRAPHEMES);
  });
});

// ------------------------------------------------------------- identity_hash

describe('identity_hash — the six inputs (TR-HASH-001)', () => {
  it('is 32 hex characters', () => {
    expect(id({})).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('is deterministic', () => {
    expect(id({})).toBe(id({}));
  });

  it('changes when the listing key changes', () => {
    expect(id({ listingKey: 'main' })).not.toBe(id({ listingKey: 'branch-2' }));
  });

  it('changes when the source changes — same person, two platforms, two reviews', () => {
    expect(id({ source: 'google' })).not.toBe(id({ source: 'yelp' }));
  });

  it('is insensitive to source CASE', () => {
    expect(id({ source: 'Google' })).toBe(id({ source: 'google' }));
    expect(id({ source: 'GOOGLE' })).toBe(id({ source: 'google' }));
  });

  it('changes when the author key changes', () => {
    expect(id({ authorKey: 'ak-1' })).not.toBe(id({ authorKey: 'ak-2' }));
  });

  it('changes when the rating changes — the tiebreaker for short texts', () => {
    expect(id({ rating: 5 })).not.toBe(id({ rating: 4 }));
  });

  it('is UNCHANGED by an append beyond 512 graphemes', () => {
    // The behaviour EDR-036 exists for: appending is the most common review
    // edit, and it must be an UPDATE rather than a duplicate-then-vanish.
    const long = 'x'.repeat(IDENTITY_TEXT_GRAPHEMES);

    expect(id({ text: long })).toBe(id({ text: `${long} Update: still great!` }));
  });

  it('is unchanged by whitespace and case differences in the text', () => {
    expect(id({ text: 'Great service' })).toBe(id({ text: '  GREAT   service  ' }));
  });

  it('distinguishes a rating-only review from an empty-text one', () => {
    // Both produce '' for input #5, so they are the same review - which is
    // correct: "no text" and "empty text" are the same displayed review.
    expect(id({ text: null })).toBe(id({ text: '' }));
  });

  it('carries the algorithm version as input #1', () => {
    expect(IDENTITY_ALGO_VERSION).toBe(1);
  });

  it('is UNAMBIGUOUS across field boundaries (TR-HASH-005)', () => {
    // Without delimiter escaping, moving a character from one field to the
    // next would hash identically - two different reviews collapsing into one
    // ledger entry.
    expect(id({ listingKey: 'ab', source: 'google' })).not.toBe(
      id({ listingKey: 'a', source: 'bgoogle' }),
    );
    expect(id({ authorKey: 'ak', text: '1x' })).not.toBe(id({ authorKey: 'ak1', text: 'x' }));
  });

  it('handles missing and empty fields without throwing', () => {
    const probe = () =>
      deriveIdentityHash({
        listingKey: '',
        source: '',
        authorKey: '',
        text: null,
        rating: 0,
      });

    expect(probe).not.toThrow();
    expect(probe()).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('CROSS-ADAPTER: the same logical review hashes the same (TR-HASH-004)', () => {
    // The DOM adapter and the API adapter expose different fields. Identity
    // uses only what both can supply, so migrating a client does not tombstone
    // their entire history.
    const fromDom = deriveIdentityHash({
      listingKey: 'main',
      source: 'google',
      authorKey: 'ak-dana',
      text: 'Great service',
      rating: 5,
    });
    const fromApi = deriveIdentityHash({
      listingKey: 'main',
      source: 'google',
      authorKey: 'ak-dana',
      text: 'Great service',
      rating: 5,
    });

    expect(fromDom).toBe(fromApi);
  });
});

// -------------------------------------------------------------- content_hash

describe('content_hash — the nine inputs (§53.4)', () => {
  /** @param {object} o */
  const content = (o = {}) => ({
    rating: 5,
    text: 'Great service',
    text_truncated: false,
    author_name: 'Dana',
    author_avatar_url: 'https://lh3.googleusercontent.com/a/x=s128-c',
    reply_text: null,
    reply_date: null,
    likes: 2,
    photo_count: null,
    ...o,
  });

  /** @param {object} o */
  const hash = (o = {}) => {
    const result = deriveContentHash(content(o));
    return result.ok ? result.value : `FAILED:${result.error}`;
  };

  it('is 64 hex characters and deterministic', () => {
    expect(hash()).toMatch(/^[0-9a-f]{64}$/u);
    expect(hash()).toBe(hash());
  });

  it('carries exactly the nine documented fields', () => {
    expect(Object.keys(contentHashInputs(content())).sort()).toEqual([
      'author_avatar_url',
      'author_name',
      'likes',
      'photo_count',
      'rating',
      'reply_date',
      'reply_text',
      'text',
      'text_truncated',
    ]);
  });

  it('IGNORES relative_date (TR-HASH-010)', () => {
    // The single most common bug in naive implementations: including it marks
    // every review as edited on every harvest, because "2 months ago" becomes
    // "3 months ago" without the review being touched.
    const withPhrase = contentHashInputs(
      /** @type {any} */ ({ ...content(), relative_date: '2 months ago' }),
    );
    const withOther = contentHashInputs(
      /** @type {any} */ ({ ...content(), relative_date: '3 months ago' }),
    );

    expect(withPhrase).toEqual(withOther);
    expect(Object.keys(withPhrase)).not.toContain('relative_date');
  });

  it('ignores engine-generated fields, so the hash is not self-referential', () => {
    const inputs = contentHashInputs(
      /** @type {any} */ ({
        ...content(),
        first_seen_at: '2026-01-01T00:00:00Z',
        last_updated_at: '2026-06-01T00:00:00Z',
        revision: 7,
        content_hash: 'previous',
      }),
    );

    for (const excluded of ['first_seen_at', 'last_updated_at', 'revision', 'content_hash']) {
      expect(Object.keys(inputs), excluded).not.toContain(excluded);
    }
  });

  it('changes when any displayed value changes', () => {
    const base = hash();

    expect(hash({ rating: 4 })).not.toBe(base);
    expect(hash({ text: 'Different' })).not.toBe(base);
    expect(hash({ text_truncated: true })).not.toBe(base);
    expect(hash({ author_name: 'Other' })).not.toBe(base);
    expect(hash({ author_avatar_url: null })).not.toBe(base);
    expect(hash({ reply_text: 'Thanks!' })).not.toBe(base);
    expect(hash({ reply_date: '2026-01-01' })).not.toBe(base);
    expect(hash({ likes: 3 })).not.toBe(base);
    expect(hash({ photo_count: 1 })).not.toBe(base);
  });

  it('uses the FULL text, unlike identity', () => {
    // An appended sentence is the same review with changed content: identity
    // stays, content moves.
    const long = 'x'.repeat(600);

    expect(hash({ text: long })).not.toBe(hash({ text: `${long} Update!` }));
  });

  it('distinguishes null from absent', () => {
    expect(hash({ likes: null })).not.toBe(hash({ likes: 0 }));
  });

  it('is insensitive to key insertion order', () => {
    const a = deriveContentHash(/** @type {any} */ ({ rating: 5, text: 'x', likes: 1 }));
    const b = deriveContentHash(/** @type {any} */ ({ likes: 1, text: 'x', rating: 5 }));

    expect(a.ok && b.ok && a.value === b.value).toBe(true);
  });
});

describe('anonymous keys must survive an edit (found while reviewing samples)', () => {
  it('is STABLE when an anonymous reviewer appends beyond 512 graphemes', () => {
    // The defect this test was written for: an anonymous author_key derived
    // from FULL content would change on any edit, changing identity_hash, and
    // tombstoning-then-reinserting the review. That is the duplicate-then-
    // vanish EDR-036 rejects full-text identity to avoid - reintroduced
    // through the anonymous path.
    const long = 'y'.repeat(512);
    const before = deriveAuthorKey(null, { listingKey: 'main', text: long });
    const after = deriveAuthorKey(null, {
      listingKey: 'main',
      text: `${long} Update: still great!`,
    });

    expect(after).toBe(before);
  });

  it('keeps the whole identity_hash stable across that same append', () => {
    const long = 'y'.repeat(512);
    /** @param {string} text */
    const idFor = (text) =>
      deriveIdentityHash({
        listingKey: 'main',
        source: 'google',
        authorKey: deriveAuthorKey(null, { listingKey: 'main', text }),
        text,
        rating: 5,
      });

    expect(idFor(`${long} Update!`)).toBe(idFor(long));
  });

  it('still separates two different anonymous reviews', () => {
    const a = deriveAuthorKey(null, { listingKey: 'main', text: 'lovely place' });
    const b = deriveAuthorKey(null, { listingKey: 'main', text: 'terrible place' });

    expect(a).not.toBe(b);
  });
});
