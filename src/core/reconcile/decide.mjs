/**
 * Per-record classification: INSERT / UPDATE / UNCHANGED / MISSING.
 *
 * ============================================================================
 * SCAFFOLD ONLY — T-100 IMPLEMENTS THE DECISION LOGIC.
 * ============================================================================
 *
 * This file locks the shape: the inputs each decision may read, the exact
 * outcome vocabulary, and the error contract. The classification itself is
 * marked `@stub` and returns a sentinel.
 *
 * PH-05 is D5 — "no agent-led implementation" (plan §PH-05). The scaffolding is
 * deliberately complete so that when the logic lands, nothing about the
 * surrounding shape is still in question.
 *
 * ## The decision table this file will implement (TRD §22.5.1)
 *
 * For each OBSERVED record:
 *
 * ```
 * identity in ledger?
 *   no  -> in denylist?          yes -> SUPPRESSED (never enters the ledger)
 *          tombstoned before?    yes -> IGNORED    (tombstones never resurrect)
 *          otherwise             -> INSERT
 *   yes -> content_hash changed? no  -> UNCHANGED
 *                                yes -> UPDATE
 * ```
 *
 * For each PRIOR record NOT in the observed set:
 *
 * ```
 * completeness partial|failed -> HELD    (no streak change; remains published)
 * completeness full|full_capped -> streak + 1
 *                                 streak >= removal_confirmations ? TOMBSTONE
 *                                                                 : MISSING
 * ```
 *
 * @module core/core/reconcile/decide
 */

/**
 * What a classification may look at.
 *
 * Deliberately narrow. A decision that can see the clock, the config's mutable
 * parts, or the whole run is a decision that can be influenced by something
 * other than the record in front of it — and every property law here depends
 * on that not being possible.
 *
 * @typedef {object} DecisionContext
 * @property {string} completeness       From the navigator's stop reason. NEVER from counts.
 * @property {number} removalConfirmations Consecutive qualifying harvests before tombstoning.
 * @property {ReadonlySet<string>} denylist Suppressed identity hashes, from `main`.
 * @property {string} now                RFC 3339. Explicit; `core/` reads no clock (DR-2, LEDG-04).
 */

/**
 * One classification result.
 *
 * `outcome` is always one of the `OUTCOMES` values exported by
 * `core/model/ledger.mjs`. `reason` is a short, bounded
 * string for the decision log — it explains *why* to an operator reading an
 * incident, and never carries record content.
 *
 * @typedef {object} Decision
 * @property {string} identity_hash
 * @property {string} outcome
 * @property {string} reason
 */

/** Returned by every stubbed classifier until T-100 lands. */
export const NOT_IMPLEMENTED = Object.freeze({
  outcome: 'NOT_IMPLEMENTED',
  reason: 'reconcile/decide.mjs is a scaffold; T-100 implements classification',
});

/**
 * Classifies one OBSERVED record against the prior ledger.
 *
 * @stub DECISION LOGIC PLACEHOLDER — T-100.
 *   Must implement the observed-record half of TRD §22.5.1, in this order:
 *     1. denylist hit                      -> OUTCOMES.SUPPRESSED
 *     2. prior record is terminal          -> OUTCOMES.IGNORED_TERMINAL
 *     3. no prior record                   -> OUTCOMES.INSERTED
 *     4. prior content_hash === observed   -> OUTCOMES.UNCHANGED
 *     5. otherwise                         -> OUTCOMES.UPDATED
 *   Order matters: suppression outranks everything, and a tombstone outranks a
 *   fresh observation. Reversing 1 and 2 would let a tombstoned-then-denylisted
 *   id report as merely ignored, losing the erasure record.
 *
 * @param {any} observed A `NormalizedReview`.
 * @param {any} prior The matching `LedgerReview`, or `undefined`.
 * @param {DecisionContext} context
 * @returns {Decision}
 */
export function decideObserved(observed, prior, context) {
  void observed;
  void prior;
  void context;

  return Object.freeze({
    identity_hash: '',
    outcome: NOT_IMPLEMENTED.outcome,
    reason: NOT_IMPLEMENTED.reason,
  });
}

/**
 * Classifies one PRIOR record that did NOT appear in this harvest.
 *
 * @stub DECISION LOGIC PLACEHOLDER — T-100 and T-101.
 *   Must implement the absent-record half of TRD §22.5.1:
 *     1. prior record is terminal                    -> OUTCOMES.IGNORED_TERMINAL
 *     2. completeness NOT full|full_capped           -> OUTCOMES.HELD
 *        **Nothing changes. Not the streak, not the state, not last_seen_at.**
 *     3. streak + 1 >= removalConfirmations          -> OUTCOMES.TOMBSTONED
 *     4. otherwise                                   -> OUTCOMES.MISSING
 *
 *   STEP 2 IS THE ABSENCE ASYMMETRY AND IT IS NOT REDUNDANT BRANCHING.
 *   An implementer who "simplifies" it by treating absence uniformly has
 *   introduced the system's worst defect: a single partial page load begins a
 *   countdown to deleting a client's entire review set. The protections are
 *   PT-07 and CH-04, and CH-04 is described as the single most important test
 *   in the suite. Read TRD §22.5's Agent Note before touching this.
 *
 * @param {any} prior The `LedgerReview` that was not observed.
 * @param {DecisionContext} context
 * @returns {Decision}
 */
export function decideAbsent(prior, context) {
  void prior;
  void context;

  return Object.freeze({
    identity_hash: '',
    outcome: NOT_IMPLEMENTED.outcome,
    reason: NOT_IMPLEMENTED.reason,
  });
}

/**
 * Whether this scaffold has been replaced by the real implementation.
 *
 * Used by the property laws to state honestly which of them are currently
 * vacuous. When T-100 lands this returns false and the laws stop being
 * self-reported as unproven.
 *
 * @returns {boolean}
 */
export function isScaffold() {
  return true;
}
