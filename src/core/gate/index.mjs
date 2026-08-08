/**
 * The Publish Gate — the last thing between a candidate payload and a client's
 * website (T-124, TRD §26).
 *
 * Pure, and it receives **both** the candidate and the currently published
 * payload, which is what lets it reason about *change* rather than only about
 * state. "180 reviews" is fine; "180 reviews where there were 1,100 yesterday"
 * is not, and only a function holding both can tell the difference.
 *
 * ## It evaluates every rule, every time (EDR-023, GATE-01)
 *
 * The obvious implementation returns on the first failure. This one does not,
 * and the reason is operational rather than aesthetic: an alert that names one
 * problem when there are four means the engineer fixes one, waits for the next
 * harvest, and is told about the second. At a six-hour cadence that is a day of
 * latency per concurrent problem. So every rule runs on every invocation and
 * the verdict carries every reason, each with the rule id, the threshold, and
 * the observed value (TR-GATE-002).
 *
 * ## The first-publish exception, and the trap inside it (GATE-03, IR-25)
 *
 * On a client's first publish there is no prior payload, so the change-based
 * rules have nothing to compare against and are skipped.
 *
 * **"There is no prior payload" and "the prior payload could not be read" are
 * not the same thing**, and conflating them is rated `Critical`. A read failure
 * — a corrupt file, a truncated fetch, a permissions error — would masquerade as
 * a first publish, every change-based rule would be skipped, and an empty
 * candidate would sail past G-02 and overwrite a healthy payload. The engine
 * would delete a client's reviews because it could not read a file.
 *
 * So an unreadable prior is a **rejection**, not an exception. It is the one
 * condition here that is not a rule: no rule can express "I do not know what
 * the current state is", because every rule's job is to compare against it.
 *
 * ## Force override (GATE-04, TRD §26.8)
 *
 * `--force-publish` downgrades G-03, G-04, G-05 and G-12 to warnings. It cannot
 * touch G-01, G-02, G-06 or G-07, which indicate a defect or genuine corruption
 * rather than a disagreement about a threshold. `quarantine_max` in particular
 * is not overridable at any strength of operator conviction, because a high
 * quarantine rate means the data is wrong.
 *
 * @module core/gate
 */

import { GATE_DEFAULTS, PASS, REJECT, RULES, WARN, isChangeBased } from './rules.mjs';

export const ACCEPT = 'ACCEPT';
export const ACCEPT_WITH_WARNINGS = 'ACCEPT_WITH_WARNINGS';
export { REJECT } from './rules.mjs';

/**
 * @typedef {object} GateReason
 * @property {string} rule       The rule id, e.g. `G-03`.
 * @property {string} verdict    `REJECT` or `WARN` after any downgrade.
 * @property {string} statement  What the rule requires.
 * @property {string} detail     What actually happened.
 * @property {unknown} observed
 * @property {unknown} threshold
 * @property {string | null} errorClass
 * @property {boolean} [downgraded] True when force turned a REJECT into a WARN.
 */

/**
 * @typedef {object} GateVerdict
 * @property {string} decision   `ACCEPT` | `ACCEPT_WITH_WARNINGS` | `REJECT`.
 * @property {ReadonlyArray<GateReason>} reasons  Every violated rule, never just the first.
 * @property {ReadonlyArray<string>} skipped      Rules not applicable to this invocation.
 * @property {boolean} firstPublish
 */

/**
 * @typedef {object} GateInput
 * @property {Record<string, any>} candidate
 * @property {Record<string, any> | null} [prior]
 * @property {boolean} [priorReadable]  Default true. False means it exists but could not be read.
 * @property {any} [validation]
 * @property {any} [thresholds]
 * @property {number} [candidateBytes]
 * @property {ReadonlyArray<string>} [schemaErrors]
 * @property {ReadonlyArray<any>} [nearDuplicates]
 * @property {{ enabled: boolean, reason?: string, scheduled?: boolean }} [force]
 */

/** The rules `--force-publish` may downgrade. Everything else is immovable. */
const FORCE_DOWNGRADABLE = Object.freeze(['G-03', 'G-04', 'G-05', 'G-12']);

/**
 * Whether a force request is honoured.
 *
 * A scheduled run ignores force flags entirely (TR-GATE-031) — an unattended
 * job must never be able to wave a rejection through, because there is nobody
 * present to have verified anything. And force without a written reason is not
 * a force at all (TR-GATE-030): the audit trail is the point.
 *
 * @param {GateInput['force']} force
 * @returns {boolean}
 */
