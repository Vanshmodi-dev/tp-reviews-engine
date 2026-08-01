import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ARTIFACTS,
  FORBIDDEN_PAYLOAD_FIELDS,
  NOTICES,
  SCHEMA_VERSION,
  checkStatsConsistency,
  findForbiddenFields,
  hashableProjection,
} from '../../../src/core/model/payload.mjs';

/**
 * T-054's acceptance is "matches `payload.v1.schema.json` field for field".
 *
 * That schema does not exist yet — T-112 authors it in PH-06 and **depends on
 * this module**, so the model comes first and the schema is derived from it.
 * The available cross-check is therefore against the document that will define
 * both: TRD §52.3 through §52.7.
 *
 * The field lists are parsed out of the markdown rather than hand-copied, for
 * the same reason the error taxonomy test parses Appendix B: a hand-maintained
 * expected list drifts from its source in exactly the way this test exists to
 * catch, and passes while doing so.
 */

const TRD = '../../../docs/trd/09-security-and-validation.md';

/** @returns {string} */
function trdText() {
  return readFileSync(new URL(TRD, import.meta.url), 'utf8');
}

/**
 * Field names from one TRD section's table.
 *
 * Takes the first backticked token in each row, which handles both the plain
 * tables and §52.5's numbered one where the field is the second cell.
 *
 * @param {string} heading e.g. "## 52.3"
 * @param {string} nextHeading
 * @returns {string[]}
 */
function fieldsFromSection(heading, nextHeading) {
  const text = trdText();
  const start = text.indexOf(heading);
  const end = text.indexOf(nextHeading, start);
  const section = text.slice(start, end);

  const fields = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const match = /\|\s*\**`([a-z_]+)`\**\s*\|/u.exec(line);
    if (match?.[1]) fields.push(match[1]);
  }
  return fields;
}

/**
 * `@property` names from one JSDoc typedef in a source file.
 *
 * @param {string} file Path relative to this test.
 * @param {string} typedefName
 * @returns {string[]}
 */
