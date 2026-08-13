import { describe, expect, it } from 'vitest';

import { blocks, validateSemantics } from '../../../src/app/config/semantic.mjs';

/**
 * V-1…V-12 (TRD §49.2).
 *
 * V-1 through V-7 block a merge; V-8 through V-12 are deliberate friction.
 *
 * **V-3 gets two tests, both ways**, because T-174's stated verification is that
 * a reviewer checks it in both directions. A compliance gate that only ever
 * fires is as useless as one that never does: the first blocks every config and
 * gets disabled, the second guarantees nothing.
 */

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
const config = (overrides = {}) => ({
  slug: 'acme-dental',
  tier: 'standard',
  cadence: 'daily',
  listings: [
    {
      key: 'main',
      adapter: 'csv',
      expected_name: 'Acme Dental',
      identity: { place_id: 'ChIJ-example' },
    },
  ],
  ...overrides,
});

/**
 * @param {any} result
 * @param {string} rule
 * @returns {any}
 */
const forRule = (result, rule) => result.filter((/** @type {any} */ f) => f.rule === rule);

describe('a well-formed config produces no errors', () => {
  it('passes every blocking rule', () => {
    const findings = validateSemantics(config(), { filename: 'acme-dental.config.json' });

    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(blocks(findings)).toBe(false);
  });
});

describe('V-1 — the slug must equal the filename stem', () => {
  it('rejects a mismatch', () => {
    // The slug is a path segment on `data`. A mismatch means the file and the
    // directory it publishes into disagree.
    const findings = validateSemantics(config({ slug: 'wrong' }), {
      filename: 'acme-dental.config.json',
    });

    expect(forRule(findings, 'V-1')).toHaveLength(1);
  });

  it('accepts a match, with or without the .config suffix', () => {
    expect(
      forRule(validateSemantics(config(), { filename: 'acme-dental.config.json' }), 'V-1'),
    ).toEqual([]);
    expect(forRule(validateSemantics(config(), { filename: 'acme-dental.json' }), 'V-1')).toEqual(
      [],
    );
  });

  it('does not fire when no filename is supplied', () => {
    expect(forRule(validateSemantics(config()), 'V-1')).toEqual([]);
  });
});

describe('V-2 — listing keys unique within a client', () => {
  it('rejects a duplicate key', () => {
    // Two listings sharing a key write the same ledger path, so one silently
    // overwrites the other on every run.
    const findings = validateSemantics(
      config({
        listings: [
          { key: 'main', adapter: 'csv', expected_name: 'A', identity: { url: 'u' } },
          { key: 'main', adapter: 'csv', expected_name: 'B', identity: { url: 'u' } },
        ],
      }),
    );

    expect(forRule(findings, 'V-2')).toHaveLength(1);
  });

  it('accepts distinct keys', () => {
    const findings = validateSemantics(
      config({
        listings: [
          { key: 'main', adapter: 'csv', expected_name: 'A', identity: { url: 'u' } },
          { key: 'branch', adapter: 'csv', expected_name: 'B', identity: { url: 'u' } },
        ],
      }),
    );

    expect(forRule(findings, 'V-2')).toEqual([]);
  });
});

