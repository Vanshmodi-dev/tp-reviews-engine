/**
 * The policy preflight gate (DEL-69, §2.6).
 *
 * ## Seven checks, in order, failing fast
 *
 * The order is not arbitrary. The cheap, certain, local checks come first —
 * three kill switches that need no I/O — so a disabled client costs nothing to
 * skip. The checks that reach outside the process come last.
 *
 * | # | Check | Denial |
 * | --- | --- | --- |
 * | 1 | Global kill switch | `ERR-POLICY-KILLSWITCH` |
 * | 2 | Per-source enable flag | `ERR-POLICY-KILLSWITCH` |
 * | 3 | Client enabled | `ERR-POLICY-KILLSWITCH` |
 * | 4 | Authorisation record (**`dom` only**) | `ERR-POLICY-UNAUTHORIZED` |
 * | 5 | Robots directive, per mode | `ERR-POLICY-ROBOTS` |
 * | 6 | Rate-limit budget | `ERR-POLICY-BUDGET` |
 * | 7 | Circuit-breaker state | `ERR-POLICY-BREAKER-OPEN` |
 *
 * ## The verdict is recorded either way (TR-APP-010)
 *
 * Whether it allows or denies. **An audit trail that records only denials
 * proves nothing** — it cannot answer "was this client authorised on the day we
 * harvested it", which is the only question anyone will ever ask of it.
 *
 * ## Check 4 is skipped for official APIs (TR-APP-012)
 *
 * An authorisation record is a statement that the operator has permission to
 * harvest a listing by reading its page. A client using the official API needs
 * no such record, and demanding one would obstruct the migration path that
 * ADR-023 exists to keep open.
 *
 * ## A robots fetch that fails is `unknown`, never `allowed` (TR-APP-011)
 *
 * The distinction matters because the failure is silent otherwise. A directive
 * that could not be fetched is not permission; it is an absence of information,
 * and what to do about it is a configured decision — `block` denies, `warn` and
 * `ignore` proceed **with a recorded note**.
 *
 * @module app/preflight
 */

import { AUTHORISATION_FIELDS, AUTHORISED_RELATIONSHIPS } from './config/semantic.mjs';

/**
 * @typedef {object} PolicyReason
 * @property {number} check       1…7.
 * @property {string} name
 * @property {boolean} passed
 * @property {string | null} code
 * @property {string} detail
 */

/**
 * @typedef {object} PreflightVerdict
 * @property {boolean} allow
 * @property {PolicyReason[]} reasons
 * @property {string} recordedAt
 * @property {string | null} code   The denial class, or null.
 */

/** Robots handling modes (§2.6 check 5). */
export const ROBOTS_MODES = Object.freeze(['block', 'warn', 'ignore']);

/**
 * Runs the gate.
 *
 * Every check is supplied as data or as a small probe, so the ordering — the
 * part that is normative — is readable in one place and testable without a
 * network.
 *
 * @param {object} input
 * @param {any} input.target
 * @param {any} input.config          Effective config for this client.
 * @param {any} input.policy          `{ global_enabled, sources: { google: true } }`.
 * @param {any} [input.robots]        `{ allowed: boolean | null, detail?: string }`.
 * @param {any} [input.budget]        `{ allowed: boolean, reason?: string }`.
 * @param {any} [input.breaker]       `{ open: boolean, until?: string }`.
 * @param {string} input.recordedAt   RFC 3339. `app/` reads no clock.
 * @returns {PreflightVerdict}
 */
export function preflight(input) {
  /** @type {PolicyReason[]} */
  const reasons = [];

  for (const check of CHECKS) {
    const outcome = check.run(input);

    reasons.push({
      check: check.number,
      name: check.name,
      passed: outcome.passed,
      code: outcome.passed ? null : check.code,
      detail: outcome.detail,
    });

    // Fail fast. Continuing past a denial would produce reasons about a target
    // that is not going to run, and a reader cannot tell which one stopped it.
    if (!outcome.passed) {
      return { allow: false, reasons, recordedAt: input.recordedAt, code: check.code };
    }
  }

  return { allow: true, reasons, recordedAt: input.recordedAt, code: null };
}

/**
 * The seven checks, as data.
 *
 * As a list rather than a chain of `if`s so that the order is a value the tests
 * can assert against §2.6 directly — a reordering is then a diff in one array
 * rather than a subtle rewrite nobody notices.
 */
