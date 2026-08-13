/**
 * The authorisation record, asserted against the specification (SAD §15.6).
 *
 * ## Why this file exists
 *
 * The authorisation gate is the one non-waivable control in the system
 * (§65.2 item 11, V-3, CON-22). It is checked in two places — `validate-config`
 * decides whether a config may MERGE, the preflight decides whether a target
 * may RUN — and until PH-25 those two places, plus the specification, used
 * three different sets of field names:
 *
 * | Source | Fields |
 * |---|---|
 * | SAD §15.6 / TRD §72.4 | `authorized_by` `authorization_date` `relationship` `evidence_ref` `scope_ack` |
 * | `semantic.mjs` V-3 | `granted_by` `granted_at` `evidence_url` `scope` |
 * | `preflight.mjs` check 4 | `authorized_by` `authorized_at` `evidence` |
 *
 * None of the three agreed. The consequences were not cosmetic:
 *
 * 1. The canonical client config printed in TRD §72 failed validation.
 * 2. No config could satisfy both controls at once, so no DOM client could be
 *    onboarded by any means.
 * 3. `relationship` — the field that records whether the client owns the
 *    listing or merely represents it — was checked NOWHERE. CON-22, the
 *    constraint the entire legal position rests on, had no mechanism.
 *
 * Every one of those was invisible to the existing tests, because each side was
 * tested against its own invented vocabulary. A test that asserts an
 * implementation against itself cannot detect that the implementation is
 * answering the wrong question.
 *
 * So this file asserts against the SPEC, and asserts the two implementations
 * agree with each other. The field list is deliberately written out longhand
 * below rather than imported: importing it would make this file pass
 * automatically whenever the constant changed, which is the exact failure it
 * exists to catch.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTHORISATION_FIELDS,
  AUTHORISED_RELATIONSHIPS,
  validateSemantics,
} from '../../../src/app/config/semantic.mjs';
import { preflight } from '../../../src/app/preflight.mjs';

/** SAD §15.6, transcribed. Changing this requires changing the SAD first. */
const SPEC_FIELDS = [
  'authorized_by',
  'authorization_date',
  'relationship',
  'evidence_ref',
  'scope_ack',
];

/** SAD §15.6: "`owner` | `authorized_agent` — no other value permitted". */
const SPEC_RELATIONSHIPS = ['owner', 'authorized_agent'];

/** The canonical block from TRD §72's worked example, verbatim. */
const CANONICAL = Object.freeze({
  authorized_by: 'Founder, Commerce Insight',
  authorization_date: '2026-07-22',
  relationship: 'owner',
  evidence_ref: 'compliance/authorizations/commerce-insight.md',
  scope_ack: true,
});

/**
 * No default value, deliberately.
 *
 * `authorization = CANONICAL` would substitute a complete block for the very
 * case that passes `undefined` — "no block at all" — so the test asserting a
 * missing record is rejected would have been silently testing a present one.
 * That is the same defect the PH-17 preflight fixture had, and it is why this
 * argument is required.
 *
 * @param {any} authorization
 * @returns {any}
 */
const domConfig = (authorization) => ({
  slug: 'commerce-insight',
  authorization,
  listings: [{ key: 'main', adapter: 'google:dom' }],
});

/**
 * @param {any} findings
 * @returns {any[]}
 */
const v3 = (findings) => findings.filter((/** @type {any} */ f) => f.rule === 'V-3');

/**
 * Runs the preflight with checks 1-3 satisfied, and reports check 4's verdict.
 *
 * The preflight fails fast, so isolating check 4 means giving it a target that
 * gets that far. `undefined` rather than a boolean when it never ran, so a
 * test cannot mistake "not reached" for "denied".
 *
 * @param {any} authorization
 * @returns {boolean | undefined}
 */
function authorisationCheck(authorization) {
  const verdict = preflight({
    target: { source: 'google', accessMethod: 'dom' },
    config: { enabled: true, robots_mode: 'warn', authorization: authorization ?? {} },
    policy: { global_enabled: true, sources: { google: true } },
    robots: { allowed: true },
    budget: { allowed: true },
    recordedAt: '2026-08-13T00:00:00.000Z',
  });

  return verdict.reasons.find((/** @type {any} */ reason) => reason.check === 4)?.passed;
}

describe('the field set matches SAD §15.6 exactly', () => {
  it('names the five specified fields, and no others', () => {
    expect([...AUTHORISATION_FIELDS].sort()).toEqual([...SPEC_FIELDS].sort());
  });

  it('includes relationship — the field CON-22 depends on', () => {
    // Called out separately because it is the one that was missing, and its
    // absence is silent: every other field being present makes the block LOOK
    // complete.
    expect(AUTHORISATION_FIELDS).toContain('relationship');
  });

  it('permits exactly the two relationships the SAD allows', () => {
    expect([...AUTHORISED_RELATIONSHIPS].sort()).toEqual([...SPEC_RELATIONSHIPS].sort());
  });
});

describe('the canonical config from the TRD is accepted', () => {
  it('passes V-3', () => {
    // The regression that started this. Our own documentation's worked example
    // was rejected by our own validator.
    expect(v3(validateSemantics(domConfig(CANONICAL)))).toEqual([]);
  });

  it('passes the preflight authorisation check', () => {
    expect(authorisationCheck(CANONICAL)).toBe(true);
  });
});

describe('both controls accept and reject the same blocks', () => {
  /**
   * Each case: a label, a block, and whether it should be authorised.
   *
   * @type {ReadonlyArray<[string, any, boolean]>}
   */
  const cases = [
    ['the canonical block', CANONICAL, true],
    ['an authorized_agent', { ...CANONICAL, relationship: 'authorized_agent' }, true],
    ['no block at all', undefined, false],
    ['an empty block', {}, false],
    ['a missing authorized_by', { ...CANONICAL, authorized_by: undefined }, false],
    ['a blank authorized_by', { ...CANONICAL, authorized_by: '   ' }, false],
    ['a missing evidence_ref', { ...CANONICAL, evidence_ref: undefined }, false],
    // The acknowledgement is a boolean. `false` is an explicit refusal to
    // acknowledge scope, and a string check would have read it as present.
    ['scope_ack false', { ...CANONICAL, scope_ack: false }, false],
    ['scope_ack missing', { ...CANONICAL, scope_ack: undefined }, false],
    // CON-22: a competitor's listing is the case the whole gate exists for.
    ['relationship "competitor"', { ...CANONICAL, relationship: 'competitor' }, false],
    ['relationship "none"', { ...CANONICAL, relationship: 'none' }, false],
    ['relationship missing', { ...CANONICAL, relationship: undefined }, false],
  ];

  it.each(cases)('V-3 and preflight agree on %s', (_label, block, authorised) => {
    const mergeAllowed = v3(validateSemantics(domConfig(block))).length === 0;
    const runAllowed = authorisationCheck(block);

    // The property that was broken: "may this merge" and "may this run" must
    // give the same answer about the same record. When they disagree, one of
    // them is wrong and nobody finds out until a client is half-onboarded.
    expect(mergeAllowed).toBe(authorised);
    expect(runAllowed).toBe(authorised);
  });
});

describe('official-API listings still need no authorisation record (TR-CFG-101)', () => {
  it('does not demand one for a non-dom adapter', () => {
    // Requiring it here would obstruct the migration path ADR-023 exists to
    // keep open — the contingency for RISK-03.
    const config = {
      slug: 'x',
      listings: [{ key: 'main', adapter: 'google:business-profile-api' }],
    };

    expect(v3(validateSemantics(config))).toEqual([]);
  });
});