export function forceIsEffective(force) {
  if (force === undefined || force.enabled !== true) return false;
  if (force.scheduled === true) return false;

  return typeof force.reason === 'string' && force.reason.trim() !== '';
}

/**
 * Evaluates every rule and returns every reason.
 *
 * @param {GateInput} input
 * @returns {GateVerdict}
 */
export function evaluateGate(input) {
  const context = buildContext(input);
  const { priorReadable, firstPublish } = context;
  const force = forceIsEffective(input.force);
  /** @type {GateReason[]} */
  const reasons = [];
  /** @type {string[]} */
  const skipped = [];

  for (const rule of RULES) {
    if (firstPublish && isChangeBased(rule.id)) {
      skipped.push(rule.id);
      continue;
    }

    const outcome = rule.evaluate(context);
    if (outcome.verdict === PASS) continue;

    reasons.push(toReason(rule, outcome, force));
  }

  // Not a rule, and it cannot be one: every rule's job is to compare against
  // the current state, and this is the case where the current state is unknown.
  if (!priorReadable) {
    reasons.push(unreadablePriorReason());
  }

  return Object.freeze({
    decision: decide(reasons),
    reasons: Object.freeze(reasons),
    skipped: Object.freeze(skipped),
    firstPublish,
  });
}

/**
 * Resolves every optional input to its default, once, so no rule has to.
 *
 * @param {GateInput} input
 * @returns {import('./rules.mjs').GateContext}
 */
function buildContext(input) {
  const prior = input.prior ?? null;
  const priorReadable = input.priorReadable ?? true;

  return {
    candidate: input.candidate,
    prior,
    priorReadable,
    // A first publish is "no prior AND we could read enough to know that". The
    // second half is the whole of GATE-03.
    firstPublish: prior === null && priorReadable,
    validation: input.validation ?? { considered: 0, quarantined: 0, findings: [] },
    thresholds: { ...GATE_DEFAULTS, ...(input.thresholds ?? {}) },
    candidateBytes: input.candidateBytes ?? 0,
    schemaErrors: input.schemaErrors ?? [],
    nearDuplicates: input.nearDuplicates ?? [],
  };
}

/**
 * @param {any} rule
 * @param {any} outcome
 * @param {boolean} force
 * @returns {GateReason}
 */
function toReason(rule, outcome, force) {
  const downgraded =
    force && outcome.verdict === REJECT && FORCE_DOWNGRADABLE.includes(rule.id) && rule.overridable;

  return {
    rule: rule.id,
    verdict: downgraded ? WARN : outcome.verdict,
    statement: rule.statement,
    detail: outcome.detail,
    observed: outcome.observed,
    threshold: outcome.threshold,
    errorClass: rule.errorClass ?? null,
    ...(downgraded ? { downgraded: true } : {}),
  };
}

/**
 * @returns {GateReason}
 */
function unreadablePriorReason() {
  return {
    rule: 'G-00',
    verdict: REJECT,
    statement: 'The currently published payload must be readable before it is replaced',
    detail:
      'the prior payload exists but could not be read; this is not a first publish and the ' +
      'change-based rules cannot be evaluated',
    observed: 'unreadable',
    threshold: 'readable',
    errorClass: 'ERR-GATE-REJECT-SCHEMA',
  };
}

/**
 * @param {ReadonlyArray<GateReason>} reasons
 * @returns {string}
 */
function decide(reasons) {
  if (reasons.some((reason) => reason.verdict === REJECT)) return REJECT;
  if (reasons.length > 0) return ACCEPT_WITH_WARNINGS;

  return ACCEPT;
}

/**
 * The rules a force request would downgrade, for the audit record.
 *
 * Reported from the verdict rather than from the request, so the manifest
 * records what was actually waved through rather than what the operator asked
 * for. Those differ whenever a force names rules that did not fire.
 *
 * @param {GateVerdict} verdict
 * @returns {string[]}
 */
export function downgradedRules(verdict) {
  return verdict.reasons
    .filter((reason) => reason.downgraded === true)
    .map((reason) => reason.rule);
}

export { RULES, GATE_DEFAULTS, getRule, largestCluster, quarantineRate } from './rules.mjs';