describe('V-3 — the compliance gate (TR-CFG-041)', () => {
  const domListing = (/** @type {any} */ authorization = undefined) => ({
    key: 'main',
    adapter: 'google:dom',
    expected_name: 'Acme Dental',
    identity: { place_id: 'ChIJ-example' },
    ...(authorization === undefined ? {} : { authorization }),
  });

  // SAD §15.6's five fields. This fixture previously used four invented names
  // and omitted `relationship` entirely, so every assertion below was checking
  // a vocabulary the specification never defined.
  const complete = {
    authorized_by: 'Dana Smith, Practice Manager',
    authorization_date: '2026-01-15',
    relationship: 'owner',
    evidence_ref: 'compliance/authorizations/acme-dental.md',
    scope_ack: true,
  };

  it('BLOCKS a DOM adapter with no authorization block at all', () => {
    // Direction one. Reading a source's rendered pages for a client without
    // their written authorisation is not a technical problem.
    const findings = validateSemantics(config({ listings: [domListing()] }));

    expect(forRule(findings, 'V-3')).toHaveLength(1);
    expect(blocks(findings)).toBe(true);
  });

  it('ACCEPTS a DOM adapter with a complete authorization block', () => {
    // Direction two, and the one usually skipped. A gate that fires on every
    // config gets disabled, and then it guarantees nothing.
    const findings = validateSemantics(config({ listings: [domListing(complete)] }));

    expect(forRule(findings, 'V-3')).toEqual([]);
  });

  it('blocks a partially complete block, naming what is missing', () => {
    const { evidence_ref: _omitted, ...partial } = complete;
    const findings = validateSemantics(config({ listings: [domListing(partial)] }));

    expect(forRule(findings, 'V-3')[0].message).toContain('evidence_ref');
  });

  it('treats an empty string as missing', () => {
    const findings = validateSemantics(
      config({ listings: [domListing({ ...complete, authorized_by: '   ' })] }),
    );

    expect(forRule(findings, 'V-3')).toHaveLength(1);
  });

  it('accepts authorisation declared at the client level', () => {
    const findings = validateSemantics(
      config({ listings: [domListing()], authorization: complete }),
    );

    expect(forRule(findings, 'V-3')).toEqual([]);
  });

  it('BLOCKS a relationship the SAD does not permit (CON-22)', () => {
    // The case the gate exists for. Every other field can be perfectly filled
    // in for a listing the client neither owns nor represents — a competitor's
    // — and until PH-25 nothing in the system looked at this field.
    const findings = validateSemantics(
      config({ listings: [domListing({ ...complete, relationship: 'competitor' })] }),
    );

    expect(forRule(findings, 'V-3')).toHaveLength(1);
    expect(forRule(findings, 'V-3')[0].message).toContain('owner | authorized_agent');
    expect(blocks(findings)).toBe(true);
  });

  it('ACCEPTS an authorized_agent, the other permitted relationship', () => {
    const findings = validateSemantics(
      config({ listings: [domListing({ ...complete, relationship: 'authorized_agent' })] }),
    );

    expect(forRule(findings, 'V-3')).toEqual([]);
  });

  it('treats scope_ack: false as a refusal, not as a present value', () => {
    // It is a boolean acknowledgement. A string-presence check would have read
    // `false` as filled in, which inverts what the field means.
    const findings = validateSemantics(
      config({ listings: [domListing({ ...complete, scope_ack: false })] }),
    );

    expect(forRule(findings, 'V-3')).toHaveLength(1);
    expect(forRule(findings, 'V-3')[0].message).toContain('scope_ack');
  });

  it('does not apply to adapters that read no rendered pages', () => {
    // The CSV adapter reads a file the client supplied. There is nothing to
    // authorise.
    expect(forRule(validateSemantics(config()), 'V-3')).toEqual([]);
  });
});

describe('V-4 — declared secrets must exist at run time', () => {
  it('rejects a missing secret', () => {
    // Caught here rather than mid-harvest, after budget has been spent.
    const findings = validateSemantics(config({ secrets: ['TPRE_GOOGLE_API_KEY'] }), { env: {} });

    expect(forRule(findings, 'V-4')).toHaveLength(1);
  });

  it('accepts a present secret', () => {
    const findings = validateSemantics(config({ secrets: ['TPRE_GOOGLE_API_KEY'] }), {
      env: { TPRE_GOOGLE_API_KEY: 'value' },
    });

    expect(forRule(findings, 'V-4')).toEqual([]);
  });

  it('does not fire when no environment is supplied', () => {
    expect(forRule(validateSemantics(config({ secrets: ['X'] })), 'V-4')).toEqual([]);
  });
});

describe('V-5 — no override exceeds a hard ceiling', () => {
  it('rejects a ceiling breach and explains why', () => {
    const findings = validateSemantics(config({ nav: { max_reviews: 9999 } }));

    expect(forRule(findings, 'V-5')).toHaveLength(1);
    expect(forRule(findings, 'V-5')[0].message).toContain('ceiling');
  });

  it('accepts values within bounds', () => {
    expect(forRule(validateSemantics(config({ nav: { max_reviews: 500 } })), 'V-5')).toEqual([]);
  });
});

describe('V-6 and V-11 — reaching a listing at all', () => {
  const bare = { key: 'main', adapter: 'csv', expected_name: 'Acme' };

  it('V-6 blocks when search is disabled and no identifier is given', () => {
    const findings = validateSemantics(
      config({ listings: [bare], resolution: { allow_search: false } }),
    );

    expect(forRule(findings, 'V-6')).toHaveLength(1);
    expect(blocks(findings)).toBe(true);
  });

  it('V-6 accepts a cid or a url as well as a place_id', () => {
    for (const identity of [{ cid: '123' }, { url: 'https://example.test' }]) {
      const findings = validateSemantics(
        config({ listings: [{ ...bare, identity }], resolution: { allow_search: false } }),
      );

      expect(forRule(findings, 'V-6')).toEqual([]);
    }
  });

  it('V-11 warns rather than blocks when search is allowed', () => {
    const findings = validateSemantics(config({ listings: [bare] }));

    expect(forRule(findings, 'V-11')).toHaveLength(1);
    expect(blocks(findings)).toBe(false);
  });
});

