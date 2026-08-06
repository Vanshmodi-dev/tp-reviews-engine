import { describe, expect, it } from 'vitest';

import {
  computeCoverage,
  computeDistribution,
  computeMeanRating,
  computeQuarantineRate,
  findDuplicates,
  findNearDuplicates,
  validateAll,
} from '../../../src/core/validate/aggregate.mjs';
import {
  COMPLETENESS_VALUES,
  classifyCompleteness,
  isComplete,
} from '../../../src/core/validate/completeness.mjs';
import { shouldQuarantine, validateRecord } from '../../../src/core/validate/record.mjs';

/** @param {object} o */
const review = (o = {}) => ({
  identity_hash: 'a'.repeat(32),
  author_key: 'ak-1',
  author: { name: 'Dana' },
  rating: 5,
  text: 'Great service',
  date_estimated: '2026-01-01T00:00:00.000Z',
  ...o,
});

// ------------------------------------------------- T-092 / T-093 completeness

describe('completeness comes from the STOP REASON, never from counts (VAL-01)', () => {
  it('maps each stop reason to a distinct completeness', () => {
    expect(classifyCompleteness({ stop_reason: 'target_reached' })).toBe('full');
    expect(classifyCompleteness({ stop_reason: 'cap_reached' })).toBe('full_capped');
    expect(classifyCompleteness({ stop_reason: 'stalled' })).toBe('partial');
    expect(classifyCompleteness({ stop_reason: 'budget_exhausted' })).toBe('partial');
    expect(classifyCompleteness({ stop_reason: 'error' })).toBe('failed');
  });

  it('makes all four values reachable (T-093)', () => {
    const produced = new Set(
      ['target_reached', 'cap_reached', 'stalled', 'error'].map((r) =>
        classifyCompleteness({ stop_reason: r }),
      ),
    );

    expect([...produced].sort()).toEqual([...COMPLETENESS_VALUES].sort());
  });

  it('IGNORES counts entirely', () => {
    // The tempting implementation is `observed >= advertised ? full : partial`.
    // It is wrong in both directions and silently: a source under-reporting its
    // own total makes a partial harvest read as full, and every review the
    // harvest missed begins a countdown to deletion.
    const stalled = { stop_reason: 'stalled', observed_count: 999, advertised_total: 10 };

    expect(classifyCompleteness(stalled)).toBe('partial');
  });

  it('FAILS CLOSED on an unrecognised stop reason', () => {
    // Failing closed costs a delayed removal. Failing open deletes reviews.
    for (const reason of ['something_new', '', null, undefined]) {
      expect(classifyCompleteness({ stop_reason: /** @type {any} */ (reason) })).toBe('failed');
    }
    expect(classifyCompleteness(/** @type {any} */ (undefined))).toBe('failed');
  });

  it('treats only full and full_capped as complete', () => {
    expect(isComplete('full')).toBe(true);
    expect(isComplete('full_capped')).toBe(true);
    expect(isComplete('partial')).toBe(false);
    expect(isComplete('failed')).toBe(false);
    expect(isComplete('anything else')).toBe(false);
  });

  it('distinguishes full from full_capped', () => {
    // Not cosmetic: full_capped means the payload is knowingly a subset, and
    // coverage rule G-08 treats it differently.
    expect(classifyCompleteness({ stop_reason: 'target_reached' })).not.toBe(
      classifyCompleteness({ stop_reason: 'cap_reached' }),
    );
  });
});

// ------------------------------------------------------------ T-087 findings

