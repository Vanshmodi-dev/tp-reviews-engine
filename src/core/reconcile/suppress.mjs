/**
 * Denylist application — permanent, and one-way.
 *
 * ============================================================================
 * SCAFFOLD ONLY — T-107 IMPLEMENTS THE SUPPRESSION LOGIC.
 * ============================================================================
 *
 * ## There is no un-suppress, and there must never be one
 *
 * Suppression exists to satisfy erasure obligations. A path that reverses it is
 * a path that resurrects a review a data subject asked to have removed, and no
 * operational convenience justifies one. PT-04's verification is literally that
 * a reviewer looks for an un-suppress path and finds none.
 *
 * This module therefore exports no `unsuppress`, no `restore`, no `clear`, and
 * takes no boolean that would re-enable a suppressed id. That absence is
 * asserted by test, so it survives future edits rather than only today's review.
 *
 * ## Why the denylist lives on `main`
 *
 * `compliance/denylist.json` is source-controlled on `main`, not stored in the
 * Ledger on `state` (TR-CFG-011). Rebuilding `state` from scratch is a
 * documented, expected recovery procedure — and if suppressions lived only
 * inside ledgers, that recovery would resurrect every erased review, turning a
 * recoverable incident into a compliance breach.
 *
 * Suppression also outranks the lifecycle: it applies to an already-tombstoned
 * record, because an erasure obligation is not a lifecycle event.
 *
 * @module core/reconcile/suppress
 */

/**
 * @typedef {object} SuppressionOutcome
 * @property {boolean} suppressed  Whether this identity is denylisted.
 * @property {string} nextState    `suppressed` when denylisted, otherwise the prior state.
 */

/** Returned until T-107 lands. */
export const NOT_IMPLEMENTED_OUTCOME = Object.freeze({ suppressed: false, nextState: 'active' });

/**
 * Applies the denylist to one identity.
 *
 * @stub DECISION LOGIC PLACEHOLDER — T-107.
 *   Must implement:
 *     - `denylist.has(identityHash)` -> `{ suppressed: true, nextState: 'suppressed' }`,
 *       UNCONDITIONALLY. Not "unless tombstoned", not "unless absent". An
 *       erasure obligation outranks every other state.
 *     - otherwise -> `{ suppressed: false, nextState: priorState }`.
 *
 *   The denylist arrives as a Set built from `compliance/denylist.json` on
 *   `main`. This function must not read a file, fetch anything, or know where
 *   the set came from (DR-1, DR-2).
 *
 * @param {string} identityHash
 * @param {string} priorState
 * @param {ReadonlySet<string>} denylist
 * @returns {SuppressionOutcome}
 */
export function applySuppression(identityHash, priorState, denylist) {
  void identityHash;
  void priorState;
  void denylist;

  return NOT_IMPLEMENTED_OUTCOME;
}

/**
 * Filters an identity set down to those that are denylisted.
 *
 * Implemented rather than stubbed: it is set intersection, carries no policy,
 * and the property laws need a concrete way to describe a suppressed cohort.
 *
 * @param {Iterable<string>} identityHashes
 * @param {ReadonlySet<string>} denylist
 * @returns {string[]}
 */
export function suppressedAmong(identityHashes, denylist) {
  return [...identityHashes].filter((hash) => denylist.has(hash));
}

/** @returns {boolean} */
export function isScaffold() {
  return true;
}
