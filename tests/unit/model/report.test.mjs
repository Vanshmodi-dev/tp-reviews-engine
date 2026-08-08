import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  declareCapabilities,
  explainNull,
  supports,
  unknownCapabilities,
} from '../../../src/core/model/capabilities.mjs';
import {
  GATE_DECISIONS,
  GATE_RULES,
  NON_OVERRIDABLE_RULES,
  SEVERITIES,
  STOP_REASONS,
  getGateRule,
  isNoOpHarvest,
} from '../../../src/core/model/report.mjs';

describe('stop reasons (ALG-PAGINATE §19.4)', () => {
  it('matches the five documented conditions', () => {
    expect(STOP_REASONS).toEqual([
      'cap_reached',
      'target_reached',
      'stalled',
      'budget_exhausted',
      'error',
    ]);
  });

  it('has no separate reason for a challenge', () => {
    // §19.4 row 5 folds challenge detection into `error`. The stop reason says
    // how the loop ended; the error class says what happened. Two vocabularies
    // for one event is how an alert ends up disagreeing with itself.
    expect(STOP_REASONS).not.toContain('challenge');
    expect(STOP_REASONS).not.toContain('challenged');
  });
});

describe('the twelve gate rules (§26.3)', () => {
  it('are all present, in order, with no gaps', () => {
    expect(GATE_RULES.map((r) => r.id)).toEqual([
      'G-01',
      'G-02',
      'G-03',
      'G-04',
      'G-05',
      'G-06',
      'G-07',
      'G-08',
      'G-09',
      'G-10',
      'G-11',
      'G-12',
    ]);
  });

  it('match the rule statements in the TRD, id for id', () => {
    // Parsed from the document rather than compared against a hand-copied list.
    const text = readFileSync(
      new URL('../../../docs/trd/05-processing-and-data.md', import.meta.url),
      'utf8',
    );
    const documented = new Set();
    for (const line of text.split('\n')) {
      const match = /^\|\s*\**`?(G-\d{2})`?\**\s*\|/u.exec(line);
      if (match?.[1]) documented.add(match[1]);
    }

    expect(documented.size).toBe(12);
    expect(new Set(GATE_RULES.map((r) => r.id))).toEqual(documented);
  });

  it('keeps the quarantine rate non-overridable', () => {
    // --force-publish downgrades rules an operator can reasonably judge in the
    // moment. A high quarantine rate is not one: it means the engine does not
    // understand the data it is about to publish.
    expect(getGateRule('G-06')?.overridable).toBe(false);
    expect(NON_OVERRIDABLE_RULES).toContain('G-06');
  });

  it('keeps the schema, emptiness, partial-drop and fatal rules non-overridable', () => {
    // SAD §26.8 and TRD §26.8 both say force downgrades G-03, G-04, G-05 and
    // G-12, and that G-01, G-02, G-06 and G-07 are never overridable. G-05 was
    // listed here in error; the correction is deliberate and cited.
    expect(NON_OVERRIDABLE_RULES).toEqual(['G-01', 'G-02', 'G-06', 'G-07']);
  });

  it('marks only coverage and size as warn-only', () => {
    // A payload can be unusual without being wrong. Blocking on unusual is how
    // an operator learns to force-publish by reflex.
    const warnOnly = GATE_RULES.filter((r) => r.warnOnly === true).map((r) => r.id);

    expect(warnOnly).toEqual(['G-08', 'G-10']);
  });

  it('gives every rule a statement', () => {
    for (const rule of GATE_RULES) {
      expect(rule.statement.length, rule.id).toBeGreaterThan(10);
    }
  });

  it('returns undefined for an unknown rule rather than inventing one', () => {
    expect(getGateRule('G-99')).toBeUndefined();
  });

  it('offers exactly two decisions', () => {
    expect(GATE_DECISIONS).toEqual(['ACCEPT', 'REJECT']);
  });
});

describe('finding severities', () => {
  it('ascend to fatal, which is what G-07 looks for', () => {
    expect(SEVERITIES).toEqual(['info', 'warn', 'error', 'fatal']);
  });
});

describe('decision log', () => {
  /** @param {object} o */
  const log = (o = {}) => ({
    inserted: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    tombstoned: 0,
    suppressed: 0,
    held: 0,
    ignored_terminal: 0,
    decisions: [],
    ...o,
  });

  it('calls a harvest with no changes a no-op', () => {
    expect(isNoOpHarvest(log({ unchanged: 120 }))).toBe(true);
  });

  it('does not call an insert a no-op', () => {
    expect(isNoOpHarvest(log({ inserted: 1, unchanged: 119 }))).toBe(false);
  });

  it('does not call a tombstone a no-op', () => {
    expect(isNoOpHarvest(log({ tombstoned: 1 }))).toBe(false);
  });

  it('does not treat missing as a change, because nothing was published differently', () => {
    // A missing record is still published, marked unconfirmed. The streak moved
    // but the payload did not.
    expect(isNoOpHarvest(log({ missing: 3, unchanged: 117 }))).toBe(true);
  });
});

describe('adapter capabilities (FR-020, TR-EXT-P-041)', () => {
  const places = declareCapabilities('google:places-api', ['review_text', 'author_name'], {
    maxReviewsPerListing: 5,
    sanctioned: true,
  });

  it('declares reduced capability honestly', () => {
    // Saying so is not an admission of weakness. It is the reason a client can
    // be migrated to a sanctioned API without their site appearing to lose data.
    expect(places.max_reviews_per_listing).toBe(5);
    expect(places.sanctioned).toBe(true);
    expect(supports(places, 'owner_reply')).toBe(false);
  });

  it('EXPLAINS a null field, which is the entire point', () => {
    // owner_reply: null means two completely different things depending on the
    // adapter, and without this they look identical to a consumer.
    expect(explainNull(places, 'owner_reply')).toBe('unsupported');
    expect(explainNull(places, 'review_text')).toBe('absent');
  });

  it('defaults to unsanctioned rather than assuming permission', () => {
    // Fails closed on the question that carries legal weight.
    expect(declareCapabilities('x', []).sanctioned).toBe(false);
  });

  it('defaults to no self-imposed ceiling', () => {
    expect(declareCapabilities('x', []).max_reviews_per_listing).toBeNull();
  });

  it('sorts the declared list so payload bytes are stable', () => {
    const a = declareCapabilities('x', ['likes', 'author_name', 'review_text']);
    const b = declareCapabilities('x', ['review_text', 'likes', 'author_name']);

    expect(a.supports).toEqual(b.supports);
  });

  it('catches a typo in a declared capability', () => {
    // `owner_replies` publishes a list no consumer can match, and every reply
    // silently reads as unsupported.
    const typo = declareCapabilities('x', ['owner_replies', 'review_text']);

    expect(unknownCapabilities(typo)).toEqual(['owner_replies']);
  });

  it('accepts a fully valid declaration', () => {
    expect(unknownCapabilities(declareCapabilities('x', [...CAPABILITIES]))).toEqual([]);
  });

  it('freezes the declaration', () => {
    expect(Object.isFrozen(places)).toBe(true);
    expect(Object.isFrozen(places.supports)).toBe(true);
  });

  it('names a capability for every nullable payload field a source might not expose', () => {
    for (const expected of ['review_text', 'owner_reply', 'likes', 'photo_count', 'verified']) {
      expect(CAPABILITIES, expected).toContain(expected);
    }
  });
});
