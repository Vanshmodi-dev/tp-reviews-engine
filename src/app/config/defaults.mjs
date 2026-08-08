/**
 * Layer 1 — a code default for **every** configuration key (T-155, TR-APP-031).
 *
 * ## Why every key, without exception
 *
 * A key with no default has an undefined value until somebody sets it, and the
 * behaviour of the engine then depends on a file that may not exist. Onboarding
 * a client is meant to be "write a config naming the listing"; a missing default
 * turns it into "write a config naming the listing, and also discover the
 * fourteen keys that have no value until you supply one".
 *
 * The correspondence test in `tests/unit/config/defaults.test.mjs` enforces
 * this against the schema, and its verification is that deleting one default
 * fails the suite.
 *
 * ## These are defaults, not ceilings
 *
 * The hard ceilings live in `limits.mjs` as compile-time constants (TR-CFG-031).
 * A ceiling that can be configured is not a ceiling — and the difference
 * matters because a breach is a validation **error**, never a silent clamp
 * (TR-CFG-030). Clamping hides operator intent, which is exactly what has to be
 * visible during an incident.
 *
 * @module app/config/defaults
 */

/**
 * The complete default configuration.
 *
 * Ordered as TRD §8.4 orders it, so the two can be diffed by eye.
 */
export const DEFAULTS = Object.freeze({
  config_version: 1,

  // §8.4.2 Navigation and acquisition.
  nav: Object.freeze({
    max_reviews: 1000,
    scroll_timeout_ms: 30_000,
    stall_threshold: 3,
    expansion_cap: 200,
  }),

  // §8.4.3 Normalisation and validation.
  normalize: Object.freeze({ max_text_length: 5000 }),

  validate: Object.freeze({
    coverage_min: 0.95,
    quarantine_max: 0.05,
    rating_tolerance: 0.3,
    near_duplicate_threshold: 0.92,
  }),

  // §8.4.4 Reconciliation.
  reconcile: Object.freeze({
    removal_confirmations: 3,
    coverage_min: 0.95,
    near_duplicate_threshold: 0.92,
    // MUST remain true in production. It exists as a key only so tests can
    // build a ledger without tombstone accumulation; setting it false in a
    // client config is a defect, and validation warns.
    keep_tombstones: true,
  }),

  // §8.4.5 Publish Gate.
  gate: Object.freeze({
    max_count_drop_ratio: 0.2,
    max_rating_shift: 0.5,
    coverage_min: 0.95,
    quarantine_max: 0.05,
    max_payload_bytes: 2_000_000,
  }),

  // §8.4.6 Display and publication.
  display: Object.freeze({
    order: 'newest',
    latest_count: 20,
    min_text_length: 0,
    languages: null,
    include_rating_only: true,
    // Null by default and deliberately so: the product position is that
    // TradyPerch declines to filter out low ratings. Setting it triggers V-8,
    // which requires a written justification.
    min_rating: null,
  }),

  publish: Object.freeze({
    reviews: true,
    latest: true,
    stats: true,
    // Off by default. Emitting structured review markup that violates a search
    // engine's policy can cause a manual action against the CLIENT's site.
    schema_org: false,
    payload_shard_threshold: 1_000_000,
  }),

  // §8.4.7 Rate limiting and budgets.
  budget_target_ms: 300_000,
  budget_run_ms: 900_000,
  inter_target_delay_ms: 10_000,
  min_request_delay_ms: 500,
  source_hourly_budget: 200,
  source_daily_budget: 2000,
  max_parallel: 4,
  cadence_floor_hours: 6,
});

/**
 * Every default key, as dotted paths.
 *
 * Used by the correspondence test and by the resolution trace, both of which
 * need to enumerate the surface rather than assume it.
 *
 * @param {Record<string, any>} [source]
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function defaultKeyPaths(source = DEFAULTS, prefix = '') {
  /** @type {string[]} */
  const paths = [];

  for (const [key, value] of Object.entries(source)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;

    // A null default is a value, not a hole: `display.languages: null` means
    // "all languages" and `display.min_rating: null` means "do not filter".
    // Recursing into them would lose the key entirely.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...defaultKeyPaths(value, path));
      continue;
    }

    paths.push(path);
  }

  return paths;
}
