/**
 * Consent interstitial handling (DEL-85, TR-NAV-012).
 *
 * ## Only benign, dismissible interstitials
 *
 * A cookie banner sitting on top of a page that has already rendered is a
 * benign interstitial: dismissing it is what any visitor does, and the reviews
 * are underneath it either way.
 *
 * A wall that will not open without an account, or that reappears after being
 * dismissed, is not. That is `ERR-NAV-CONSENT-WALL` — source-scoped, no retry.
 *
 * ## One attempt, never a sequence
 *
 * TR-NAV-012 forbids trying repeated dismissal strategies, and the reason is
 * not efficiency. A component that tries five ways to get past an obstacle is
 * a component that is working around a decision the source made, and ADR-010
 * draws that line explicitly: the engine never disguises itself and never
 * escalates against a refusal.
 *
 * So: try the declared dismissal control once. If the surface appears,
 * continue. If it does not, stop and say so. There is no second strategy to
 * add later — adding one is the change that has to be rejected.
 *
 * ## The dismissal target is pack data
 *
 * A hard-coded button selector is a hard-coded guess about one locale's
 * rendering, and the failure mode is a harvest that reports "no reviews" for
 * every listing in a country nobody tested.
 *
 * @module adapters/acquisition/google-dom/consent
 */

/** How long a dismissal is allowed to take (§19.2). */
export const DISMISS_TIMEOUT_MS = 5_000;

/**
 * @typedef {object} ConsentOutcome
 * @property {'absent' | 'dismissed' | 'wall'} state
 * @property {string} detail
 */

/**
 * Decides what a consent check found.
 *
 * Pure: it takes the two observations that matter — was an interstitial
 * present, and did the surface appear afterwards — and returns the
 * classification. The browser work is the caller's.
 *
 * @param {{ interstitialPresent: boolean, surfacePresentAfter: boolean, dismissAttempted: boolean }} observed
 * @returns {ConsentOutcome}
 */
export function classifyConsent(observed) {
  if (!observed.interstitialPresent) {
    return { state: 'absent', detail: 'no consent interstitial was present' };
  }

  if (!observed.dismissAttempted) {
    return {
      state: 'wall',
      detail: 'a consent interstitial was present and the pack declares no dismissal control',
    };
  }

  if (observed.surfacePresentAfter) {
    return {
      state: 'dismissed',
      detail: 'the interstitial was dismissed and the surface appeared',
    };
  }

  // Dismissal ran and the surface still is not there. That is a wall, and the
  // response is to stop — not to try a second control. TR-NAV-012.
  return {
    state: 'wall',
    detail:
      'the dismissal control was activated and the review surface did not appear; ' +
      'this is a wall, and a second dismissal strategy is not attempted (TR-NAV-012)',
  };
}

/**
 * The error class for a wall.
 *
 * Distinct from `ERR-BLOCKED-CHALLENGE` deliberately: a consent wall is a page
 * state, not an access decision by the source. Reporting it as a block would
 * open the circuit breaker for the whole source-access pair over something that
 * is not evidence of blocking.
 */
export const CONSENT_WALL_ERROR = 'ERR-NAV-CONSENT-WALL';
