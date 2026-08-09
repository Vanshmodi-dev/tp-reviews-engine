/**
 * Structural signal detection and the §21.8.1 classification rule.
 *
 * ## The highest-severity detection path in the system
 *
 * A missed challenge means the parser attempts to extract reviews from a
 * challenge page. That produces a misleading `ERR-PARSE-STRUCTURE`, which sends
 * an engineer to the selector-repair runbook to investigate markup that is not
 * broken — and, worst, it produces a **retry**, which escalates a soft block
 * into a hard one.
 *
 * That is why classification happens before extraction and why the codes are
 * different: `ERR-BLOCKED-CHALLENGE` is terminal with zero retries (TR-NAV-041)
 * and `ERR-PARSE-STRUCTURE` is a bug report. Getting the two confused makes the
 * engine's response exactly backwards.
 *
 * ## Why this is pure, and why it also lives here
 *
 * TR-NAV-040 puts detection at the end of navigation. That is where it *runs
 * first*, and the navigator will call this same function. It is implemented in
 * `core/` because the classification rule is arithmetic over declared patterns
 * and nothing else — so it is testable against saved fixtures with no browser,
 * which is what `016-challenge-page` needs (TR-NAV-043).
 *
 * Extraction also consults it as a terminal guard. The duplication is
 * deliberate: if extraction is ever handed a challenge page, the correct answer
 * is `ERR-BLOCKED-CHALLENGE`, and reporting a parse failure instead is the
 * specific mistake this module exists to prevent.
 *
 * ## The empty-state signal is load-bearing
 *
 * A listing with genuinely zero reviews and a listing whose markup changed both
 * produce an empty node list. The difference between them is the difference
 * between correctly publishing nothing and silently wiping a client's reviews,
 * and the *only* thing separating them is a declared empty-state signal. That
 * is why it is pack data rather than an inference.
 *
 * @module core/extract/signals
 */

/** Two medium-confidence signals classify the same as one high (§21.8.1). */
const MEDIUM_QUORUM = 2;

/**
 * @typedef {object} SignalHit
 * @property {string} name
 * @property {'high' | 'medium' | 'low'} confidence
 * @property {string} pattern  The declared pattern that matched.
 */

/**
 * Which declared signals match the page text.
 *
 * Matching is case-insensitive and substring-based against the *declared*
 * patterns. The patterns are pack data (§20.2.1 `signals`), never constants
 * here — a hard-coded English challenge phrase misses every localised
 * challenge page, which is the failure mode with the worst consequence.
 *
 * @param {string} html
 * @param {any} pack
 * @returns {SignalHit[]}
 */
export function detectSignals(html, pack) {
  const declared = pack?.signals ?? pack?.detectors ?? {};
  const haystack = html.toLowerCase();
  /** @type {SignalHit[]} */
  const hits = [];

  for (const [name, signal] of Object.entries(declared)) {
    const matched = firstMatchingPattern(haystack, /** @type {any} */ (signal)?.patterns);

    if (matched === null) continue;

    hits.push({
      name,
      confidence: /** @type {any} */ (signal)?.confidence ?? 'low',
      pattern: matched,
    });
  }

  return hits;
}

/**
 * @param {string} haystack  Already lower-cased.
 * @param {unknown} patterns
 * @returns {string | null}
 */
function firstMatchingPattern(haystack, patterns) {
  if (!Array.isArray(patterns)) return null;

  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    if (haystack.includes(pattern.toLowerCase())) return pattern;
  }

  return null;
}

/**
 * Applies the §21.8.1 classification rule.
 *
 * | Evidence | Classification |
 * | --- | --- |
 * | Any single **high** signal | `ERR-BLOCKED-CHALLENGE` |
 * | Two **medium** signals | `ERR-BLOCKED-CHALLENGE` |
 * | One medium, or low only | `ERR-NAV-SURFACE-NOT-FOUND` → selector-break runbook |
 *
 * The consent wall is carved out of the challenge path because it has its own
 * code and its own response: a consent interstitial is a page state to handle,
 * not an access decision by the source, and treating it as a block would open a
 * breaker over something a navigator can dismiss.
 *
 * @param {SignalHit[]} hits
 * @returns {{ code: string, reason: string } | null}
 */
export function classifySignals(hits) {
  const challenge = hits.filter((hit) => hit.name !== 'empty_state' && hit.name !== 'consent');
  const high = challenge.filter((hit) => hit.confidence === 'high');
  const medium = challenge.filter((hit) => hit.confidence === 'medium');

  if (high.length > 0) {
    return {
      code: 'ERR-BLOCKED-CHALLENGE',
      reason: `high-confidence signal "${/** @type {SignalHit} */ (high[0]).name}" matched ${JSON.stringify(/** @type {SignalHit} */ (high[0]).pattern)}`,
    };
  }

  if (medium.length >= MEDIUM_QUORUM) {
    return {
      code: 'ERR-BLOCKED-CHALLENGE',
      reason: `${medium.length} medium-confidence signals matched: ${medium.map((hit) => hit.name).join(', ')}`,
    };
  }

  const consent = hits.find((hit) => hit.name === 'consent');

  if (consent !== undefined) {
    return {
      code: 'ERR-NAV-CONSENT-WALL',
      reason: `consent interstitial matched ${JSON.stringify(consent.pattern)}`,
    };
  }

  if (medium.length === 1) {
    return {
      code: 'ERR-NAV-SURFACE-NOT-FOUND',
      reason: `one medium-confidence signal "${/** @type {SignalHit} */ (medium[0]).name}" matched`,
    };
  }

  return null;
}

/**
 * True when the pack's empty-state signal matched.
 *
 * @param {SignalHit[]} hits
 * @returns {boolean}
 */
export function hasEmptyState(hits) {
  return hits.some((hit) => hit.name === 'empty_state');
}
