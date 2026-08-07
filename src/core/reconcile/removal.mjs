/**
 * Confidence-gated removal and tombstoning.
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
 * The permitted range for `removal_confirmations` (TRD §8.4.4).
 *
 * Below two, a single unlucky harvest removes a review — the confirmation window
 * would exist in name only. Above ten, at a six-hour cadence, a genuinely deleted
 * review stays published for two and a half days, which is long enough for the
 * removal to be somebody's complaint rather than the engine's decision.
 */
const MIN_CONFIRMATIONS = 2;
const MAX_CONFIRMATIONS = 10;

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

/**
 * The outcome for a record that is not to be touched.
 *
 * @param {any} prior
 * @returns {RemovalOutcome}
 */
function unchangedOutcome(prior) {
  return Object.freeze({
    tombstone: false,
    nextStreak: prior.missing_streak,
    nextState: prior.state,
    tombstonedAt: prior.tombstoned_at ?? null,
  });
}

/**
 * Decides whether an absent record crosses the removal threshold.
 *
 * ## What this function deliberately does NOT check
 *
 * It does not look at completeness. The caller must not invoke it at all for a
 * `partial` or `failed` harvest — `decideAbsent` returns HELD first, and the
 * merge never reaches this function. Asserting completeness here as well would
 * put the asymmetry in two places, and two copies of one rule is how they
 * diverge: someone fixes a bug in one and the other keeps the old behaviour for
 * a year.
 *
 * ## An unconfirmed record is still published, deliberately
 *
 * Below the threshold the state becomes `unconfirmed`, not hidden. Pulling a
 * review at its first absence would make every transient failure visible to
 * visitors — a stalled scroll would blank a section of a client's website and
 * restore it six hours later. The confirmation window is what converts a flaky
 * observation into a decision, and at the default of three confirmations on a
 * six-hour cadence that is roughly eighteen hours of consistent absence before
 * anything stops being published. That latency is the feature.
 *
 * @param {any} prior The `LedgerReview` that was not observed.
 * @param {RemovalPolicy} policy
 * @param {string} now RFC 3339. Explicit; `core/` reads no clock (DR-2).
 * @returns {RemovalOutcome}
 */
export function evaluateRemoval(prior, policy, now) {
  // Terminal is terminal. A tombstoned record is not re-tombstoned, and its
  // streak stops moving — otherwise `missing_streak` would climb forever and
  // `tombstoned_at` would drift away from the harvest that actually decided it.
  if (isTerminalState(prior.state)) return unchangedOutcome(prior);

  const nextStreak = prior.missing_streak + 1;

  if (nextStreak >= policy.removalConfirmations) {
    return Object.freeze({
      tombstone: true,
      nextStreak,
      nextState: 'tombstoned',
      tombstonedAt: now,
    });
  }

  return Object.freeze({
    tombstone: false,
    nextStreak,
    nextState: 'unconfirmed',
    tombstonedAt: null,
  });
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

/**
 * Whether a removal policy is usable.
 *
 * `keepTombstones: false` is rejected rather than honoured. It would mean
 * deleting records from the ledger, which destroys the only evidence a review
 * ever existed and makes PT-03 unenforceable — a deleted identity is not
 * terminal, it is absent, and absent identities get re-inserted on the next
 * harvest. The flag exists in the config schema so that a deployment cannot set
 * it silently; the engine refuses rather than adapts (TRD §8.4.4).
 *
 * @param {RemovalPolicy} policy
 * @returns {string[]} Violations, empty when the policy is usable.
 */
export function checkRemovalPolicy(policy) {
  const violations = [];

  if (!Number.isInteger(policy.removalConfirmations)) {
    violations.push('removalConfirmations must be an integer');
  } else if (
    policy.removalConfirmations < MIN_CONFIRMATIONS ||
    policy.removalConfirmations > MAX_CONFIRMATIONS
  ) {
    violations.push(
      `removalConfirmations must be between ${MIN_CONFIRMATIONS} and ${MAX_CONFIRMATIONS}`,
    );
  }

  if (policy.keepTombstones === false) {
    violations.push('keepTombstones must be true; the engine never deletes ledger records');
  }

  return violations;
}
