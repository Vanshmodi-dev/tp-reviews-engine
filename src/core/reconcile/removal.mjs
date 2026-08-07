/**
 * Confidence-gated removal and tombstoning.
 *
 * ============================================================================
 * SCAFFOLD ONLY — T-106 IMPLEMENTS THE REMOVAL LOGIC.
 * ============================================================================
 *
 * ## The one thing this module must never do
 *
 * **Delete anything from the ledger.** Removal here means "stop publishing and
 * write a tombstone", never "drop the record". A tombstone is the only evidence
 * that a review once existed, and PT-03's monotonicity law depends on it
 * surviving forever: a tombstoned identity must never become active again under
 * *any* observation sequence, including one where the review genuinely
 * reappears at the source.
 *
 * "Deleted review comes back" is embarrassing when it is a mistake and legally
 * significant when the removal was an erasure request.
 *
 * ## Confidence gating
 *
 * A record is tombstoned only after `removal_confirmations` (default 3)
 * **consecutive qualifying harvests** have failed to observe it. A qualifying
 * harvest is one whose completeness is `full` or `full_capped` — a partial
 * harvest contributes nothing to the count, because it did not look.
 *
 * Three confirmations at a six-hour cadence is roughly eighteen hours of
 * consistent absence before anything stops being published. That latency is the
 * feature.
 *
 * @module core/reconcile/removal
 */

/**
 * @typedef {object} RemovalPolicy
 * @property {number} removalConfirmations Consecutive qualifying harvests required. Range 2-10.
 * @property {boolean} keepTombstones      MUST be true in production (TRD §8.4.4).
 */

/**
 * @typedef {object} RemovalOutcome
 * @property {boolean} tombstone   Whether this harvest crosses the threshold.
 * @property {number} nextStreak   The streak value to store.
 * @property {string} nextState    `active` | `unconfirmed` | `tombstoned`.
 * @property {string | null} tombstonedAt RFC 3339 when tombstoning, else null.
 */

/** Returned until T-106 lands. Deliberately the "change nothing" outcome. */
export const NOT_IMPLEMENTED_OUTCOME = Object.freeze({
  tombstone: false,
  nextStreak: 0,
  nextState: 'active',
  tombstonedAt: null,
});

/**
 * Decides whether an absent record crosses the removal threshold.
 *
 * @stub DECISION LOGIC PLACEHOLDER — T-106.
 *   Must implement TRD §22.5 removal gating:
 *     - A record whose state is already `tombstoned` or `suppressed` is
 *       returned unchanged. Terminal is terminal (PT-03).
 *     - `nextStreak = priorStreak + 1`, and ONLY when the harvest qualifies.
 *       The caller must not invoke this at all for a partial harvest; this
 *       function asserting completeness again would put the asymmetry in two
 *       places, and two copies of one rule is how they diverge.
 *     - `nextStreak >= policy.removalConfirmations` -> tombstone, state
 *       `tombstoned`, `tombstonedAt = now`.
 *     - otherwise -> state `unconfirmed`, still published, marked unconfirmed.
 *
 *   AN UNCONFIRMED RECORD IS STILL PUBLISHED, DELIBERATELY. Pulling it at the
 *   first absence would make every transient failure visible to visitors.
 *
 * @param {any} prior The `LedgerReview` that was not observed.
 * @param {RemovalPolicy} policy
 * @param {string} now RFC 3339. Explicit; `core/` reads no clock (DR-2).
 * @returns {RemovalOutcome}
 */
export function evaluateRemoval(prior, policy, now) {
  void prior;
  void policy;
  void now;

  return NOT_IMPLEMENTED_OUTCOME;
}

/**
 * Whether a state can never become active again.
 *
 * Implemented rather than stubbed: it is a definition, not a decision, and the
 * monotonicity law needs something concrete to assert against.
 *
 * @param {string | undefined} state
 * @returns {boolean}
 */
export function isTerminalState(state) {
  return state === 'tombstoned' || state === 'suppressed';
}

/** @returns {boolean} */
export function isScaffold() {
  return true;
}
