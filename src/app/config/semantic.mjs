/**
 * Semantic validation V-1…V-12 (T-174, TRD §49.2).
 *
 * ## These live here, not in the loader (§24.1 step 12)
 *
 * The loader answers "what is the effective value of every key". These rules
 * answer "does this configuration make sense", and the two fail differently: a
 * loader failure stops the run, while a semantic failure blocks a **merge**.
 * Putting them in the loader would mean a config that cannot be merged also
 * cannot be inspected, and `validate-config --explain` is exactly the tool an
 * operator reaches for when working out why.
 *
 * ## V-3 is the compliance gate, and it is mechanical on purpose
 *
 * TR-CFG-041: *"V-3 MUST be enforced mechanically, not by review. It is the
 * mechanism by which the written-authorisation requirement is guaranteed rather
 * than hoped for."*
 *
 * A DOM adapter reads a source's rendered pages. Doing that for a client
 * without their written authorisation is the one failure here that is not a
 * technical problem — and "the reviewer will catch it" is not a control when
 * the reviewer is the same person who wrote the config at 6pm on a Friday.
 *
 * ## Errors block; warnings do not
 *
 * V-1…V-7 block the workflow (TR-CFG-040). V-8…V-12 are deliberate friction:
 * they make a choice visible and justified rather than impossible. A mechanism
 * that makes the wrong choice slightly uncomfortable is more durable than one
 * that makes it impossible and gets bypassed by a fork.
 *
 * @module app/config/semantic
 */

import { checkLimits, describeViolation } from './limits.mjs';

/** Adapters that read a source's rendered pages and therefore require V-3. */
const DOM_ADAPTERS = Object.freeze(['google:dom']);

/** Above this, the gate tolerates losing more than half a client's reviews. */
const SANE_COUNT_DROP_CEILING = 0.5;

/** Fields an authorisation block must all carry to count as complete. */
const AUTHORISATION_FIELDS = Object.freeze(['granted_by', 'granted_at', 'evidence_url', 'scope']);

/**
 * @typedef {object} Finding
 * @property {string} rule      e.g. `V-3`.
 * @property {string} severity  `error` or `warning`.
 * @property {string} message
 */

/**
 * @param {string} rule
 * @param {string} severity
 * @param {string} message
 * @returns {Finding}
 */
function finding(rule, severity, message) {
  return { rule, severity, message };
}

/**
 * Runs every semantic rule against one client config.
 *
 * Returns **all** findings. A validator reporting one problem per run turns a
 * five-minute config fix into four review cycles.
 *
 * @param {any} config     The client config, as authored.
 * @param {any} [context]  `{ filename, env }` for rules that need them.
 * @returns {Finding[]}
 */
export function validateSemantics(config, context = {}) {
  return [
    ...ruleSlugMatchesFilename(config, context),
    ...ruleListingKeysUnique(config),
    ...ruleAuthorisationForDomAdapters(config),
    ...ruleSecretsPresent(config, context),
    ...ruleNoCeilingBreach(config),
    ...ruleIdentifierWithoutSearch(config),
    ...ruleExpectedName(config),
    ...ruleMinRatingJustified(config),
    ...ruleSchemaOrgAcknowledged(config),
    ...ruleGateThresholdsSane(config),
    ...ruleListingHasIdentifier(config),
    ...ruleTierCadenceCoherent(config),
  ];
}

/** V-1 — the slug must equal the filename stem. */
/**
 * @param {any} config
 * @param {any} context
 * @returns {Finding[]}
 */
function ruleSlugMatchesFilename(config, { filename }) {
  if (filename === undefined || config.slug === undefined) return [];

  const stem = String(filename)
    .replace(/\.config\.json$/u, '')
    .replace(/\.json$/u, '');

  return config.slug === stem
    ? []
    : [
        finding(
          'V-1',
          'error',
          // The slug is a path segment on the `data` branch. A mismatch means
          // the file and the directory it publishes into disagree, which is
          // discovered by a client whose reviews stopped appearing.
          `slug "${config.slug}" does not match the filename stem "${stem}"`,
        ),
      ];
}

/** V-2 — listing keys must be unique within a client. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleListingKeysUnique(config) {
  const keys = (config.listings ?? []).map((/** @type {any} */ listing) => listing.key);
  const seen = new Set();
  const duplicates = new Set();

  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }

  return [...duplicates].map((key) =>
    finding(
      'V-2',
      'error',
      // Two listings sharing a key write the same ledger path, so one silently
      // overwrites the other on every run.
      `listing key "${key}" appears more than once; keys must be unique within a client`,
    ),
  );
}

/** V-3 — a DOM adapter requires a complete authorisation block. THE compliance gate. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleAuthorisationForDomAdapters(config) {
  /** @type {Finding[]} */
  const findings = [];

  for (const listing of config.listings ?? []) {
    if (!DOM_ADAPTERS.includes(listing.adapter)) continue;

    const authorisation = listing.authorization ?? config.authorization;
    const missing =
      authorisation === undefined || authorisation === null
        ? [...AUTHORISATION_FIELDS]
        : AUTHORISATION_FIELDS.filter((field) => !isPresent(authorisation[field]));

    if (missing.length === 0) continue;

    findings.push(
      finding(
        'V-3',
        'error',
        `listing "${listing.key}" uses ${listing.adapter} but its authorization block is ` +
          `missing: ${missing.join(', ')}. Reading a source's rendered pages on a client's ` +
          `behalf requires their written authorisation, and this rule is the mechanism that ` +
          `guarantees it rather than hoping for it (TR-CFG-041).`,
      ),
    );
  }

  return findings;
}

