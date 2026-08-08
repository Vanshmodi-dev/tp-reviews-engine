import { describe, expect, it } from 'vitest';

import {
  ACCEPT,
  ACCEPT_WITH_WARNINGS,
  REJECT,
  downgradedRules,
  evaluateGate,
  forceIsEffective,
} from '../../../src/core/gate/index.mjs';
import {
  candidate,
  firedRules,
  gateInput,
  reasonFor,
  validation,
} from '../../helpers/gate-input.mjs';

describe('the gate accepts a healthy candidate', () => {
  it('returns ACCEPT with no reasons', () => {
    const verdict = evaluateGate(gateInput());

    expect(verdict.decision).toBe(ACCEPT);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.firstPublish).toBe(false);
  });

  it('returns a frozen verdict', () => {
    const verdict = evaluateGate(gateInput());

    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.reasons)).toBe(true);
  });

  it('tolerates a minimal input, filling defaults', () => {
    const verdict = evaluateGate({ candidate: candidate() });

    expect(verdict.firstPublish).toBe(true);
    expect(verdict.decision).toBe(ACCEPT);
  });
});

describe('it evaluates every rule and returns every reason (EDR-023, GATE-01)', () => {
  it('reports three violations as three reasons, not one', () => {
    // The whole point. An alert naming one problem when there are three means
    // the engineer fixes one, waits six hours, and is told about the next.
    const verdict = evaluateGate(
      gateInput({
        schemaErrors: ['bad'],
        candidate: candidate({ total_count: 0 }),
        validation: validation({ considered: 100, quarantined: 50 }),
      }),
    );

    expect(verdict.decision).toBe(REJECT);
    expect(firedRules(verdict)).toEqual(expect.arrayContaining(['G-01', 'G-02', 'G-06']));
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('does not stop at the first rejection', () => {
    // G-01 is evaluated first. If the gate short-circuited, nothing after it
    // would ever appear.
    const verdict = evaluateGate(
      gateInput({ schemaErrors: ['bad'], candidate: candidate({ total_count: 0 }) }),
    );

    expect(firedRules(verdict)).toContain('G-02');
  });

  it('carries the rule id, threshold and observed value on every reason', () => {
    // TR-GATE-002. A reason without the numbers is a reason nobody can act on.
    const verdict = evaluateGate(gateInput({ candidate: candidate({ total_count: 10 }) }));
    const reason = reasonFor(verdict, 'G-03');

    expect(reason.rule).toBe('G-03');
    expect(reason.threshold).toBe(0.2);
    expect(reason.observed).toBeCloseTo(0.9);
    expect(reason.statement).toContain('max_count_drop_ratio');
    expect(reason.errorClass).toBe('ERR-GATE-REJECT-COUNT-DROP');
  });

  it('reports warnings without rejecting', () => {
    const verdict = evaluateGate(gateInput({ candidateBytes: 5_000_000 }));

    expect(verdict.decision).toBe(ACCEPT_WITH_WARNINGS);
    expect(firedRules(verdict)).toEqual(['G-10']);
  });

  it('rejects when any reason rejects, even alongside warnings', () => {
    const verdict = evaluateGate(gateInput({ candidateBytes: 5_000_000, schemaErrors: ['bad'] }));

    expect(verdict.decision).toBe(REJECT);
  });
});

describe('the first-publish exception (TRD §26.4)', () => {
  it('skips the change-based rules when there is genuinely no prior', () => {
    const verdict = evaluateGate(gateInput({ prior: null }));

    expect(verdict.firstPublish).toBe(true);
    expect(verdict.skipped).toEqual(['G-02', 'G-03', 'G-04', 'G-05', 'G-12']);
  });

  it('still applies G-01, G-06, G-07 and G-08 on a first publish', () => {
    // TR-GATE-011: a first publish must still be rejectable for being invalid
    // or low-coverage. That is exactly what onboarding verification needs.
    const verdict = evaluateGate(
      gateInput({
        prior: null,
        schemaErrors: ['bad'],
        validation: validation({
          considered: 100,
          quarantined: 50,
          findings: [{ severity: 'fatal' }],
        }),
        candidate: candidate({ coverage: 0.1 }),
      }),
    );

    expect(firedRules(verdict)).toEqual(expect.arrayContaining(['G-01', 'G-06', 'G-07', 'G-08']));
    expect(verdict.decision).toBe(REJECT);
  });

  it('accepts an empty first publish, because there is nothing to protect', () => {
    const verdict = evaluateGate(
      gateInput({ prior: null, candidate: candidate({ total_count: 0 }) }),
    );

    expect(verdict.decision).toBe(ACCEPT);
  });
});

describe('an unreadable prior is a rejection, not a first publish (GATE-03, IR-25)', () => {
  it('rejects when the prior exists but could not be read', () => {
    // The trap this exists to close: a read failure masquerading as a first
    // publish would skip every change-based rule, and an empty candidate would
    // sail past G-02 and overwrite a healthy payload. The engine would delete a
    // client's reviews because it could not read a file.
    const verdict = evaluateGate(gateInput({ prior: null, priorReadable: false }));

    expect(verdict.decision).toBe(REJECT);
    expect(verdict.firstPublish).toBe(false);
    expect(reasonFor(verdict, 'G-00').detail).toContain('could not be read');
  });

  it('does not skip the change-based rules for an unreadable prior', () => {
    const verdict = evaluateGate(gateInput({ prior: null, priorReadable: false }));

    expect(verdict.skipped).toEqual([]);
  });

  it('still rejects an empty candidate when the prior is unreadable', () => {
    const verdict = evaluateGate(
      gateInput({ prior: null, priorReadable: false, candidate: candidate({ total_count: 0 }) }),
    );

    expect(verdict.decision).toBe(REJECT);
    expect(firedRules(verdict)).toContain('G-00');
  });

  it('distinguishes the two states in the verdict itself', () => {
    const missing = evaluateGate(gateInput({ prior: null, priorReadable: true }));
    const unreadable = evaluateGate(gateInput({ prior: null, priorReadable: false }));

    expect(missing.firstPublish).toBe(true);
    expect(unreadable.firstPublish).toBe(false);
    expect(missing.decision).toBe(ACCEPT);
    expect(unreadable.decision).toBe(REJECT);
  });
});

describe('force override (GATE-04, TRD §26.8)', () => {
  const force = { enabled: true, reason: 'client deleted a duplicate listing; verified manually' };

  it('downgrades G-03 to a warning', () => {
    const verdict = evaluateGate(gateInput({ candidate: candidate({ total_count: 10 }), force }));

    expect(verdict.decision).toBe(ACCEPT_WITH_WARNINGS);
    expect(reasonFor(verdict, 'G-03').downgraded).toBe(true);
  });

  it('downgrades exactly G-03, G-04, G-05 and G-12 and nothing else', () => {
    const verdict = evaluateGate(
      gateInput({
        candidate: candidate({
          total_count: 10,
          mean_rating: 1,
          completeness: 'partial',
          advertised_total: 10,
        }),
        force,
      }),
    );

    expect(downgradedRules(verdict).sort()).toEqual(['G-03', 'G-04', 'G-05']);
    expect(verdict.decision).toBe(ACCEPT_WITH_WARNINGS);
  });

  it('CANNOT downgrade G-06, whatever the operator intends', () => {
    // A high quarantine rate means the data is wrong, not merely different.
    const verdict = evaluateGate(
      gateInput({ validation: validation({ considered: 100, quarantined: 50 }), force }),
    );

    expect(verdict.decision).toBe(REJECT);
    expect(reasonFor(verdict, 'G-06').downgraded).toBeUndefined();
  });

  it('cannot downgrade G-01, G-02 or G-07 either', () => {
    for (const input of [
      { schemaErrors: ['bad'] },
      { candidate: candidate({ total_count: 0 }) },
      { validation: validation({ findings: [{ severity: 'fatal' }] }) },
    ]) {
      const verdict = evaluateGate(gateInput({ ...input, force }));

      expect(verdict.decision).toBe(REJECT);
    }
  });

  it('is ignored entirely on a scheduled run (TR-GATE-031)', () => {
    // An unattended job must never wave a rejection through: there is nobody
    // present to have verified anything.
    const verdict = evaluateGate(
      gateInput({
        candidate: candidate({ total_count: 10 }),
        force: { ...force, scheduled: true },
      }),
    );

    expect(verdict.decision).toBe(REJECT);
  });

  it('is ignored without a written reason (TR-GATE-030)', () => {
    for (const bad of [
      { enabled: true },
      { enabled: true, reason: '' },
      { enabled: true, reason: '   ' },
    ]) {
      const verdict = evaluateGate(
        gateInput({ candidate: candidate({ total_count: 10 }), force: bad }),
      );

      expect(verdict.decision).toBe(REJECT);
    }
  });

  it('is ignored when not enabled', () => {
    const verdict = evaluateGate(
      gateInput({
        candidate: candidate({ total_count: 10 }),
        force: { enabled: false, reason: 'x' },
      }),
    );

    expect(verdict.decision).toBe(REJECT);
  });

  it('reports what was actually downgraded, not what was requested', () => {
    // A force on a run where nothing fired downgrades nothing, and the audit
    // record must say so rather than implying rules were waved through.
    expect(downgradedRules(evaluateGate(gateInput({ force })))).toEqual([]);
  });
});

describe('forceIsEffective', () => {
  it('requires enabled, a non-empty reason, and a non-scheduled run', () => {
    expect(forceIsEffective(undefined)).toBe(false);
    expect(forceIsEffective({ enabled: false, reason: 'x' })).toBe(false);
    expect(forceIsEffective({ enabled: true })).toBe(false);
    expect(forceIsEffective({ enabled: true, reason: '  ' })).toBe(false);
    expect(forceIsEffective({ enabled: true, reason: 'x', scheduled: true })).toBe(false);
    expect(forceIsEffective({ enabled: true, reason: 'x' })).toBe(true);
    expect(forceIsEffective({ enabled: true, reason: 'x', scheduled: false })).toBe(true);
  });
});

describe('PT-14 — force is monotone in safety (GATE-02)', () => {
  it('never turns a REJECT into an ACCEPT for a non-overridable rule', () => {
    // The safety property: forcing can only ever move a verdict toward
    // ACCEPT_WITH_WARNINGS, and only for rules that permit it. It can never
    // make a run that would have rejected on a defect publish cleanly.
    const force = { enabled: true, reason: 'verified' };
    const cases = [
      { schemaErrors: ['bad'] },
      { candidate: candidate({ total_count: 0 }) },
      { validation: validation({ considered: 10, quarantined: 9 }) },
      { validation: validation({ findings: [{ severity: 'fatal' }] }) },
    ];

    for (const input of cases) {
      expect(evaluateGate(gateInput(input)).decision).toBe(REJECT);
      expect(evaluateGate(gateInput({ ...input, force })).decision).toBe(REJECT);
    }
  });

  it('never introduces a reason that forcing did not already produce', () => {
    const force = { enabled: true, reason: 'verified' };
    const plain = evaluateGate(gateInput({ candidate: candidate({ total_count: 10 }) }));
    const forced = evaluateGate(gateInput({ candidate: candidate({ total_count: 10 }), force }));

    expect(firedRules(forced)).toEqual(firedRules(plain));
  });
});
