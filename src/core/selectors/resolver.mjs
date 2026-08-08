/**
 * Ordered strategy resolution and strategy health (T-189, T-190, T-191).
 *
 * ## The strategy index is the early-warning signal
 *
 * Strategies are tried in stability order and the **index that succeeded** is
 * recorded. That number is the most valuable diagnostic the extraction layer
 * produces, and it is easy to throw away.
 *
 * A field that has always resolved at index 0 and starts resolving at index 1
 * is telling you the source changed and the pack is now running on its
 * fallback. Extraction still works, the payload is still correct, and nothing
 * fails — but the margin is gone, and the next change takes the field out
 * entirely. Without the histogram that transition is invisible until the day it
 * breaks.
 *
 * ## All strategies failing is an error, never a silent null
 *
 * T-191. A required field with no surviving strategy quarantines the record.
 * Publishing a null instead would put a review on a client's site with no
 * rating, or no author, and the payload would be schema-valid — so nothing
 * downstream would object.
 *
 * The quarantine rate is what gate rule G-06 watches, which is how a broken
 * pack becomes a blocked publish rather than a degraded one.
 *
 * ## Pure, and DOM-agnostic
 *
 * The resolver takes a `probe` function. It never touches a document, which is
 * what lets it live in `core/` and be tested without a browser — and what keeps
 * DR-1 true.
 *
 * @module core/selectors/resolver
 */

/**
 * @typedef {object} Resolution
 * @property {string} field
 * @property {boolean} ok
 * @property {unknown} value
 * @property {number} strategyIndex  -1 when nothing resolved.
 * @property {string | null} kind    The kind that succeeded.
 * @property {string[]} attempted    Kinds tried, in order.
 */

/**
 * Resolves one field by trying its strategies in order.
 *
 * @param {string} field
 * @param {any} spec        The field's pack entry.
 * @param {(strategy: any) => unknown} probe  Returns a value, or null/undefined.
 * @returns {Resolution}
 */
export function resolveField(field, spec, probe) {
  const strategies = spec?.strategies ?? [];
  /** @type {string[]} */
  const attempted = [];

  for (const [index, strategy] of strategies.entries()) {
    attempted.push(strategy.kind);

    let value;

    try {
      value = probe(strategy);
    } catch {
      // A strategy that throws is a strategy that did not work, not a failed
      // extraction. A malformed CSS selector in strategy 0 must not stop
      // strategy 1 from being tried — that is the entire point of having one.
      continue;
    }

    if (value === null || value === undefined || value === '') continue;

    return { field, ok: true, value, strategyIndex: index, kind: strategy.kind, attempted };
  }

  return { field, ok: false, value: null, strategyIndex: -1, kind: null, attempted };
}

/**
 * Resolves every field in a pack.
 *
 * @param {any} pack
 * @param {(field: string, strategy: any) => unknown} probe
 * @returns {{ values: Record<string, unknown>, resolutions: Resolution[], missing: string[] }}
 */
export function resolveAll(pack, probe) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Resolution[]} */
  const resolutions = [];
  /** @type {string[]} */
  const missing = [];

  for (const [field, spec] of Object.entries(pack.fields ?? {})) {
    const resolution = resolveField(field, spec, (strategy) => probe(field, strategy));

    resolutions.push(resolution);

    if (resolution.ok) {
      values[field] = resolution.value;
      continue;
    }

    // Only a REQUIRED field failing is a problem. An optional field that did
    // not resolve is a null the capability declaration already explains.
    if (/** @type {any} */ (spec).required === true) missing.push(field);
  }

  return { values, resolutions, missing };
}

/**
 * Whether a record must be quarantined rather than published (T-191).
 *
 * @param {{ missing: string[] }} result
 * @returns {boolean}
 */
export function mustQuarantine(result) {
  return result.missing.length > 0;
}

/**
 * A per-field histogram of which strategy index won (T-190, §44.2).
 *
 * Feeds the health record. The shape is deliberately a count per index rather
 * than an average: an average of 0.1 hides that one record in ten is already
 * falling through to the fallback, and that is exactly the fact worth alerting
 * on.
 *
 * @param {ReadonlyArray<Resolution>} resolutions
 * @returns {Record<string, { counts: Record<string, number>, failures: number }>}
 */
export function strategyHealth(resolutions) {
  /** @type {Record<string, { counts: Record<string, number>, failures: number }>} */
  const health = {};

  for (const resolution of resolutions) {
    const entry = health[resolution.field] ?? { counts: {}, failures: 0 };

    if (resolution.ok) {
      const key = String(resolution.strategyIndex);

      entry.counts[key] = (entry.counts[key] ?? 0) + 1;
    } else {
      entry.failures += 1;
    }

    health[resolution.field] = entry;
  }

  return health;
}

/**
 * Fields whose primary strategy is no longer winning.
 *
 * The early-warning signal, extracted as a question rather than left for a
 * human to spot in a histogram. A field below the threshold is running on its
 * fallback, which still works and will not for much longer.
 *
 * @param {Record<string, { counts: Record<string, number>, failures: number }>} health
 * @param {number} [threshold] Fraction of resolutions that must hit index 0.
 * @returns {{ field: string, primaryRate: number }[]}
 */
export function degradedFields(health, threshold = 0.9) {
  const degraded = [];

  for (const [field, entry] of Object.entries(health)) {
    const total =
      Object.values(entry.counts).reduce((sum, count) => sum + count, 0) + entry.failures;

    if (total === 0) continue;

    const primaryRate = (entry.counts['0'] ?? 0) / total;

    if (primaryRate < threshold) degraded.push({ field, primaryRate });
  }

  return degraded;
}