/** V-4 — declared secrets must exist in the environment at run time. */
/**
 * @param {any} config
 * @param {any} context
 * @returns {Finding[]}
 */
function ruleSecretsPresent(config, { env }) {
  if (env === undefined) return [];

  return (config.secrets ?? [])
    .filter((/** @type {string} */ name) => !isPresent(env[name]))
    .map((/** @type {string} */ name) =>
      finding(
        'V-4',
        'error',
        // Caught here rather than at the first request, because a missing
        // secret discovered mid-harvest has already spent budget and may have
        // left a half-finished target.
        `secret ${name} is declared but not present in the environment`,
      ),
    );
}

/** V-5 — no override exceeds a hard ceiling. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleNoCeilingBreach(config) {
  return checkLimits(config).map((violation) =>
    finding('V-5', 'error', describeViolation(violation)),
  );
}

/** V-6 — an explicit identifier is required when search resolution is disabled. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleIdentifierWithoutSearch(config) {
  if (config.resolution?.allow_search !== false) return [];

  return (config.listings ?? [])
    .filter((/** @type {any} */ listing) => !hasIdentifier(listing))
    .map((/** @type {any} */ listing) =>
      finding(
        'V-6',
        'error',
        `listing "${listing.key}" has no place_id, cid or url, and allow_search is false, ` +
          `so there is no way to reach it`,
      ),
    );
}

/** V-7 — every listing needs an expected name. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleExpectedName(config) {
  return (config.listings ?? [])
    .filter((/** @type {any} */ listing) => !isPresent(listing.expected_name))
    .map((/** @type {any} */ listing) =>
      finding(
        'V-7',
        'error',
        // The expected name is what identity verification compares against.
        // Without it the engine cannot tell that it resolved the wrong business,
        // which is the failure that publishes a stranger's reviews.
        `listing "${listing.key}" has no expected_name, so the engine cannot verify it ` +
          `resolved the right business`,
      ),
    );
}

/** V-8 — filtering by rating requires a written justification. Deliberate friction. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleMinRatingJustified(config) {
  const minRating = config.display?.min_rating;

  if (minRating === undefined || minRating === null) return [];

  return isPresent(config.notes)
    ? []
    : [
        finding(
          'V-8',
          'warning',
          `display.min_rating is set to ${minRating}, which filters out reviews. The product ` +
            `position is that TradyPerch declines to do this; if a jurisdiction or platform ` +
            `requires it, record why in "notes".`,
        ),
      ];
}

/** V-9 — enabling schema.org requires acknowledging the policy warning. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleSchemaOrgAcknowledged(config) {
  if (config.publish?.schema_org !== true) return [];

  return config.publish?.schema_org_policy_acknowledged === true
    ? []
    : [
        finding(
          'V-9',
          'warning',
          `publish.schema_org is enabled without schema_org_policy_acknowledged. Search ` +
            `engines have specific and changing policies about self-serving review markup, ` +
            `and a violation can cause a manual action against the CLIENT's site.`,
        ),
      ];
}

/** V-10 — gate thresholds within sane bounds. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleGateThresholdsSane(config) {
  const ratio = config.gate?.max_count_drop_ratio;

  if (typeof ratio !== 'number' || ratio <= SANE_COUNT_DROP_CEILING) return [];

  return [
    finding(
      'V-10',
      'warning',
      `gate.max_count_drop_ratio is ${ratio}; above 0.5 the rule tolerates losing more than ` +
        `half a client's reviews without objecting`,
    ),
  ];
}

/** V-11 — a listing with no explicit identifier is fragile even when search is allowed. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleListingHasIdentifier(config) {
  if (config.resolution?.allow_search === false) return [];

  return (config.listings ?? [])
    .filter((/** @type {any} */ listing) => !hasIdentifier(listing))
    .map((/** @type {any} */ listing) =>
      finding(
        'V-11',
        'warning',
        `listing "${listing.key}" relies on search resolution; an explicit place_id or url ` +
          `is stable where a search result is not`,
      ),
    );
}

/** V-12 — premium tier with daily cadence is contradictory. */
/**
 * @param {any} config
 * @returns {Finding[]}
 */
function ruleTierCadenceCoherent(config) {
  if (config.tier !== 'premium' || config.cadence !== 'daily') return [];

  return [
    finding(
      'V-12',
      'warning',
      `tier "premium" with cadence "daily" is contradictory: premium implies a faster cadence ` +
        `than daily, so one of the two is not what was intended`,
    ),
  ];
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * @param {any} listing
 * @returns {boolean}
 */
function hasIdentifier(listing) {
  const identity = listing.identity ?? {};

  return isPresent(identity.place_id) || isPresent(identity.cid) || isPresent(identity.url);
}

/**
 * Whether findings block a merge.
 *
 * @param {ReadonlyArray<Finding>} findings
 * @returns {boolean}
 */
export function blocks(findings) {
  return findings.some((entry) => entry.severity === 'error');
}
