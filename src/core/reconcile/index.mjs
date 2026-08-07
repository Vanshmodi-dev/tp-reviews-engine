/**
 * The merge function — reconcile a prior ledger with one harvest.
 *
 * ============================================================================
 * SCAFFOLD ONLY — T-109 IMPLEMENTS THE MERGE. THIS RETURNS THE PRIOR LEDGER
 * UNCHANGED AND DECIDES NOTHING.
 * ============================================================================
 *
 * ## Read this before changing anything below (T-111, LEDG-05)
 *
 * The absence asymmetry in this module looks like redundant branching. **It is
 * not.** Two absences that appear identical in the data are treated completely
 * differently, and the difference is which harvest they came from:
 *
 * - A review missing from a `full` harvest was looked for and not found. That
 *   is evidence, and it increments a streak toward removal.
 * - A review missing from a `partial` harvest was **not looked for**. That is
 *   not evidence of anything, and it must change nothing at all — not the
 *   streak, not the state, not `last_seen_at`.
 *
 * An implementer who unifies these two paths, because they "do the same thing
 * with an extra check", has introduced the worst defect this system can carry:
 * one stalled page load starts a countdown that silently deletes a paying
 * client's entire review set, three harvests later, with no error anywhere.
 *
 * The protections are PT-07 (property law) and CH-04 (chaos scenario). TRD
 * §22.5 calls CH-04 the single most important test in the suite: *"If only one
 * test could be run before a release, it would be that one."*
 *
 * ## The three laws this function must satisfy
 *
 * | Law | Statement | Why it matters |
 * |---|---|---|
 * | PT-01 idempotence | `reconcile(reconcile(L,H),H) ≡ reconcile(L,H)` for fixed `now` | A shard that crashes after reconciling but before committing can simply re-run |
 * | PT-02 commutativity | Shuffling `observed` yields an identical ledger | Upstream ordering is unstable and personalised; order-dependence produces nondeterministic output |
 * | PT-03 monotonicity | A tombstoned or suppressed id never becomes active | Prevents "deleted review comes back" |
 *
 * Plus PT-05 (`first_seen_at` never changes) and PT-06 (pinned dates never
 * recompute), both already enforced by `core/model/ledger.mjs`'s constructors.
 *
 * ## Purity
 *
 * `now` is a **required parameter with no default** (LEDG-04, TR-REC-030).
 * Reading the clock inside this function makes every property law above
 * untestable, because the same inputs would stop producing the same output. A
 * `Date.now()` default parameter here would void five laws without failing a
 * single existing test.
 *
 * @module core/reconcile
 */

import { checkLedgerInvariants } from '../model/ledger.mjs';

/**
 * Everything the merge is allowed to read.
 *
 * @typedef {object} ReconcileConfig
 * @property {number} removalConfirmations   Consecutive qualifying harvests before tombstoning.
 * @property {number} nearDuplicateThreshold Similarity at or above which two records cluster.
 * @property {boolean} keepTombstones        MUST be true in production.
 * @property {ReadonlySet<string>} denylist  Suppressed identity hashes, from `main`.
 */

/**
 * @typedef {object} ReconcileInput
 * @property {import('../model/ledger.mjs').Ledger} prior
 * @property {ReadonlyArray<any>} observed  `NormalizedReview` records from this harvest.
 * @property {import('../model/report.mjs').AcquisitionReport} report
 * @property {ReconcileConfig} config
 * @property {string} now RFC 3339. Explicit. No default, ever.
 */

/**
 * @typedef {object} ReconcileOutput
 * @property {import('../model/ledger.mjs').Ledger} ledger
 * @property {import('../model/report.mjs').DecisionLog} decisions
 * @property {ReadonlyArray<string>} invariantViolations
 *   Empty when the resulting ledger is sound. A non-empty list is
 *   `ERR-INTERNAL-INVARIANT`: the engine produced a state its own rules forbid.
 */

/** The all-zero decision log a no-op produces. */
const EMPTY_DECISIONS = Object.freeze({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  missing: 0,
  tombstoned: 0,
  suppressed: 0,
  held: 0,
  ignored_terminal: 0,
  decisions: Object.freeze([]),
});

/**
 * Reconciles one harvest into a ledger.
 *
 * @stub DECISION LOGIC PLACEHOLDER — T-109 composes the merge.
 *   The composition, once the parts exist:
 *     1. Collapse intra-run duplicates deterministically (T-105). The surviving
 *        record is chosen by a TOTAL ordering, or PT-02 breaks.
 *     2. For each observed record: `decideObserved`, then apply the matching
 *        `core/model/ledger.mjs` constructor. Never mutate `prior`.
 *     3. For each prior record not observed: `decideAbsent`, gated on
 *        completeness BEFORE `evaluateRemoval` is called at all.
 *     4. Apply `applySuppression` across the result. Suppression is last
 *        because it outranks every other outcome.
 *     5. `recordHarvest`, then `checkLedgerInvariants` on the result.
 *
 *   Every step returns new objects. `prior` must be byte-identical afterwards,
 *   which is what makes a crashed shard safe to re-run (PT-01).
 *
 * @param {ReconcileInput} input
 * @returns {ReconcileOutput}
 */
export function reconcile(input) {
  // The scaffold's behaviour is the safest possible no-op: it returns the prior
  // ledger untouched. It publishes nothing new and, crucially, removes nothing.
  // If this were ever shipped by accident, a client's payload would go stale -
  // visible, recoverable, and vastly preferable to a merge that half-worked.
  return Object.freeze({
    ledger: input.prior,
    decisions: EMPTY_DECISIONS,
    invariantViolations: Object.freeze(checkLedgerInvariants(input.prior)),
  });
}

/**
 * Whether the merge is still a scaffold.
 *
 * The property laws call this to report honestly which of them currently pass
 * vacuously. When T-109 lands this returns false and the laws become real
 * assertions rather than self-declared placeholders.
 *
 * @returns {boolean}
 */
export function isScaffold() {
  return true;
}

export { EMPTY_DECISIONS };
