import { describe, expect, it } from 'vitest';

import {
  GATE_DEFAULTS,
  PASS,
  REJECT,
  RULES,
  WARN,
  getRule,
  isChangeBased,
  largestCluster,
  quarantineRate,
} from '../../../src/core/gate/rules.mjs';
import { candidate, stats, validation } from '../../helpers/gate-input.mjs';

/**
 * GATE-02 requires **every rule to have a test proving it rejects and a test
 * proving it does not reject spuriously**. Both halves matter and the second is
 * the one usually skipped: a rule that always fires blocks every publish, which
 * is discovered in production by a client whose reviews stopped updating.
 *
 * So every rule below has a matched pair, and each is invoked in isolation
 * through `getRule(id).evaluate(context)` — which is only possible because the
 * rules are data (TR-GATE-003).
 */

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const context = (overrides = {}) => ({
  candidate: candidate(),
  prior: candidate(),
  priorReadable: true,
  firstPublish: false,
  validation: validation(),
  thresholds: GATE_DEFAULTS,
  candidateBytes: 1024,
  schemaErrors: [],
  nearDuplicates: [],
  ...overrides,
});

/**
 * @param {string} id
 * @param {Record<string, any>} ctx
 * @returns {any}
 */
const run = (id, ctx) => getRule(id).evaluate(context(ctx));