describe('V-7 — every listing needs an expected name', () => {
  it('blocks a listing with none', () => {
    // The expected name is what identity verification compares against.
    // Without it the engine cannot tell it resolved the wrong business, which
    // is the failure that publishes a stranger's reviews.
    const findings = validateSemantics(
      config({ listings: [{ key: 'main', adapter: 'csv', identity: { url: 'u' } }] }),
    );

    expect(forRule(findings, 'V-7')).toHaveLength(1);
    expect(forRule(findings, 'V-7')[0].message).toContain('right business');
  });
});

describe('V-8 — filtering by rating is deliberate friction', () => {
  it('warns when min_rating is set without a justification', () => {
    const findings = validateSemantics(config({ display: { min_rating: 4 } }));

    expect(forRule(findings, 'V-8')).toHaveLength(1);
    expect(blocks(findings)).toBe(false);
  });

  it('is satisfied by a written note', () => {
    const findings = validateSemantics(
      config({ display: { min_rating: 4 }, notes: 'Required by platform policy in this market.' }),
    );

    expect(forRule(findings, 'V-8')).toEqual([]);
  });

  it('does not fire for the default of null', () => {
    expect(forRule(validateSemantics(config({ display: { min_rating: null } })), 'V-8')).toEqual(
      [],
    );
  });
});

describe('V-9, V-10 and V-12 — the remaining warnings', () => {
  it('V-9 warns when schema.org is enabled without acknowledgement', () => {
    const findings = validateSemantics(config({ publish: { schema_org: true } }));

    expect(forRule(findings, 'V-9')).toHaveLength(1);
    expect(forRule(findings, 'V-9')[0].message).toContain('manual action');
  });

  it('V-9 is satisfied by the acknowledgement', () => {
    const findings = validateSemantics(
      config({ publish: { schema_org: true, schema_org_policy_acknowledged: true } }),
    );

    expect(forRule(findings, 'V-9')).toEqual([]);
  });

  it('V-10 warns above a half-count drop tolerance', () => {
    const findings = validateSemantics(config({ gate: { max_count_drop_ratio: 0.8 } }));

    expect(forRule(findings, 'V-10')).toHaveLength(1);
    expect(
      forRule(validateSemantics(config({ gate: { max_count_drop_ratio: 0.5 } })), 'V-10'),
    ).toEqual([]);
  });

  it('V-12 warns on a contradictory tier and cadence', () => {
    const findings = validateSemantics(config({ tier: 'premium', cadence: 'daily' }));

    expect(forRule(findings, 'V-12')).toHaveLength(1);
  });
});

describe('the blocking split (TR-CFG-040)', () => {
  it('treats V-1 to V-7 as errors and V-8 to V-12 as warnings', () => {
    const findings = validateSemantics(
      config({
        slug: 'wrong',
        display: { min_rating: 4 },
        publish: { schema_org: true },
        tier: 'premium',
      }),
      { filename: 'acme-dental.config.json' },
    );

    const errors = new Set(findings.filter((f) => f.severity === 'error').map((f) => f.rule));
    const warnings = new Set(findings.filter((f) => f.severity === 'warning').map((f) => f.rule));

    expect([...errors].every((rule) => Number(rule.slice(2)) <= 7)).toBe(true);
    expect([...warnings].every((rule) => Number(rule.slice(2)) >= 8)).toBe(true);
  });

  it('reports every finding, not the first', () => {
    // A validator reporting one problem per run turns a five-minute config fix
    // into four review cycles.
    const findings = validateSemantics(
      config({
        slug: 'wrong',
        listings: [
          { key: 'dup', adapter: 'google:dom' },
          { key: 'dup', adapter: 'csv', expected_name: 'B', identity: { url: 'u' } },
        ],
      }),
      { filename: 'acme-dental.config.json' },
    );

    expect(findings.length).toBeGreaterThan(3);
  });

  it('tolerates a config with no listings at all', () => {
    expect(() => validateSemantics({})).not.toThrow();
  });
});
