import { describe, expect, it } from 'vitest';

import {
  COMPLETENESS,
  DATE_CONFIDENCES,
  DATE_PRECISIONS,
  LEDGER_STATES,
  MAX_RATING,
  MIN_RATING,
  REVIEW_SOURCES,
  absenceIsMeaningful,
  isValidRating,
  markNormalised,
} from '../../../src/core/model/review.mjs';

/**
 * T-052's acceptance is "the brand prevents unnormalised text reaching a
 * payload type", verified by type-checking a deliberate misuse. That is done in
 * `review.types.test.mjs` with `@ts-expect-error`, which fails the build if the
 * misuse ever starts type-checking.
 *
 * This file covers the runtime surface.
 */

describe('vocabulary', () => {
  it('names the date precisions from finest to coarsest, plus unknown', () => {
    expect(DATE_PRECISIONS).toEqual(['day', 'week', 'month', 'year', 'unknown']);
  });

  it('names the three date confidences', () => {
    expect(DATE_CONFIDENCES).toEqual(['high', 'medium', 'low']);
  });

  it('includes csv and manual as sources, not only scraped ones', () => {
    // The CSV adapter is built before any browser code, so `csv` has to be a
    // first-class source from the start rather than a special case bolted on.
    expect(REVIEW_SOURCES).toContain('csv');
    expect(REVIEW_SOURCES).toContain('manual');
    expect(REVIEW_SOURCES).toContain('google');
  });

  it('names all four completeness values including failed', () => {
    expect(COMPLETENESS).toEqual(['full', 'full_capped', 'partial', 'failed']);
  });

  it('names the four ledger states', () => {
    expect(LEDGER_STATES).toEqual(['active', 'unconfirmed', 'tombstoned', 'suppressed']);
  });

  it('freezes every vocabulary list', () => {
    for (const list of [
      DATE_PRECISIONS,
      DATE_CONFIDENCES,
      REVIEW_SOURCES,
      COMPLETENESS,
      LEDGER_STATES,
    ]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });
});

describe('rating validation', () => {
  it('accepts every integer in range', () => {
    for (let r = MIN_RATING; r <= MAX_RATING; r += 1) {
      expect(isValidRating(r), `rating ${r}`).toBe(true);
    }
  });

  it('rejects out-of-range values', () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
  });

  it('rejects a fractional rating', () => {
    // A source aggregate may be 4.3; an individual review's stars are integral.
    // Rounding here would fabricate a rating nobody gave.
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(4.0)).toBe(true);
  });

  it('rejects non-numbers, including numeric strings', () => {
    expect(isValidRating('4')).toBe(false);
    expect(isValidRating(null)).toBe(false);
    expect(isValidRating(undefined)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
  });
});

describe('the absence asymmetry (TR-REC-010, PT-07)', () => {
  it('treats absence as meaningful ONLY after a complete harvest', () => {
    // Getting this backwards is the only defect in the system that can
    // silently wipe a paying client's reviews.
    expect(absenceIsMeaningful('full')).toBe(true);
    expect(absenceIsMeaningful('full_capped')).toBe(true);
  });

  it('refuses to read anything into absence after an incomplete harvest', () => {
    expect(absenceIsMeaningful('partial')).toBe(false);
    expect(absenceIsMeaningful('failed')).toBe(false);
  });

  it('treats an unrecognised completeness as NOT meaningful', () => {
    // Failing closed. A future completeness value that nobody remembered to
    // handle must not silently start authorising deletions.
    expect(absenceIsMeaningful('something-new')).toBe(false);
    expect(absenceIsMeaningful('')).toBe(false);
  });

  it('covers every documented completeness value', () => {
    for (const value of COMPLETENESS) {
      expect(typeof absenceIsMeaningful(value), value).toBe('boolean');
    }
  });
});

describe('the CleanString brand', () => {
  it('is a compile-time marker with no runtime cost', () => {
    // The brand exists only in the type system. At runtime the string is
    // unchanged, which matters: normalisation already happened, and this must
    // not be mistaken for a second sanitisation pass.
    const input = 'already normalised text';

    expect(markNormalised(input)).toBe(input);
    expect(typeof markNormalised(input)).toBe('string');
  });
});
