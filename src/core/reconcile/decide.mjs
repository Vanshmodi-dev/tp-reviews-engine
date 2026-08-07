/**
 * Classification — what one observation, or one absence, means.
 *
 * This module decides; it does not mutate. Every function returns a `Decision`
 * naming an outcome, and `core/model/ledger.mjs`'s constructors are what apply
 * it. Keeping the two apart means the rules can be read without reading the
 * field arithmetic, and the field arithmetic can be tested without reconstructing
 * the rules.
 *
 * ## The two halves are not symmetric, and that is the whole point
 *
 * `decideObserved` never consults completeness. A review that **appeared** is
 * trusted regardless of how the harvest ended, because a record cannot appear
 * spuriously — nothing about a stalled scroll invents a review that is not
 * there (TRD §22.5.1).
 *
 * `decideAbsent` consults completeness first, before anything else. A review
 * that **did not appear** is evidence only if the harvest actually looked. That
 * asymmetry is the system's most consequential rule and the reason this file is
 * two functions rather than one with a flag.
 *
 * @module core/reconcile/decide
 */

import { OUTCOMES, isTerminal } from '../model/ledger.mjs';
import { absenceIsMeaningful } from '../model/review.mjs';

/**
 * @typedef {object} Decision
 * @property {string} identity_hash
 * @property {string} outcome One of {@link OUTCOMES}.
 * @property {string} reason  Human-readable; ends up in the decision log.
 */

/**
 * Everything a decision is allowed to read.
 *
 * There is no `now` here on purpose. Deciding *what happened* needs no clock;
 * only applying the decision does. Passing one would invite a rule that behaves
 * differently depending on when it runs, and every property law assumes none of
 * them do.
 *
 * @typedef {object} DecisionContext
 * @property {string} completeness           `full` | `full_capped` | `partial` | `failed`.
 * @property {number} removalConfirmations   Consecutive qualifying harvests before tombstoning.
 * @property {ReadonlySet<string>} denylist  Suppressed identity hashes, from `main`.
 * @property {boolean} [alreadyCounted]      This ledger has already absorbed a qualifying
 *   harvest at this exact instant. See {@link decideAbsent}.
 */

/**
 * @param {string} identityHash
 * @param {string} outcome
 * @param {string} reason
 * @returns {Decision}
 */
function decision(identityHash, outcome, reason) {
  return Object.freeze({ identity_hash: identityHash, outcome, reason });
}

/**
 * Classifies a review that this harvest observed.
 *
 * The order of the checks is normative (TRD §22.5), and each one is a different
 * kind of "no":
 *
 * 1. **Denylisted** — an erasure obligation. Outranks everything, including the
 *    record not existing yet: a suppressed identity must never enter the ledger
 *    in the first place, or a rebuild of `state` would resurrect it.
 * 2. **Terminal** — tombstoned or suppressed. The review may genuinely be back
 *    on the page; it still does not come back here (TR-REC-014).
 * 3. **Absent from the ledger** — INSERT.
 * 4. **Content identical** — UNCHANGED. Distinguished from UPDATE so that
 *    `revision` and `last_updated_at` do not advance on every harvest, which
 *    would make every payload look edited and defeat hash-gating.
 * 5. **Otherwise** — UPDATE.
 *
 * @param {any} observed  A `NormalizedReview` from this harvest.
 * @param {any} prior     The matching `LedgerReview`, or undefined.
 * @param {DecisionContext} context
 * @returns {Decision}
 */
export function decideObserved(observed, prior, context) {
  const id = observed.identity_hash;

  if (context.denylist.has(id)) {
    return decision(id, OUTCOMES.SUPPRESSED, 'identity is denylisted; never enters the ledger');
  }

  if (isTerminal(prior)) {
    return decision(id, OUTCOMES.IGNORED_TERMINAL, `prior state ${prior.state} is terminal`);
  }

  if (prior === undefined) {
    return decision(id, OUTCOMES.INSERTED, 'not previously in the ledger');
  }

  if (prior.review.content_hash === observed.content_hash) {
    return decision(id, OUTCOMES.UNCHANGED, 'content hash identical to the stored revision');
  }

  return decision(id, OUTCOMES.UPDATED, 'content hash differs from the stored revision');
}

/**
 * Classifies a prior record that this harvest did **not** observe.
 *
 * ## Read the order of these checks before changing them
 *
 * The completeness gate comes before the streak arithmetic, and that ordering
 * is the protection. Inverting it — computing the streak and then deciding
 * whether to keep it — produces code that passes every example test, because
 * example tests are written for the `full` case, while silently counting
 * absences on harvests that never looked.
 *
 * A `partial` harvest returns HELD, which means precisely: nothing changes. Not
 * the streak, not the state, not `last_seen_at`. The record stays published.
 *
 * @param {any} prior The `LedgerReview` that was not observed.
 * @param {DecisionContext} context
 * @returns {Decision}
 */
export function decideAbsent(prior, context) {
  const id = prior.review.identity_hash;

  if (isTerminal(prior)) {
    return decision(id, OUTCOMES.IGNORED_TERMINAL, `prior state ${prior.state} is terminal`);
  }

  // THE ASYMMETRY (INV-03, TR-REC-011). This is not a guard clause to tidy
  // away, and it is not redundant with anything below it. A harvest that
  // stopped early did not look; absence from it is evidence of nothing.
  if (!absenceIsMeaningful(context.completeness)) {
    return decision(id, OUTCOMES.HELD, `harvest completeness ${context.completeness} did not look`);
  }

  // THE IDEMPOTENCE GUARD (PT-01, INV-04). `missing_streak` is the only field
  // in the system defined by accumulation rather than by the observation, so it
  // is the only one that changes when the same harvest is applied twice. A
  // shard that crashes after reconciling but before committing re-runs, and
  // without this guard each replay advances every absent record's streak —
  // tombstoning reviews at the default of three confirmations because a job was
  // retried, not because anything was removed at the source.
  if (context.alreadyCounted === true) {
    return decision(id, OUTCOMES.HELD, 'this harvest instant has already been counted');
  }

  const streak = prior.missing_streak + 1;

  if (streak >= context.removalConfirmations) {
    return decision(
      id,
      OUTCOMES.TOMBSTONED,
      `absent from ${streak} consecutive qualifying harvests`,
    );
  }

  return decision(
    id,
    OUTCOMES.MISSING,
    `absent from ${streak} of ${context.removalConfirmations} required harvests`,
  );
}

/**
 * Whether an outcome leaves the ledger byte-identical.
 *
 * Used by the merge to skip work, and by the decision log to distinguish "we
 * considered this and did nothing" from "we never looked at it".
 *
 * @param {string} outcome
 * @returns {boolean}
 */
export function isNoOpOutcome(outcome) {
  return outcome === OUTCOMES.HELD || outcome === OUTCOMES.IGNORED_TERMINAL;
}