describe('the rule set itself', () => {
  it('holds exactly twelve rules, G-01 to G-12', () => {
    expect(RULES).toHaveLength(12);
    expect(RULES.map((rule) => rule.id)).toEqual([
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

  it('marks exactly G-03, G-04, G-05 and G-12 overridable (SAD §26.8)', () => {
    const overridable = RULES.filter((rule) => rule.overridable).map((rule) => rule.id);

    expect(overridable).toEqual(['G-03', 'G-04', 'G-05', 'G-12']);
  });

  it('never marks G-01, G-02, G-06 or G-07 overridable', () => {
    // These indicate a defect or genuine corruption, not a disagreement about a
    // threshold. No operator intent can wave them through.
    for (const id of ['G-01', 'G-02', 'G-06', 'G-07']) {
      expect(getRule(id).overridable, id).toBe(false);
    }
  });

  it('marks exactly the change-based rules as skippable on first publish', () => {
    const skippable = RULES.filter((rule) => isChangeBased(rule.id)).map((rule) => rule.id);

    expect(skippable).toEqual(['G-02', 'G-03', 'G-04', 'G-05', 'G-12']);
  });

  it('gives every REJECT rule an error class and every WARN rule none', () => {
    // The error class is what an alert routes on. A rejecting rule without one
    // produces an alert nobody can triage.
    for (const rule of RULES) {
      if (rule.warnOnly === true) expect(rule.errorClass, rule.id).toBeNull();
      else expect(rule.errorClass, rule.id).toEqual(expect.any(String));
    }
  });

  it('returns undefined for an unknown rule id', () => {
    expect(getRule('G-99')).toBeUndefined();
  });
});

describe('G-01 — schema validity', () => {
  it('rejects a schema-invalid candidate', () => {
    const outcome = run('G-01', { schemaErrors: ['stats.total_count: expected integer'] });

    expect(outcome.verdict).toBe(REJECT);
    expect(outcome.detail).toContain('total_count');
  });

  it('does not reject a valid candidate', () => {
    expect(run('G-01', {}).verdict).toBe(PASS);
  });
});

describe('G-02 — non-empty over non-empty', () => {
  it('rejects an empty candidate over a populated prior', () => {
    // The most visible failure this system can produce: a client's review
    // section going blank.
    const outcome = run('G-02', { candidate: candidate({ total_count: 0 }) });

    expect(outcome.verdict).toBe(REJECT);
  });

  it('does not reject an empty candidate when the prior was also empty', () => {
    const outcome = run('G-02', {
      candidate: candidate({ total_count: 0 }),
      prior: candidate({ total_count: 0 }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not reject a populated candidate', () => {
    expect(run('G-02', {}).verdict).toBe(PASS);
  });

  it('treats a missing prior as empty rather than throwing', () => {
    expect(run('G-02', { prior: null }).verdict).toBe(PASS);
  });
});

describe('G-03 — count drop ratio', () => {
  it('rejects a drop beyond the threshold', () => {
    const outcome = run('G-03', { candidate: candidate({ total_count: 70 }) });

    expect(outcome.verdict).toBe(REJECT);
    expect(outcome.threshold).toBe(0.2);
  });

  it('does not reject a drop at the threshold exactly', () => {
    // 100 -> 80 is exactly 20%. The rule is "more than", so the boundary passes.
    expect(run('G-03', { candidate: candidate({ total_count: 80 }) }).verdict).toBe(PASS);
  });

  it('does not reject growth', () => {
    expect(run('G-03', { candidate: candidate({ total_count: 200 }) }).verdict).toBe(PASS);
  });

  it('passes when there is no prior count to compare', () => {
    expect(run('G-03', { prior: candidate({ total_count: 0 }) }).verdict).toBe(PASS);
  });

  it('honours a configured threshold', () => {
    const outcome = run('G-03', {
      candidate: candidate({ total_count: 95 }),
      thresholds: { ...GATE_DEFAULTS, max_count_drop_ratio: 0.01 },
    });

    expect(outcome.verdict).toBe(REJECT);
  });
});

describe('G-04 — rating shift', () => {
  it('rejects a shift beyond the threshold', () => {
    const outcome = run('G-04', { candidate: candidate({ mean_rating: 3.2 }) });

    expect(outcome.verdict).toBe(REJECT);
  });

  it('rejects a shift in either direction', () => {
    // Upward too. A rating that jumps is as much a signal that something is
    // wrong as one that collapses - it usually means the wrong listing.
    const up = run('G-04', {
      candidate: candidate({ mean_rating: 5 }),
      prior: candidate({ mean_rating: 4.0 }),
    });

    expect(up.verdict).toBe(REJECT);
  });

  it('does not reject a shift at the threshold exactly', () => {
    // 4.5 -> 5.0 is exactly 0.50. The rule is "more than", so the boundary
    // passes; asserting it stops the comparison drifting to >=.
    expect(run('G-04', { candidate: candidate({ mean_rating: 5 }) }).verdict).toBe(PASS);
  });

  it('does not reject a small shift', () => {
    expect(run('G-04', { candidate: candidate({ mean_rating: 4.7 }) }).verdict).toBe(PASS);
  });

  it('passes when the prior had no reviews to average', () => {
    expect(run('G-04', { prior: candidate({ total_count: 0 }) }).verdict).toBe(PASS);
  });

  it('passes when the prior has no mean at all', () => {
    const prior = candidate();
    prior.stats.mean_rating = null;

    expect(run('G-04', { prior }).verdict).toBe(PASS);
  });

  it('passes when there is no prior object or no stats block', () => {
    // Reachable by calling the rule directly, which is how the gate's own
    // first-publish skip is bypassed. A rule must be safe on its own inputs
    // rather than relying on a caller to have checked first (TR-GATE-003).
    expect(run('G-04', { prior: null }).verdict).toBe(PASS);
    expect(run('G-04', { prior: {} }).verdict).toBe(PASS);
  });
});

describe('G-05 — no drop at all on a partial harvest', () => {
  it('rejects ANY drop when completeness is partial', () => {
    // Deliberately stricter than G-03: in a partial harvest absence carries no
    // information, so one missing review is as untrustworthy as a hundred.
    const outcome = run('G-05', {
      candidate: candidate({ completeness: 'partial', total_count: 99 }),
    });

    expect(outcome.verdict).toBe(REJECT);
    expect(outcome.detail).toContain('partial');
  });

  it('does not reject an unchanged count on a partial harvest', () => {
    const outcome = run('G-05', {
      candidate: candidate({ completeness: 'partial', total_count: 100 }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not reject growth on a partial harvest', () => {
    // Additions are still merged during a partial harvest; only absence is
    // untrusted. A payload that grew has not lost anything.
    const outcome = run('G-05', {
      candidate: candidate({ completeness: 'partial', total_count: 105 }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not apply when the harvest was complete', () => {
    const outcome = run('G-05', {
      candidate: candidate({ completeness: 'full', total_count: 50 }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('treats a missing prior as a count of zero rather than throwing', () => {
    // Called directly, bypassing the gate's first-publish skip. Any count is
    // >= 0, so a partial first publish passes rather than crashing.
    expect(
      run('G-05', { prior: null, candidate: candidate({ completeness: 'partial' }) }).verdict,
    ).toBe(PASS);
    expect(
      run('G-05', { prior: {}, candidate: candidate({ completeness: 'partial' }) }).verdict,
    ).toBe(PASS);
  });
});

describe('G-06 — quarantine rate', () => {
  it('rejects a rate beyond the threshold', () => {
    const outcome = run('G-06', {
      validation: validation({ considered: 100, quarantined: 10 }),
    });

    expect(outcome.verdict).toBe(REJECT);
    expect(outcome.observed).toBeCloseTo(0.1);
  });

  it('does not reject a rate at the threshold', () => {
    const outcome = run('G-06', { validation: validation({ considered: 100, quarantined: 5 }) });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not reject a clean harvest', () => {
    expect(run('G-06', {}).verdict).toBe(PASS);
  });
});

describe('G-07 — fatal findings', () => {
  it('rejects when a fatal finding remains', () => {
    const outcome = run('G-07', {
      validation: validation({ findings: [{ severity: 'fatal', code: 'X' }] }),
    });

    expect(outcome.verdict).toBe(REJECT);
  });

  it('does not reject on warnings or errors', () => {
    const outcome = run('G-07', {
      validation: validation({
        findings: [{ severity: 'warn' }, { severity: 'error' }, { severity: 'info' }],
      }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('tolerates a validation report with no findings array', () => {
    expect(run('G-07', { validation: {} }).verdict).toBe(PASS);
  });
});

describe('G-08 — coverage (warn only)', () => {
  it('warns below the coverage minimum', () => {
    const outcome = run('G-08', { candidate: candidate({ coverage: 0.5 }) });

    expect(outcome.verdict).toBe(WARN);
  });

  it('does not warn at or above the minimum', () => {
    expect(run('G-08', { candidate: candidate({ coverage: 0.95 }) }).verdict).toBe(PASS);
  });

  it('does not warn for a capped harvest, however low the coverage', () => {
    // A capped harvest stopped at OUR ceiling, so low coverage is by design.
    const outcome = run('G-08', {
      candidate: candidate({ coverage: 0.1, completeness: 'full_capped' }),
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not warn when the advertised total is unknown', () => {
    expect(run('G-08', { candidate: candidate({ coverage: null }) }).verdict).toBe(PASS);
  });
});

describe('G-09 — computed vs advertised mean (warn only)', () => {
  it('warns when the two diverge beyond tolerance', () => {
    const outcome = run('G-09', {
      candidate: candidate({ mean_rating: 4.5, advertised_rating: 3.0 }),
    });

    expect(outcome.verdict).toBe(WARN);
  });

  it('does not warn on a small divergence', () => {
    expect(
      run('G-09', { candidate: candidate({ mean_rating: 4.5, advertised_rating: 4.4 }) }).verdict,
    ).toBe(PASS);
  });

  it('does not warn when the source advertises no rating', () => {
    expect(run('G-09', { candidate: candidate({ advertised_rating: null }) }).verdict).toBe(PASS);
  });

  it('does not warn when nothing was published to compare', () => {
    const outcome = run('G-09', {
      candidate: candidate({ total_count: 0, mean_rating: 0, advertised_rating: 4.5 }),
    });

    expect(outcome.verdict).toBe(PASS);
  });
});

describe('G-10 — payload size (warn only)', () => {
  it('warns beyond the budget', () => {
    expect(run('G-10', { candidateBytes: 3_000_000 }).verdict).toBe(WARN);
  });

  it('does not warn within the budget', () => {
    expect(run('G-10', { candidateBytes: 1_000 }).verdict).toBe(PASS);
  });
});

describe('G-11 — near-duplicate clusters (warn only)', () => {
  it('warns on a cluster larger than three', () => {
    // a~b, b~c, c~d is one cluster of four, not three pairs.
    const outcome = run('G-11', {
      nearDuplicates: [
        { left: 'a', right: 'b' },
        { left: 'b', right: 'c' },
        { left: 'c', right: 'd' },
      ],
    });

    expect(outcome.verdict).toBe(WARN);
    expect(outcome.observed).toBe(4);
  });

  it('does not warn on a cluster of exactly three', () => {
    const outcome = run('G-11', {
      nearDuplicates: [
        { left: 'a', right: 'b' },
        { left: 'b', right: 'c' },
      ],
    });

    expect(outcome.verdict).toBe(PASS);
  });

  it('does not warn when there are no near-duplicates', () => {
    expect(run('G-11', {}).verdict).toBe(PASS);
  });
});

describe('G-12 — advertised total drop (warn only)', () => {
  it('warns on a large drop in the advertised total', () => {
    const outcome = run('G-12', { candidate: candidate({ advertised_total: 40 }) });

    expect(outcome.verdict).toBe(WARN);
  });

  it('does not warn on a small drop', () => {
    expect(run('G-12', { candidate: candidate({ advertised_total: 90 }) }).verdict).toBe(PASS);
  });

  it('does not warn when the prior advertised nothing', () => {
    expect(run('G-12', { prior: candidate({ advertised_total: null }) }).verdict).toBe(PASS);
  });

  it('does not warn when the prior advertised zero', () => {
    expect(run('G-12', { prior: candidate({ advertised_total: 0 }) }).verdict).toBe(PASS);
  });

  it('does not warn when the current total is unknown', () => {
    expect(run('G-12', { candidate: candidate({ advertised_total: null }) }).verdict).toBe(PASS);
  });
});

describe('quarantineRate', () => {
  it('is zero when nothing was considered', () => {
    // 0/0 is NaN, which compares false against every threshold and would let
    // G-06 silently pass.
    expect(quarantineRate({ considered: 0, quarantined: 0 })).toBe(0);
    expect(quarantineRate(undefined)).toBe(0);
  });

  it('is the ratio otherwise', () => {
    expect(quarantineRate({ considered: 200, quarantined: 20 })).toBeCloseTo(0.1);
  });
});

describe('largestCluster', () => {
  it('is zero with no pairs', () => {
    expect(largestCluster([])).toBe(0);
  });

  it('treats pairs as transitive', () => {
    expect(
      largestCluster([
        { left: 'a', right: 'b' },
        { left: 'b', right: 'c' },
      ]),
    ).toBe(3);
  });

  it('reports the largest of several disjoint clusters', () => {
    expect(
      largestCluster([
        { left: 'a', right: 'b' },
        { left: 'c', right: 'd' },
        { left: 'd', right: 'e' },
        { left: 'e', right: 'f' },
      ]),
    ).toBe(4);
  });

  it('does not double-count a pair reported twice', () => {
    expect(
      largestCluster([
        { left: 'a', right: 'b' },
        { left: 'a', right: 'b' },
      ]),
    ).toBe(2);
  });
});

describe('stats helper sanity', () => {
  it('builds a stats block that passes every rule', () => {
    for (const rule of RULES) {
      expect(rule.evaluate(context()).verdict, rule.id).toBe(PASS);
    }

    expect(stats().total_count).toBe(100);
  });
});
