import { createHash } from 'node:crypto';

import { err, ok } from './result.mjs';

/**
 * Canonical serialisation and digest helpers.
 *
 * Everything the engine decides about *change* rests on this file. Hash-gating
 * (TR-HASH-030) compares canonical bytes to decide whether a file is written at
 * all, and its silent failure is a fifteen-fold repository growth event. Review
 * identity and content comparison rest on it too.
 *
 * Two byte streams are deliberately different things (§54):
 *
 * - **Written bytes** are what lands on disk and is published. Pretty-printed
 *   for a ledger, minified for a payload.
 * - **Canonical bytes** are what is hashed. They never vary with key insertion
 *   order, with whitespace, or with how a value happened to be constructed.
 *
 * This module produces the second kind. `node:crypto` is the only import — the
 * one built-in `core/` may use (TR-DEP-002).
 *
 * @module core/util/hash
 */

/**
 * @template T
 * @template E
 * @typedef {import('./result.mjs').Result<T, E>} Result
 */

const ERR_INVARIANT = 'ERR-INTERNAL-INVARIANT';

/** Unit Separator. Never appears in normalised text, which is what makes it usable as a delimiter. */
const FIELD_DELIMITER = '';

const IDENTITY_HASH_LENGTH = 32;

/** Sentinel meaning "this is a composite value, keep walking". Distinct from `null`, which means "cannot canonicalise". */
const NOT_PRIMITIVE = Symbol('not-primitive');

/**
 * Value kinds that cannot round-trip deterministically and are therefore
 * refused rather than coerced. Held as a set so the branch count stays inside
 * the complexity limit and so the list reads as one table.
 */
const UNHASHABLE_TYPES = new Set(['undefined', 'function', 'symbol', 'bigint']);

/**
 * Canonicalises a scalar.
 *
 * Split out of the walker so that neither function exceeds the complexity
 * limit, and so that the list of value kinds this engine refuses to hash reads
 * as one table rather than as branches inside a recursion.
 *
 * @param {unknown} node
 * @returns {string | null | typeof NOT_PRIMITIVE}
 *   A canonical string, `null` if the value cannot be canonicalised, or the
 *   sentinel if it is composite.
 */
function canonicalizePrimitive(node) {
  if (node === null) return 'null';

  const type = typeof node;

  if (type === 'string') return JSON.stringify(node);
  if (type === 'boolean') return node ? 'true' : 'false';
  // NaN and Infinity would become `null` under JSON.stringify, making two
  // genuinely different payloads hash the same.
  if (type === 'number') return Number.isFinite(node) ? JSON.stringify(node) : null;
  if (UNHASHABLE_TYPES.has(type)) return null;

  return NOT_PRIMITIVE;
}

/**
 * Serialises a value to canonical form: object keys sorted, no insignificant
 * whitespace, arrays left in order.
 *
 * **Array order is preserved deliberately.** Sorting arrays would make
 * `[a, b]` and `[b, a]` hash identically, and review order is meaningful — a
 * reordered payload is a changed payload.
 *
 * Returns a Result rather than throwing (ERR-03). The failure cases are values
 * that cannot round-trip deterministically: `NaN`, `Infinity`, `BigInt`,
 * functions, symbols, and cycles. `JSON.stringify` silently turns the first two
 * into `null`, which would make two genuinely different payloads hash the same.
 *
 * @param {unknown} value
 * @returns {Result<string, string>}
 */
export function canonicalize(value) {
  /** @type {Set<object>} */
  const seen = new Set();

  /**
   * @param {unknown} node
   * @returns {string | null} `null` signals a value that cannot be canonicalised.
   */
  function walk(node) {
    const primitive = canonicalizePrimitive(node);
    if (primitive !== NOT_PRIMITIVE) return primitive;

    if (seen.has(/** @type {object} */ (node))) return null;
    seen.add(/** @type {object} */ (node));

    const serialised = Array.isArray(node)
      ? walkArray(node)
      : walkObject(/** @type {Record<string, unknown>} */ (node));

    seen.delete(/** @type {object} */ (node));
    return serialised;
  }

  /**
   * @param {unknown[]} node
   * @returns {string | null}
   */
  function walkArray(node) {
    const parts = [];
    for (const item of node) {
      // An undefined slot becomes null, matching JSON.stringify's array
      // behaviour. Dropping it would change the array's length.
      const part = item === undefined ? 'null' : walk(item);
      if (part === null) return null;
      parts.push(part);
    }
    return `[${parts.join(',')}]`;
  }

  /**
   * @param {Record<string, unknown>} node
   * @returns {string | null}
   */
  function walkObject(node) {
    const parts = [];
    // Sorted by code unit. Deterministic across engines and locales, which
    // localeCompare is not.
    for (const key of Object.keys(node).sort()) {
      const item = node[key];
      // An undefined property is absent, matching JSON.stringify. This is why
      // exactOptionalPropertyTypes matters: "absent" and "null" are different
      // in the payload contract, and they must hash differently.
      if (item === undefined) continue;
      const part = walk(item);
      if (part === null) return null;
      parts.push(`${JSON.stringify(key)}:${part}`);
    }
    return `{${parts.join(',')}}`;
  }

  const out = walk(value);
  return out === null ? err(ERR_INVARIANT) : ok(out);
}

/**
 * SHA-256 of a UTF-8 string, lowercase hex. Total: a string always hashes.
 *
 * @param {string} text
 * @returns {string} 64 hex characters.
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Canonicalises a value and returns the SHA-256 of its canonical bytes.
 *
 * @param {unknown} value
 * @returns {Result<string, string>}
 */
export function hashObject(value) {
  const canonical = canonicalize(value);
  return canonical.ok ? ok(sha256Hex(canonical.value)) : canonical;
}

/**
 * Escapes a field so that concatenation is unambiguous (TR-HASH-005).
 *
 * Without escaping, `("ab", "c")` and `("a", "bc")` hash identically — two
 * different reviews collapsing into one ledger entry.
 *
 * @param {string} part
 * @returns {string}
 */
export function escapeForHash(part) {
  // Backslash first, or the delimiter's replacement would be re-escaped.
  return part.replaceAll('\\', '\\\\').replaceAll(FIELD_DELIMITER, '\\u');
}

/**
 * Joins ordered fields into one unambiguous string for hashing.
 *
 * @param {ReadonlyArray<string>} parts
 * @returns {string}
 */
export function joinForHash(parts) {
  return parts.map(escapeForHash).join(FIELD_DELIMITER);
}

/**
 * The identity digest: SHA-256 over delimiter-escaped ordered fields, truncated
 * to the first 32 hex characters (128 bits).
 *
 * 128 bits is not a security boundary; it is a collision boundary. At the
 * system's largest planned scale it remains far beyond any realistic collision.
 *
 * @param {ReadonlyArray<string>} parts Ordered inputs. Order is part of the contract.
 * @returns {string} 32 hex characters.
 */
export function identityDigest(parts) {
  return sha256Hex(joinForHash(parts)).slice(0, IDENTITY_HASH_LENGTH);
}