const CHECKS = Object.freeze([
  {
    number: 1,
    name: 'global-kill-switch',
    code: 'ERR-POLICY-KILLSWITCH',
    /** @param {any} input */
    run: (input) =>
      input.policy?.global_enabled === false
        ? { passed: false, detail: 'policy.global_enabled is false' }
        : { passed: true, detail: 'the global kill switch is not engaged' },
  },
  {
    number: 2,
    name: 'source-enabled',
    code: 'ERR-POLICY-KILLSWITCH',
    /** @param {any} input */
    run: (input) => {
      const source = input.target?.source;
      const enabled = input.policy?.sources?.[source];

      return enabled === false
        ? { passed: false, detail: `source "${source}" is disabled by policy` }
        : { passed: true, detail: `source "${source}" is enabled` };
    },
  },
  {
    number: 3,
    name: 'client-enabled',
    code: 'ERR-POLICY-KILLSWITCH',
    /** @param {any} input */
    run: (input) =>
      input.config?.enabled === false
        ? { passed: false, detail: 'the client is disabled in its configuration' }
        : { passed: true, detail: 'the client is enabled' },
  },
  {
    number: 4,
    name: 'authorisation-record',
    code: 'ERR-POLICY-UNAUTHORIZED',
    /** @param {any} input */
    run: (input) => {
      // TR-APP-012. An official-API client needs no authorisation record, and
      // demanding one would obstruct the migration path.
      if (input.target?.accessMethod !== 'dom') {
        return {
          passed: true,
          detail: `skipped: access method is "${input.target?.accessMethod}", not dom`,
        };
      }

      const record = input.config?.authorization ?? {};
      // The SAME five fields V-3 checks, imported rather than restated. This
      // list previously read `authorized_by, authorized_at, evidence` — a third
      // invented set, agreeing with neither the spec nor V-3, so a config that
      // passed validation was denied at preflight and vice versa.
      const missing = AUTHORISATION_FIELDS.filter((field) =>
        field === 'scope_ack'
          ? record[field] !== true
          : typeof record[field] !== 'string' || record[field].trim() === '',
      );

      if (missing.length > 0) {
        return {
          passed: false,
          detail: `the authorisation record is missing: ${missing.join(', ')}`,
        };
      }

      // CON-22. Checked here as well as in V-3 because they answer different
      // questions: V-3 asks "may this merge", preflight asks "may this run" —
      // and a config can reach production through a path that never re-ran
      // validate-config.
      return AUTHORISED_RELATIONSHIPS.includes(record['relationship'])
        ? {
            passed: true,
            detail: `authorised by ${record.authorized_by} as ${record.relationship}`,
          }
        : {
            passed: false,
            detail: `relationship "${record.relationship}" is not one of ${AUTHORISED_RELATIONSHIPS.join(' | ')}`,
          };
    },
  },
  {
    number: 5,
    name: 'robots-directive',
    code: 'ERR-POLICY-ROBOTS',
    /** @param {any} input */
    run: (input) => robotsCheck(input),
  },
  {
    number: 6,
    name: 'rate-budget',
    code: 'ERR-POLICY-BUDGET',
    /** @param {any} input */
    run: (input) =>
      input.budget?.allowed === false
        ? { passed: false, detail: input.budget.reason ?? 'the source budget is spent' }
        : { passed: true, detail: 'budget available' },
  },
  {
    number: 7,
    name: 'circuit-breaker',
    code: 'ERR-POLICY-BREAKER-OPEN',
    /** @param {any} input */
    run: (input) =>
      input.breaker?.open === true
        ? {
            passed: false,
            detail: `the breaker is open for this source-access pair until ${input.breaker.until ?? 'cooldown'}`,
          }
        : { passed: true, detail: 'the breaker is closed' },
  },
]);

/**
 * Check 5, where the interesting case is the one that is neither yes nor no.
 *
 * @param {any} input
 * @returns {{ passed: boolean, detail: string }}
 */
function robotsCheck(input) {
  const declared = input.config?.robots_mode;
  const mode = ROBOTS_MODES.includes(declared) ? declared : 'warn';
  const allowed = input.robots?.allowed ?? null;

  if (allowed === true) return { passed: true, detail: `robots allows this path (mode ${mode})` };

  return allowed === false ? disallowed(mode) : undetermined(mode, input.robots?.detail);
}

/**
 * @param {string} mode
 * @returns {{ passed: boolean, detail: string }}
 */
function disallowed(mode) {
  return mode === 'ignore'
    ? { passed: true, detail: 'robots disallows this path; mode is ignore, proceeding on record' }
    : { passed: false, detail: `robots disallows this path (mode ${mode})` };
}

/**
 * The case that is neither yes nor no.
 *
 * TR-APP-011: this MUST NOT silently pass. Under `warn` and `ignore` it
 * proceeds — but the note is the point. It is what makes the decision
 * auditable later, and without it "we did not know" is indistinguishable from
 * "we were allowed".
 *
 * @param {string} mode
 * @param {string | undefined} detail
 * @returns {{ passed: boolean, detail: string }}
 */
function undetermined(mode, detail) {
  if (mode === 'block') {
    return { passed: false, detail: 'the robots directive could not be determined; mode is block' };
  }

  return {
    passed: true,
    detail:
      `the robots directive could not be determined (${detail ?? 'no detail'}); ` +
      `mode is ${mode}, proceeding with this note recorded`,
  };
}

/**
 * The numbers and names, in order, for tests and for the manifest.
 *
 * @returns {Array<{ number: number, name: string, code: string }>}
 */
export function checkOrder() {
  return CHECKS.map(({ number, name, code }) => ({ number, name, code }));
}
