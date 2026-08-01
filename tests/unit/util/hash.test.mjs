import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  escapeForHash,
  hashObject,
  identityDigest,
  joinForHash,
  sha256Hex,
} from '../../../src/core/util/hash.mjs';

/**
 * Everything the engine decides about *change* rests on this file. Hash-gating
 * compares canonical bytes to decide whether a file is written at all
 * (TR-HASH-030), and its silent failure is a fifteen-fold repository growth
 * event that nobody notices for a month.
 */

/** @param {import('../../../src/core/util/result.mjs').Result<string, string>} r */
const value = (r) => (r.ok ? r.value : `FAILED:${r.error}`);

describe('canonical serialisation (T-048)', () => {
  it('produces identical bytes for the same object built in a different key order', () => {
    // This is T-048's stated acceptance criterion.
    const a = { alpha: 1, beta: 2, gamma: 3 };
    /** @type {Record<string, number>} */
    const b = {};
    b.gamma = 3;
    b.alpha = 1;
    b.beta = 2;

    expect(value(canonicalize(a))).toBe(value(canonicalize(b)));
  });

  it('sorts keys at every depth, not just the top level', () => {
    const nested = { z: { y: 1, x: 2 }, a: { c: 3, b: 4 } };

    expect(value(canonicalize(nested))).toBe('{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}');
  });

  it('emits no insignificant whitespace', () => {
    expect(value(canonicalize({ a: [1, 2], b: 'x' }))).toBe('{"a":[1,2],"b":"x"}');
  });

  it('PRESERVES array order', () => {
    // Sorting arrays would make [a,b] and [b,a] hash identically. Review order
    // is meaningful: a reordered payload is a changed payload.
    expect(value(canonicalize([3, 1, 2]))).toBe('[3,1,2]');
    expect(value(canonicalize([1, 2, 3]))).not.toBe(value(canonicalize([3, 2, 1])));
  });

  it('distinguishes an absent property from a null one', () => {
    // The payload contract treats these differently, so they must hash
    // differently. This is what exactOptionalPropertyTypes is protecting.
    expect(value(canonicalize({ a: 1 }))).not.toBe(value(canonicalize({ a: 1, b: null })));
    expect(value(canonicalize({ a: 1, b: undefined }))).toBe(value(canonicalize({ a: 1 })));
  });

  it('keeps an undefined array slot as null so length is preserved', () => {
    expect(value(canonicalize([1, undefined, 3]))).toBe('[1,null,3]');
  });

  it('escapes strings rather than emitting them raw', () => {
    expect(value(canonicalize({ 'a"b': 'c\nd' }))).toBe('{"a\\"b":"c\\nd"}');
  });

  it('handles the empty cases', () => {
    expect(value(canonicalize({}))).toBe('{}');
    expect(value(canonicalize([]))).toBe('[]');
    expect(value(canonicalize(null))).toBe('null');
  });

  it('rejects values JSON.stringify would silently corrupt', () => {
    // JSON.stringify turns these into null, which would make two genuinely
    // different payloads hash identically - a wrong "unchanged" verdict.
    expect(canonicalize({ n: Number.NaN }).ok).toBe(false);
    expect(canonicalize({ n: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(canonicalize({ n: Number.NEGATIVE_INFINITY }).ok).toBe(false);
  });

  it('rejects values that cannot round-trip at all', () => {
    expect(canonicalize({ f: () => 1 }).ok).toBe(false);
    expect(canonicalize({ s: Symbol('x') }).ok).toBe(false);
    expect(canonicalize({ b: 1n }).ok).toBe(false);
  });

  it('rejects a cycle instead of overflowing the stack', () => {
    /** @type {Record<string, unknown>} */
    const cyclic = { a: 1 };
    cyclic.self = cyclic;

    const result = canonicalize(cyclic);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('ERR-INTERNAL-INVARIANT');
  });

  it('allows the same object twice when it is not a cycle', () => {
    // A shared reference is not a cycle. Rejecting it would break any structure
    // that reuses a value, which ledgers do constantly.
    const shared = { x: 1 };

    expect(canonicalize({ a: shared, b: shared }).ok).toBe(true);
  });

  it('returns a Result rather than throwing (ERR-03)', () => {
    const probe = () => canonicalize({ n: Number.NaN });

    expect(probe).not.toThrow();
  });
});

describe('digests (T-049)', () => {
  it('matches the published SHA-256 vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the published SHA-256 vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // "é" is 0xC3 0xA9 in UTF-8 and 0xE9 in Latin-1 / UTF-16. Hashing the
    // wrong encoding makes every non-ASCII review hash differently on a
    // different platform, which breaks hash-gating silently.
    //
    // The expectation is built from the explicit byte sequence, so this tests
    // the ENCODING choice rather than restating the implementation.
    const utf8Bytes = createHash('sha256')
      .update(Buffer.from([0xc3, 0xa9]))
      .digest('hex');
    const latin1Bytes = createHash('sha256')
      .update(Buffer.from([0xe9]))
      .digest('hex');

    expect(sha256Hex('é')).toBe(utf8Bytes);
    expect(sha256Hex('é')).not.toBe(latin1Bytes);
  });

  it('hashes an object through its canonical form', () => {
    const a = hashObject({ b: 2, a: 1 });
    const b = hashObject({ a: 1, b: 2 });

    expect(a.ok).toBe(true);
    expect(value(a)).toBe(value(b));
    expect(value(a)).toHaveLength(64);
  });

  it('propagates a canonicalisation failure rather than hashing garbage', () => {
    expect(hashObject({ n: Number.NaN }).ok).toBe(false);
  });

  it('produces a different digest for a different value', () => {
    expect(value(hashObject({ a: 1 }))).not.toBe(value(hashObject({ a: 2 })));
  });
});

describe('delimiter escaping (TR-HASH-005)', () => {
  it('makes concatenation unambiguous', () => {
    // Without escaping, ("ab","c") and ("a","bc") hash identically - two
    // different reviews collapsing into one ledger entry.
    expect(joinForHash(['ab', 'c'])).not.toBe(joinForHash(['a', 'bc']));
    expect(identityDigest(['ab', 'c'])).not.toBe(identityDigest(['a', 'bc']));
  });

  it('survives a field that contains the delimiter itself', () => {
    // A field carrying a raw delimiter would otherwise read as two fields, so
    // ['a<US>b', 'c'] would collide with ['a', 'b', 'c'].
    const withDelimiter = 'ab';

    expect(escapeForHash(withDelimiter)).toBe('a\\ub');
    expect(joinForHash([withDelimiter, 'c'])).not.toBe(joinForHash(['a', 'b', 'c']));
    expect(identityDigest([withDelimiter, 'c'])).not.toBe(identityDigest(['a', 'b', 'c']));
  });

  it('survives a field that contains a backslash', () => {
    expect(escapeForHash('a\\b')).toBe('a\\\\b');
    expect(joinForHash(['a\\', 'b'])).not.toBe(joinForHash(['a', '\\b']));
  });

  it('escapes the backslash before the delimiter, not after', () => {
    // A lone backslash becomes two. Escaping the delimiter first would let its
    // replacement's backslash be escaped again, and distinct inputs collide.
    expect(escapeForHash('\\')).toBe('\\\\');

    // An escaped delimiter and a literal "\u" in the source text must stay
    // distinguishable after escaping.
    expect(escapeForHash('')).toBe('\\u');
    expect(escapeForHash('\\u')).toBe('\\\\u');
    expect(escapeForHash('')).not.toBe(escapeForHash('\\u'));
  });

  it('leaves an ordinary field untouched', () => {
    expect(escapeForHash('plain text 123')).toBe('plain text 123');
  });

  it('distinguishes field order', () => {
    expect(identityDigest(['a', 'b'])).not.toBe(identityDigest(['b', 'a']));
  });

  it('distinguishes an empty field from an absent one', () => {
    expect(identityDigest(['a', '', 'b'])).not.toBe(identityDigest(['a', 'b']));
  });
});

describe('identity digest shape', () => {
  it('is 32 hex characters', () => {
    expect(identityDigest(['1', 'google', 'x'])).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('is the first 32 characters of the full digest, not a re-hash', () => {
    const parts = ['1', 'google', 'listing', 'author', '5', 'text'];

    expect(identityDigest(parts)).toBe(sha256Hex(joinForHash(parts)).slice(0, 32));
  });

  it('is stable across calls', () => {
    const parts = ['1', 'google', 'listing'];

    expect(identityDigest(parts)).toBe(identityDigest(parts));
  });
});
