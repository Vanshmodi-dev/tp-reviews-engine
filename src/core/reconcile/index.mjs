/**
 * The merge function — reconcile a prior ledger with one harvest.
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

import {
  OUTCOMES,
  applyBatch,
  checkLedgerInvariants,
  nextInsert,
  nextMissing,
  nextSuppress,
  nextTouch,
  nextUpdate,
  recordHarvest,
} from '../model/ledger.mjs';
import { absenceIsMeaningful } from '../model/review.mjs';
import { classifyCompleteness } from '../validate/completeness.mjs';
import { decideAbsent, decideObserved } from './decide.mjs';
import { collapseIntraRun, findNearDuplicates } from './duplicates.mjs';
import { applySuppression } from './suppress.mjs';

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
 * @property {ReadonlyArray<import('./duplicates.mjs').NearDuplicatePair>} nearDuplicates
 *   Reported, never merged. Feeds a `warn` finding and gate rule G-11.
 * @property {number} collisions
 *   Records discarded by intra-run collapse (TR-REC-004).
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
 * The threshold used when configuration does not supply one (TRD §22.6).
 *
 * A near-duplicate is a `warn` finding and an input to gate rule G-11; it never
 * removes anything, which is why a default is safe here at all.
 */
const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.92;

/**
 * A running count of what the merge decided.
 *
 * Built as a closure rather than a plain object passed around and mutated: the
 * counts are private to the tally, so no caller can adjust the record of what
 * happened, and `freeze()` is the only way out.
 *
 * @returns {{ count: (decision: { identity_hash: string, outcome: string }) => void, freeze: () => any }}
 */
function createTally() {
  const counts = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    tombstoned: 0,
    suppressed: 0,
    held: 0,
    ignored_terminal: 0,
  };
  /** @type {{ identity_hash: string, outcome: string }[]} */
  const entries = [];

  return {
    count(decision) {
      const field = TALLY_FIELD.get(decision.outcome);
      if (field !== undefined) counts[field] += 1;

      entries.push({ identity_hash: decision.identity_hash, outcome: decision.outcome });
    },
    freeze() {
      return Object.freeze({ ...counts, decisions: Object.freeze([...entries]) });
    },
  };
}

/**
 * Outcome constant to the tally field that counts it.
 *
 * A Map rather than an object so the value type stays a union of the tally's
 * own keys: a typo in a field name here is a type error rather than a counter
 * that silently stays at zero.
 *
 * `ABSENT` maps to `ignored_terminal` because both mean "there was nothing here
 * to act on". It is unreachable from the two decision functions — an absent
 * record is looked up from the ledger it lives in — and is present so the table
 * is total over `OUTCOMES`.
 *
 * @type {ReadonlyMap<string, 'inserted' | 'updated' | 'unchanged' | 'missing' | 'tombstoned' | 'suppressed' | 'held' | 'ignored_terminal'>}
 */
const TALLY_FIELD = new Map([
  [OUTCOMES.INSERTED, /** @type {const} */ ('inserted')],
  [OUTCOMES.UPDATED, /** @type {const} */ ('updated')],
  [OUTCOMES.UNCHANGED, /** @type {const} */ ('unchanged')],
  [OUTCOMES.MISSING, /** @type {const} */ ('missing')],
  [OUTCOMES.TOMBSTONED, /** @type {const} */ ('tombstoned')],
  [OUTCOMES.SUPPRESSED, /** @type {const} */ ('suppressed')],
  [OUTCOMES.HELD, /** @type {const} */ ('held')],
  [OUTCOMES.IGNORED_TERMINAL, /** @type {const} */ ('ignored_terminal')],
  [OUTCOMES.ABSENT, /** @type {const} */ ('ignored_terminal')],
]);

/**
 * The change one observed review implies.
 *
 * Each outcome routes to the one `next*` function that owns its field
 * arithmetic. The merge never writes a record field directly — doing so would
 * put the mutation rules of TRD §22.5.2 in two places, and `first_seen_at`
 * preservation (PT-05) and date pinning (PT-06) are enforced inside those
 * functions precisely because the incoming review carries plausible-looking
 * values for both and using them would be the natural mistake.
 *
 * @param {import('../model/ledger.mjs').Ledger} prior
 * @param {any} review
 * @param {{ outcome: string }} decision
 * @param {string} now
 * @returns {import('../model/ledger.mjs').RecordChange}
 */
function observedChange(prior, review, decision, now) {
  const existing = prior.records.get(review.identity_hash);

  switch (decision.outcome) {
    case OUTCOMES.INSERTED:
      return nextInsert(existing, review, now);
    case OUTCOMES.UPDATED:
      return nextUpdate(existing, review, now);
    case OUTCOMES.UNCHANGED:
      return nextTouch(existing, now);
    default:
      // SUPPRESSED and IGNORED_TERMINAL both mean "this observation does not
      // enter the ledger". Changing nothing is the whole action.
      return { record: null, outcome: decision.outcome };
  }
}

