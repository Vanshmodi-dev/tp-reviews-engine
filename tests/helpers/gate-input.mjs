/**
 * Builders for gate inputs.
 *
 * The gate takes eight things and every test is about one of them. These make
 * the interesting one visible and everything else uninteresting and valid.
 *
 * @module tests/helpers/gate-input
 */

/**
 * A stats block that passes every rule, with the field under test overridable.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function stats(overrides = {}) {
  return {
    total_count: 100,
    advertised_total: 100,
    coverage: 1,
    mean_rating: 4.5,
    advertised_rating: 4.5,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 50, 5: 50 },
    with_text_count: 90,
    with_reply_count: 10,
    newest_review_date: '2026-02-01T00:00:00.000Z',
    oldest_review_date: '2025-01-01T00:00:00.000Z',
    languages: { en: 100 },
    completeness: 'full',
    last_full_harvest_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A candidate payload that passes every rule.
 *
 * @param {Record<string, any>} [statsOverrides]
 * @returns {any}
 */
export function candidate(statsOverrides = {}) {
  return {
    schema_version: 1,
    artifact: 'reviews',
    generated_at: '2026-03-01T00:00:00.000Z',
    client: { slug: 'acme-dental', display_name: 'Acme Dental' },
    listing: { key: 'main', display_name: 'Acme Dental' },
    provenance: {},
    stats: stats(statsOverrides),
    reviews: [],
  };
}

/**
 * A validation report with nothing wrong.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function validation(overrides = {}) {
  return { considered: 100, quarantined: 0, findings: [], ...overrides };
}

/**
 * A complete gate input that yields ACCEPT.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function gateInput(overrides = {}) {
  return {
    candidate: candidate(),
    prior: candidate(),
    priorReadable: true,
    validation: validation(),
    candidateBytes: 1024,
    schemaErrors: [],
    nearDuplicates: [],
    ...overrides,
  };
}

/**
 * The ids of every rule that fired, in order.
 *
 * @param {any} verdict
 * @returns {string[]}
 */
export function firedRules(verdict) {
  return verdict.reasons.map((/** @type {any} */ reason) => reason.rule);
}

/**
 * The reason for one rule, or undefined.
 *
 * @param {any} verdict
 * @param {string} ruleId
 * @returns {any}
 */
export function reasonFor(verdict, ruleId) {
  return verdict.reasons.find((/** @type {any} */ reason) => reason.rule === ruleId);
}
