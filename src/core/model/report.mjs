/**
 * The four reports each pipeline stage produces.
 *
 * These are what make an incident diagnosable from artifacts alone. A harvest
 * that goes wrong leaves behind an `AcquisitionReport` saying how far it got
 * and why it stopped, a `ValidationReport` saying what was wrong with the data,
 * a `DecisionLog` saying what changed in the ledger, and a `GateVerdict` saying
 * whether any of it reached a visitor — and the four together answer almost
 * every question an on-call engineer has.
 *
 * TRD §7.4 and §26 are the authority.
 *
 * @module core/model/report
 */

/**
 * Why pagination stopped (ALG-PAGINATE, §19.4).
 *
 * Note that challenge detection reports `error` here rather than a reason of
 * its own: the stop reason says how the loop ended, and the error class says
 * what happened. Two vocabularies for one event is how an alert ends up
 * disagreeing with itself.
 */
export const STOP_REASONS = Object.freeze([
  'cap_reached',
  'target_reached',
  'stalled',
  'budget_exhausted',
  'error',
]);

/** Finding severities, ascending. `fatal` is what gate rule G-07 looks for. */
export const SEVERITIES = Object.freeze(['info', 'warn', 'error', 'fatal']);

/** What the Gate decided. */
export const GATE_DECISIONS = Object.freeze(['ACCEPT', 'REJECT']);

/**
 * The twelve Publish Gate rules (§26.3), as data.
 *
 * **`overridable: false` on G-06 is not an oversight.** `--force-publish`
 * downgrades the rules an operator can reasonably judge in the moment; the
 * quarantine rate is not one of them, because a high quarantine rate means the
 * engine does not understand the data it is about to publish.
 *
 * `warnOnly` rules record a finding without blocking. They exist because a
 * payload can be *unusual* without being *wrong*, and blocking on unusual is
 * how an operator learns to force-publish by reflex.
 */
export const GATE_RULES = Object.freeze([
  { id: 'G-01', statement: 'Candidate validates against the payload schema', overridable: false },
  {
    id: 'G-02',
    statement: 'Candidate non-empty when the prior payload was non-empty',
    overridable: false,
  },
  {
    id: 'G-03',
    statement: 'Count has not dropped by more than max_count_drop_ratio',
    overridable: true,
  },
  {
    id: 'G-04',
    statement: 'Mean rating has not shifted by more than max_rating_shift',
    overridable: true,
  },
  {
    id: 'G-05',
    statement: 'If completeness is partial, count must not have dropped at all',
    // Overridable, per SAD §26.8 and TRD §26.3/§26.8, which agree: force
    // downgrades G-03, G-04, G-05 and G-12; G-01, G-02, G-06 and G-07 are never
    // overridable. This module first declared G-05 non-overridable, which was
    // wrong.
    //
    // It reads like a safety regression and is not. G-05 is the rule CH-04
    // exercises, and on any *scheduled* run it still rejects — force flags are
    // ignored entirely outside manual dispatch (TR-GATE-031), require a written
    // reason (TR-GATE-030), and the runbook requires verifying the real source
    // count first. The escape hatch exists because "the client deleted a
    // duplicate listing during a partial harvest" is a real situation, and the
    // rules that are never overridable are the ones that indicate a defect
    // rather than a disagreement about a threshold.
    overridable: true,
  },
  { id: 'G-06', statement: 'Quarantine rate within quarantine_max', overridable: false },
  { id: 'G-07', statement: 'No record-level fatal findings remain', overridable: false },
  {
    id: 'G-08',
    statement: 'Coverage at least coverage_min, or completeness is full_capped',
    overridable: true,
    warnOnly: true,
  },
  {
    id: 'G-09',
    statement: 'Computed mean within rating_tolerance of advertised',
    overridable: true,
  },
  { id: 'G-10', statement: 'Payload size within budget', overridable: true, warnOnly: true },
  { id: 'G-11', statement: 'No near-duplicate cluster larger than three', overridable: true },
  { id: 'G-12', statement: 'advertised_total has not dropped beyond tolerance', overridable: true },
]);