/**
 * The change one absent record implies.
 *
 * `nextMissing` is consulted only for the two outcomes that change something,
 * and it re-derives the same streak arithmetic from the same inputs, so the
 * decision and the mutation cannot disagree.
 * `tests/unit/reconcile/agreement.test.mjs` asserts that across the whole input
 * space rather than trusting the reading.
 *
 * @param {any} record
 * @param {{ outcome: string }} decision
 * @param {{ completeness: string, removalConfirmations: number }} context
 * @param {string} now
 * @returns {import('../model/ledger.mjs').RecordChange}
 */
function absentChange(record, decision, context, now) {
  if (decision.outcome !== OUTCOMES.MISSING && decision.outcome !== OUTCOMES.TOMBSTONED) {
    return { record: null, outcome: decision.outcome };
  }

  return nextMissing(record, {
    completeness: context.completeness,
    removalConfirmations: context.removalConfirmations,
    now,
  });
}

/**
 * Reconciles one harvest into a ledger.
 *
 * The composition, in the order the rules require:
 *
 * 1. **Collapse intra-run duplicates** by a total ordering (T-105, DUP-03).
 *    Chosen by comparing the records, never by which the loop reached last.
 * 2. **Observed pass.** Appearance is trusted regardless of completeness — a
 *    record cannot appear spuriously.
 * 3. **Absent pass**, gated on completeness *before* any streak arithmetic runs.
 * 4. **Suppression sweep**, last, because an erasure obligation outranks every
 *    other outcome including a tombstone.
 * 5. `recordHarvest`, then `checkLedgerInvariants` on the result.
 *
 * Every step returns new objects and `prior` is byte-identical afterwards, which
 * is what makes a crashed shard safe to re-run (LEDG-04, PT-01).
 *
 * @param {ReconcileInput} input
 * @returns {ReconcileOutput}
 */
export function reconcile(input) {
  const { prior, observed, report, config, now } = input;
  const completeness = classifyCompleteness(report);

  const context = {
    completeness,
    removalConfirmations: config.removalConfirmations,
    denylist: config.denylist,
    // The same harvest instant is never counted twice against a streak. See
    // `decideAbsent`; this is the mechanism PT-01 requires and it needs no
    // field that the Ledger does not already carry.
    alreadyCounted: absenceIsMeaningful(completeness) && prior.last_full_harvest_at === now,
  };

  const { records: collapsed, collisions } = collapseIntraRun(observed);
  const tally = createTally();

  // Both passes read `prior` and write to a change list; the ledger is rebuilt
  // once, at the end. Threading a new ledger through each iteration instead
  // would copy the record Map once per review, which is O(n^2) allocation and
  // the defect IR-24 warns about, reintroduced one level up. Neither pass
  // depends on the other's writes: duplicates are already collapsed, so each
  // identity is decided exactly once, and the absent pass skips everything the
  // observed pass touched.
  /** @type {[string, import('../model/ledger.mjs').RecordChange][]} */
  const changes = [];
  const seen = new Set();

  for (const review of collapsed) {
    seen.add(review.identity_hash);
    const decision = decideObserved(review, prior.records.get(review.identity_hash), context);

    changes.push([review.identity_hash, observedChange(prior, review, decision, now)]);
    tally.count(decision);
  }

  for (const [identityHash, record] of prior.records) {
    if (seen.has(identityHash)) continue;
    const decision = decideAbsent(record, context);

    changes.push([identityHash, absentChange(record, decision, context, now)]);
    tally.count(decision);
  }

  let ledger = applyBatch(prior, changes, now);

  ledger = sweepSuppressions(ledger, config.denylist, tally, now);
  ledger = recordHarvest(ledger, completeness, now);

  return Object.freeze({
    ledger,
    decisions: tally.freeze(),
    invariantViolations: Object.freeze(checkLedgerInvariants(ledger)),
    nearDuplicates: Object.freeze(
      findNearDuplicates(
        collapsed,
        config.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD,
      ),
    ),
    collisions,
  });
}

/**
 * Applies the denylist across the whole ledger, last.
 *
 * Sweeping the result rather than checking during the passes above is
 * deliberate. A denylisted identity can reach the ledger by routes the observed
 * pass never sees — it may have been inserted by an earlier engine version,
 * restored from a rebuilt `state` branch, or added to the denylist between
 * harvests while the review itself stopped appearing. Suppression that only
 * fired on observation would miss every one of those.
 *
 * Already-suppressed records are skipped so the decision log does not report a
 * suppression on every subsequent harvest forever.
 *
 * @param {import('../model/ledger.mjs').Ledger} ledger
 * @param {ReadonlySet<string>} denylist
 * @param {ReturnType<typeof createTally>} tally
 * @param {string} now
 * @returns {import('../model/ledger.mjs').Ledger}
 */
function sweepSuppressions(ledger, denylist, tally, now) {
  if (denylist.size === 0) return ledger;

  /** @type {[string, import('../model/ledger.mjs').RecordChange][]} */
  const changes = [];

  for (const [identityHash, record] of ledger.records) {
    if (record.state === 'suppressed') continue;

    const outcome = applySuppression(identityHash, record.state, denylist);
    if (!outcome.suppressed) continue;

    changes.push([identityHash, nextSuppress(record)]);
    tally.count({ identity_hash: identityHash, outcome: OUTCOMES.SUPPRESSED });
  }

  return applyBatch(ledger, changes, now);
}

export { EMPTY_DECISIONS };
