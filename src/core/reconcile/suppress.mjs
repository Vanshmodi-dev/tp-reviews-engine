/**
 * Denylist application — permanent, and one-way.
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

/**
 * Applies the denylist to one identity.
 *
 * Denylisted means suppressed, **unconditionally**. Not "unless tombstoned",
 * not "unless absent from this harvest", not "unless it was already removed".
 * An erasure obligation is not a lifecycle event and does not queue behind one.
 *
 * The denylist arrives as a Set built from `compliance/denylist.json` on `main`.
 * This function does not read a file, fetch anything, or know where the set came
 * from (DR-1, DR-2).
 *
 * @param {string} identityHash
 * @param {string} priorState
 * @param {ReadonlySet<string>} denylist
 * @returns {SuppressionOutcome}
 */
export function applySuppression(identityHash, priorState, denylist) {
  if (denylist.has(identityHash)) {
    return Object.freeze({ suppressed: true, nextState: 'suppressed' });
  }

  return Object.freeze({ suppressed: false, nextState: priorState });
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

/**
 * Builds the denylist Set from the parsed `compliance/denylist.json` entries.
 *
 * Takes already-parsed data rather than a path: `core/` reads no files (DR-1).
 * Malformed entries are skipped rather than throwing, because a denylist that
 * fails to load is a denylist that suppresses nothing, and failing open on an
 * erasure obligation is the worst available outcome. The caller reports what was
 * skipped; the set still carries every entry that was usable.
 *
 * @param {unknown} entries
 * @returns {{ denylist: Set<string>, skipped: number }}
 */
export function buildDenylist(entries) {
  const denylist = new Set();
  let skipped = 0;

  if (!Array.isArray(entries)) return { denylist, skipped };

  for (const entry of entries) {
    const hash = typeof entry === 'string' ? entry : entry?.identity_hash;

    if (typeof hash === 'string' && hash !== '') denylist.add(hash);
    else skipped += 1;
  }

  return { denylist, skipped };
}