/**
 * What one adapter produced for one listing.
 *
 * `advertised_total` is recorded separately from `observed_count` and is never
 * substituted for it. The difference between the two *is* the coverage signal,
 * and collapsing them would delete the system's main way of noticing that a
 * harvest silently got less than it should have.
 *
 * @typedef {object} AcquisitionReport
 * @property {number} observed_count          Records actually extracted.
 * @property {number | null} advertised_total Source-reported total. Never substituted.
 * @property {number | null} advertised_rating
 * @property {string} stop_reason             One of {@link STOP_REASONS}.
 * @property {string} completeness            `full` / `full_capped` / `partial` / `failed`.
 * @property {number} pages_traversed
 * @property {number} elapsed_ms
 * @property {boolean} sort_applied           False when the sort control was absent (non-fatal).
 * @property {ReadonlyArray<number>} strategy_indices Which selector strategy matched per field. Feeds pack health.
 * @property {string | null} selector_pack_version
 * @property {string} adapter
 */

/**
 * One thing wrong with one record or with the set.
 *
 * @typedef {object} Finding
 * @property {string} code       An `ERR-*` class from the taxonomy. Never an invented string.
 * @property {string} severity   One of {@link SEVERITIES}.
 * @property {string | null} identity_hash  The record, or null for a set-level finding.
 * @property {string} field      The field at fault, or `*` for the whole record.
 * @property {string} detail     Bounded. **Never raw page content.**
 */

/**
 * What validation concluded (§25).
 *
 * @typedef {object} ValidationReport
 * @property {ReadonlyArray<Finding>} findings
 * @property {number} accepted_count
 * @property {number} quarantined_count
 * @property {number} quarantine_rate    `quarantined / (accepted + quarantined)`.
 * @property {number | null} coverage    `observed / advertised`, or null when unknown.
 * @property {number} near_duplicate_clusters
 * @property {number} largest_duplicate_cluster
 * @property {boolean} has_fatal         Convenience for gate rule G-07.
 */

/**
 * What reconciliation changed (§22).
 *
 * The counts are what an operator reads first during an incident, and the
 * shape is chosen so that "nothing changed" is visibly different from "we
 * observed nothing" — `unchanged: 120` and `unchanged: 0, missing: 120` tell
 * completely different stories about the same review count.
 *
 * @typedef {object} DecisionLog
 * @property {number} inserted
 * @property {number} updated
 * @property {number} unchanged
 * @property {number} missing        Absent this harvest, streak incremented, still published.
 * @property {number} tombstoned     Crossed the confirmation threshold this harvest.
 * @property {number} suppressed
 * @property {number} held           Absent, but the harvest was too incomplete to count it.
 * @property {number} ignored_terminal
 * @property {ReadonlyArray<{ identity_hash: string, outcome: string }>} decisions
 */

/**
 * The Gate's verdict on one candidate payload (§26).
 *
 * **`reasons` holds every failing rule, not the first.** Short-circuiting would
 * name one problem when there are four, so the engineer fixes one and the next
 * run rejects for the next reason — incident time multiplying by the number of
 * concurrent problems. That is why the Gate carries a 100% coverage obligation:
 * an unreached branch here is a rule that silently stopped evaluating.
 *
 * @typedef {object} GateVerdict
 * @property {string} decision                 One of {@link GATE_DECISIONS}.
 * @property {ReadonlyArray<GateRuleResult>} results  Every rule, evaluated. Never a subset.
 * @property {ReadonlyArray<string>} reasons   Ids of every failing rule.
 * @property {ReadonlyArray<string>} warnings  Ids of rules that flagged without blocking.
 * @property {boolean} forced                  An operator overrode overridable rules.
 * @property {string | null} force_reason      Mandatory audit text when forced.
 * @property {boolean} first_publish           The first-publish exception applied.
 */

/**
 * @typedef {object} GateRuleResult
 * @property {string} id
 * @property {boolean} passed
 * @property {string | null} detail   Observed versus threshold, for the alert.
 * @property {boolean} overridden     Passed only because of `--force-publish`.
 */

/**
 * @param {string} id
 * @returns {{ id: string, statement: string, overridable: boolean, warnOnly?: boolean } | undefined}
 */
export function getGateRule(id) {
  return GATE_RULES.find((rule) => rule.id === id);
}

/** Rules `--force-publish` may not downgrade, whatever the operator intends. */
export const NON_OVERRIDABLE_RULES = Object.freeze(
  GATE_RULES.filter((rule) => !rule.overridable).map((rule) => rule.id),
);

/**
 * Whether absence of change should be read as a healthy no-op.
 *
 * @param {DecisionLog} log
 * @returns {boolean}
 */
export function isNoOpHarvest(log) {
  return log.inserted === 0 && log.updated === 0 && log.tombstoned === 0 && log.suppressed === 0;
}