describe('record validation produces findings and mutates nothing (VAL-02)', () => {
  it('accepts a sound record', () => {
    expect(validateRecord(review())).toEqual([]);
  });

  it('DOES NOT MUTATE its input', () => {
    const input = review({ rating: 9 });
    const before = JSON.stringify(input);
    validateRecord(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('flags a rating outside 1..5 as fatal', () => {
    for (const rating of [0, 6, -1, 4.5, null, undefined, '5']) {
      const findings = validateRecord(review({ rating }));
      expect(
        findings.some((f) => f.code === 'ERR-PARSE-RATING-INVALID'),
        String(rating),
      ).toBe(true);
      expect(shouldQuarantine(findings), String(rating)).toBe(true);
    }
  });

  it('flags a malformed identity hash as fatal', () => {
    expect(shouldQuarantine(validateRecord(review({ identity_hash: 'nope' })))).toBe(true);
    expect(shouldQuarantine(validateRecord(review({ identity_hash: 'A'.repeat(32) })))).toBe(true);
  });

  it('flags unnormalised over-long text as fatal', () => {
    // The normaliser bounds text, so exceeding it means normalisation did not
    // run - a pipeline-order defect, not a data problem.
    const findings = validateRecord(review({ text: 'x'.repeat(5001) }));

    expect(findings.some((f) => f.code === 'ERR-CLEAN-MARKUP-SURVIVED')).toBe(true);
  });

  it('warns but does NOT quarantine an unresolvable date', () => {
    // A review with an unreadable date is still a real review. Withholding it
    // serves nobody.
    const findings = validateRecord(review({ date_estimated: null }));

    expect(findings.some((f) => f.severity === 'warn')).toBe(true);
    expect(shouldQuarantine(findings)).toBe(false);
  });

  it('records an anonymous rating-only review as info, not a problem', () => {
    const findings = validateRecord(review({ author: { name: null }, text: null }));

    expect(shouldQuarantine(findings)).toBe(false);
    expect(findings.some((f) => f.severity === 'info')).toBe(true);
  });

  it('bounds finding detail so raw content cannot leak into a log', () => {
    const findings = validateRecord(review({ rating: 'x'.repeat(500) }));

    for (const f of findings) expect(f.detail.length).toBeLessThanOrEqual(200);
  });

  it('freezes findings', () => {
    expect(Object.isFrozen(validateRecord(review({ rating: 0 }))[0])).toBe(true);
  });
});

// ---------------------------------------------- T-088 / T-091 / T-095 boundaries

describe('coverage (T-088) and its boundaries (T-095)', () => {
  it('is extracted over advertised', () => {
    expect(computeCoverage(95, 100)).toBeCloseTo(0.95, 5);
  });

  it('is exactly at the boundary when it should be', () => {
    // Three-point boundary: just under, exactly at, just over coverage_min.
    expect(computeCoverage(94, 100)).toBeLessThan(0.95);
    expect(computeCoverage(95, 100)).toBe(0.95);
    expect(computeCoverage(96, 100)).toBeGreaterThan(0.95);
  });

  it('is NULL when the advertised total is unknown — null is not zero', () => {
    // Treating unknown as 0 makes coverage undefined; treating it as "we got
    // everything" makes a partial harvest look complete.
    expect(computeCoverage(50, null)).toBeNull();
    expect(computeCoverage(50, undefined)).toBeNull();
    expect(computeCoverage(50, 0)).toBeNull();
    expect(computeCoverage(50, -5)).toBeNull();
  });

  it('caps at 1 when a source under-reports its own total', () => {
    expect(computeCoverage(140, 100)).toBe(1);
  });

  it('is 0 when nothing was extracted', () => {
    expect(computeCoverage(0, 100)).toBe(0);
  });
});

describe('quarantine rate (T-091) and its boundaries (T-095)', () => {
  it('is quarantined over total', () => {
    expect(computeQuarantineRate(95, 5)).toBeCloseTo(0.05, 5);
  });

  it('sits exactly on the default threshold at 5 in 100', () => {
    expect(computeQuarantineRate(95, 5)).toBe(0.05);
    expect(computeQuarantineRate(96, 4)).toBeLessThan(0.05);
    expect(computeQuarantineRate(94, 6)).toBeGreaterThan(0.05);
  });

  it('is 0 for an empty harvest rather than dividing by zero', () => {
    // Whether an empty harvest is acceptable is gate rule G-02's question.
    expect(computeQuarantineRate(0, 0)).toBe(0);
  });

  it('is 1 when everything was quarantined', () => {
    expect(computeQuarantineRate(0, 10)).toBe(1);
  });
});

// --------------------------------------------------------------- T-089 / T-090

describe('duplicates are FLAGGED, never removed (T-089)', () => {
  it('flags a repeated identity once', () => {
    const findings = findDuplicates([review(), review(), review()]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('does not flag distinct identities', () => {
    expect(findDuplicates([review(), review({ identity_hash: 'b'.repeat(32) })])).toEqual([]);
  });

  it('returns findings only — the input set is unchanged', () => {
    // Removal is PH-05's job. Doing it here would mean two modules decide what
    // exists.
    const set = [review(), review()];
    findDuplicates(set);

    expect(set).toHaveLength(2);
  });

  it('flags near-duplicates by the same author above the threshold', () => {
    const a = review({ identity_hash: 'a'.repeat(32), text: 'The staff were lovely and helpful' });
    const b = review({ identity_hash: 'b'.repeat(32), text: 'The staff were lovely and helpful!' });

    expect(findNearDuplicates([a, b], 0.92).clusters).toBe(1);
  });

  it('does not flag different reviews by the same author', () => {
    const a = review({ identity_hash: 'a'.repeat(32), text: 'Wonderful food and service' });
    const b = review({ identity_hash: 'b'.repeat(32), text: 'Parking was impossible here' });

    expect(findNearDuplicates([a, b], 0.92).clusters).toBe(0);
  });

  it('does not compare across different authors', () => {
    const a = review({ identity_hash: 'a'.repeat(32), author_key: 'ak-1', text: 'Same text here' });
    const b = review({ identity_hash: 'b'.repeat(32), author_key: 'ak-2', text: 'Same text here' });

    expect(findNearDuplicates([a, b], 0.92).clusters).toBe(0);
  });
});

describe('distribution and mean (T-090)', () => {
  it('always contains all five buckets, including zeros', () => {
    // A distribution that omits empty buckets makes a client's star bars
    // disappear rather than show zero.
    expect(computeDistribution([review({ rating: 5 })])).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 1,
    });
  });

  it('sums to the review count', () => {
    const reviews = [1, 2, 3, 4, 5, 5].map((rating) => review({ rating }));
    const total = Object.values(computeDistribution(reviews)).reduce((a, b) => a + b, 0);

    expect(total).toBe(reviews.length);
  });

  it('ignores an out-of-range rating rather than inventing a bucket', () => {
    expect(computeDistribution([review({ rating: 9 })])['9']).toBeUndefined();
  });

  it('computes the mean to two decimal places', () => {
    expect(computeMeanRating([1, 2, 4].map((rating) => review({ rating })))).toBe(2.33);
  });

  it('is 0 for an empty set rather than NaN', () => {
    expect(computeMeanRating([])).toBe(0);
  });
});

// -------------------------------------------------------------------- T-094

describe('ValidationReport assembly (T-094)', () => {
  const report = validateAll([review(), review({ identity_hash: 'b'.repeat(32), rating: 0 })], {
    advertisedTotal: 4,
    nearDuplicateThreshold: 0.92,
  });

  it('carries every documented field', () => {
    expect(Object.keys(report).sort()).toEqual([
      'accepted_count',
      'coverage',
      'findings',
      'has_fatal',
      'largest_duplicate_cluster',
      'near_duplicate_clusters',
      'quarantine_rate',
      'quarantined_count',
    ]);
  });

  it('counts accepted and quarantined separately', () => {
    expect(report.accepted_count).toBe(1);
    expect(report.quarantined_count).toBe(1);
  });

  it('reports has_fatal for gate rule G-07', () => {
    expect(report.has_fatal).toBe(true);
  });

  it('computes coverage from the set size', () => {
    expect(report.coverage).toBe(0.5);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('produces a clean report for a sound set', () => {
    const clean = validateAll([review()], { advertisedTotal: 1, nearDuplicateThreshold: 0.92 });

    expect(clean.has_fatal).toBe(false);
    expect(clean.quarantine_rate).toBe(0);
    expect(clean.coverage).toBe(1);
  });
});

// -------------------------------------------------------------------- T-096

describe('T-096 — coverage and completeness are never interchanged', () => {
  it('they answer different questions and have different types', () => {
    // coverage: a number or null, "how much of what was advertised did we get".
    // completeness: an enum, "why did the loop stop".
    // Conflating them is TR-STD-080's named vocabulary failure.
    expect(typeof computeCoverage(1, 2)).toBe('number');
    expect(typeof classifyCompleteness({ stop_reason: 'stalled' })).toBe('string');
    expect(COMPLETENESS_VALUES).not.toContain(1);
  });

  it('a full harvest can still have low coverage', () => {
    // The source advertised 100, we stopped at our own cap of 20. Complete by
    // stop reason, 20% by coverage. Both true, neither substitutable.
    expect(classifyCompleteness({ stop_reason: 'cap_reached' })).toBe('full_capped');
    expect(computeCoverage(20, 100)).toBe(0.2);
  });

  it('a partial harvest can still have full coverage', () => {
    // We stalled, but happened to have already reached the advertised number.
    // Coverage says 1; completeness says partial; absence still means nothing.
    expect(computeCoverage(100, 100)).toBe(1);
    expect(isComplete(classifyCompleteness({ stop_reason: 'stalled' }))).toBe(false);
  });
});

describe('branches coverage found untested', () => {
  it('skips records with no author key when clustering', () => {
    const withKey = review({ identity_hash: 'a'.repeat(32) });
    const noKey = review({ identity_hash: 'b'.repeat(32), author_key: null });

    expect(findNearDuplicates([withKey, noKey], 0.92).clusters).toBe(0);
  });

  it('skips records with no identity hash when finding duplicates', () => {
    expect(
      findDuplicates([review({ identity_hash: null }), review({ identity_hash: 42 })]),
    ).toEqual([]);
  });

  it('treats two records with the SAME identity as exact, not near, duplicates', () => {
    // findDuplicates already reports those; counting them here too would
    // double-report one problem.
    const same = [review(), review()];

    expect(findNearDuplicates(same, 0.92).clusters).toBe(0);
    expect(findDuplicates(same)).toHaveLength(1);
  });

  it('handles a null-text review in similarity comparison', () => {
    const a = review({ identity_hash: 'a'.repeat(32), text: null });
    const b = review({ identity_hash: 'b'.repeat(32), text: null });

    expect(() => findNearDuplicates([a, b], 0.92)).not.toThrow();
  });

  it('reports a single-review author group as no cluster', () => {
    expect(findNearDuplicates([review()], 0.92)).toEqual({
      clusters: 0,
      largest: 0,
      findings: [],
    });
  });

  it('flags a non-string text as fatal', () => {
    expect(shouldQuarantine(validateRecord(review({ text: 42 })))).toBe(true);
  });

  it('handles a wholly absent record without throwing', () => {
    expect(() => validateRecord(undefined)).not.toThrow();
    expect(shouldQuarantine(validateRecord(undefined))).toBe(true);
  });

  it('computes the mean over a set containing a bad rating', () => {
    expect(computeMeanRating([review({ rating: 'x' }), review({ rating: 5 })])).toBe(2.5);
  });
});