function propertiesOfTypedef(file, typedefName) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = text.indexOf(`@typedef {object} ${typedefName}`);
  const end = text.indexOf('*/', start);
  const block = text.slice(start, end);

  const names = [];
  for (const line of block.split(String.fromCharCode(10))) {
    // @property {Type} name   or   @property {Type} [name]
    //
    // The type may itself contain braces - {{ slug, display_name }} - so a
    // lazy [^}]* stops at the INNER brace and silently drops the field. A
    // greedy .* is no good either: it would run past a {@link} in the
    // description. This matches one level of nesting and no more.
    const match = /@property\s+\{(?:[^{}]|\{[^{}]*\})*\}\s+\[?([a-z_]+)\]?/u.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

const PAYLOAD = '../../../src/core/model/payload.mjs';
const REVIEW = '../../../src/core/model/review.mjs';

describe('the model matches TRD §52 field for field', () => {
  it('envelope (§52.3)', () => {
    expect(propertiesOfTypedef(PAYLOAD, 'PayloadEnvelope').sort()).toEqual(
      fieldsFromSection('## 52.3', '## 52.4').sort(),
    );
  });

  it('listing block (§52.4)', () => {
    expect(propertiesOfTypedef(PAYLOAD, 'ListingBlock').sort()).toEqual(
      fieldsFromSection('## 52.4', '## 52.5').sort(),
    );
  });

  it('stats (§52.6)', () => {
    expect(propertiesOfTypedef(PAYLOAD, 'Stats').sort()).toEqual(
      fieldsFromSection('## 52.6', '## 52.7').sort(),
    );
  });

  it('provenance (§52.7)', () => {
    expect(propertiesOfTypedef(PAYLOAD, 'Provenance').sort()).toEqual(
      fieldsFromSection('## 52.7', '## 52.8').sort(),
    );
  });

  it('review object (§52.5) — the twenty-four public fields', () => {
    const documented = fieldsFromSection('## 52.5', '**`author` object:**');

    expect(documented).toHaveLength(24);
    expect(propertiesOfTypedef(REVIEW, 'PayloadReview').sort()).toEqual([...documented].sort());
  });

  it('parses something rather than passing on an empty comparison', () => {
    // Two empty arrays are equal. Without this, a broken parser would make
    // every assertion above pass vacuously.
    expect(fieldsFromSection('## 52.3', '## 52.4').length).toBeGreaterThan(5);
    expect(propertiesOfTypedef(PAYLOAD, 'PayloadEnvelope').length).toBeGreaterThan(5);
  });
});

describe('vocabulary', () => {
  it('emits exactly one schema version in v1.0', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('names the five artifact kinds', () => {
    expect(ARTIFACTS).toEqual(['reviews', 'latest', 'stats', 'schema_org', 'index']);
  });

  it('keeps notices free of anything resembling an error', () => {
    // Notices are never an error channel. A failed harvest produces no payload
    // at all - the Gate holds the previous one - so a notice always
    // accompanies data that is published and correct.
    for (const notice of NOTICES) {
      expect(notice).not.toMatch(/error|fail|exception/iu);
    }
  });
});

describe('internal fields never reach the payload', () => {
  it('names the ledger-only fields', () => {
    expect(FORBIDDEN_PAYLOAD_FIELDS).toContain('author_key');
    expect(FORBIDDEN_PAYLOAD_FIELDS).toContain('missing_streak');
    expect(FORBIDDEN_PAYLOAD_FIELDS).toContain('content_hash_history');
  });

  it('detects a leaked internal field', () => {
    expect(findForbiddenFields({ id: 'x', author_key: 'ak1' })).toEqual(['author_key']);
  });

  it('detects several at once', () => {
    const leaked = findForbiddenFields({ author_key: 'a', missing_streak: 2, state: 'active' });

    expect(leaked).toHaveLength(3);
  });

  it('passes a clean projection', () => {
    expect(findForbiddenFields({ id: 'x', rating: 5, text: 'ok' })).toEqual([]);
  });

  it('does not confuse a similarly-named public field', () => {
    // `first_seen_at` IS public; `last_seen_at` is not. Getting these backwards
    // would either leak bookkeeping or drop a documented field.
    expect(findForbiddenFields({ first_seen_at: 'x' })).toEqual([]);
    expect(findForbiddenFields({ last_seen_at: 'x' })).toEqual(['last_seen_at']);
  });
});

describe('generated_at is excluded from the hash (TR-HASH-031)', () => {
  it('drops it', () => {
    const projection = hashableProjection({ schema_version: 1, generated_at: 'T', reviews: [] });

    expect(projection).not.toHaveProperty('generated_at');
    expect(projection).toEqual({ schema_version: 1, reviews: [] });
  });

  it('makes two payloads differing only in generated_at hash-identical', () => {
    // This is the whole point. Including it would rewrite every file on every
    // run and multiply commit churn roughly fiftyfold (IR-06).
    const a = hashableProjection({ schema_version: 1, generated_at: '2026-01-01T00:00:00Z' });
    const b = hashableProjection({ schema_version: 1, generated_at: '2026-06-01T00:00:00Z' });

    expect(a).toEqual(b);
  });

  it('leaves a payload without generated_at unchanged', () => {
    expect(hashableProjection({ schema_version: 1 })).toEqual({ schema_version: 1 });
  });

  it('does not mutate its input', () => {
    const original = { schema_version: 1, generated_at: 'T' };
    hashableProjection(original);

    expect(original).toHaveProperty('generated_at');
  });
});

describe('stats consistency', () => {
  /** @param {object} overrides */
  const stats = (overrides = {}) => ({
    total_count: 3,
    advertised_total: 10,
    coverage: 0.3,
    mean_rating: 4.33,
    advertised_rating: 4.4,
    distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 },
    with_text_count: 2,
    with_reply_count: 1,
    newest_review_date: null,
    oldest_review_date: null,
    languages: { en: 3 },
    completeness: 'full',
    last_full_harvest_at: null,
    ...overrides,
  });

  it('accepts a sound block', () => {
    expect(checkStatsConsistency(stats())).toEqual([]);
  });

  it('catches a distribution that does not sum to total_count', () => {
    // A client whose star bars disagree with their displayed average notices,
    // and cannot be told it is fine.
    expect(
      checkStatsConsistency(stats({ distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 5 } })),
    ).toContainEqual(expect.stringContaining('distribution sums to 6'));
  });

  it('catches counts that exceed the total', () => {
    expect(checkStatsConsistency(stats({ with_text_count: 9 })).length).toBe(1);
    expect(checkStatsConsistency(stats({ with_reply_count: 9 })).length).toBe(1);
  });

  it('catches coverage outside 0..1', () => {
    expect(checkStatsConsistency(stats({ coverage: 1.4 })).length).toBe(1);
    expect(checkStatsConsistency(stats({ coverage: -0.1 })).length).toBe(1);
  });

  it('accepts a null coverage', () => {
    // Null when the advertised total is unknown. That is honest, not an error.
    expect(checkStatsConsistency(stats({ coverage: null, advertised_total: null }))).toEqual([]);
  });

  it('reports every problem, not just the first', () => {
    expect(checkStatsConsistency(stats({ with_text_count: 9, coverage: 2 }))).toHaveLength(2);
  });
});
