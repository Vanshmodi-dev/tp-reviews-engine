/**
 * Ledger → public payload (T-114, ALG-PROJECT, TRD §24.2).
 *
 * Pure, and **deterministic to the byte**: identical ledger plus identical
 * config produces identical output, which PT-12 asserts. That guarantee is what
 * makes hash-gating work, what makes a permanently failed push survivable (the
 * next run reproduces the same artifacts), and what keeps the git history a
 * record of real changes rather than of run timestamps.
 *
 * ## The seven steps, in order
 *
 * 1. Drop tombstoned and suppressed records.
 * 2. Apply display filters.
 * 3. Order by the total composite key.
 * 4. Project each record to its public shape.
 * 5. Compute aggregates over what survived.
 * 6. Assemble the artifacts.
 * 7. Serialise canonically and hash over bytes excluding `generated_at`.
 *
 * Steps 1 and 2 come before 5 on purpose (TR-PROJ-021): `stats` must describe
 * the payload that exists, not the harvest that produced it.
 *
 * ## What must never cross this boundary
 *
 * `author_key`, `missing_streak`, `content_hash_history`, `tombstoned_at`,
 * `state` and `last_seen_at` are internal. `author_key` in particular is a
 * pseudonymous identifier derived from author details, and publishing it on a
 * public static site would turn an internal correlation key into a permanent
 * cross-site tracking identifier for a person who never agreed to that.
 *
 * The projection is built by **naming every published field** rather than by
 * copying the record and deleting the internal ones. A field added to the
 * ledger later then has to be added here deliberately to appear in a payload,
 * which is the safe default; the delete-list approach leaks by omission.
 *
 * @module core/project/payload
 */

import { publishableRecords } from '../model/ledger.mjs';
import { SCHEMA_VERSION, findForbiddenFields } from '../model/payload.mjs';
import { normaliseAvatarUrl, validateUrl } from '../normalize/url.mjs';
import { applyDisplayFilters, resolveDisplay } from './filters.mjs';
import { orderForPublication } from './order.mjs';
import { computeStats } from './stats.mjs';

/**
 * @typedef {object} ProjectInput
 * @property {any} ledger
 * @property {any} config          Effective config: `display`, `publish`, listing identity.
 * @property {any} meta            Engine and run provenance.
 * @property {string} generatedAt  RFC 3339. Explicit; `core/` reads no clock.
 */

/**
 * One review's public shape.
 *
 * @param {any} record
 * @returns {Record<string, any>}
 */
export function projectReview(record) {
  const review = record.review;

  return {
    id: review.identity_hash,
    ...projectAuthor(review.author),
    rating: review.rating,
    text: review.text ?? null,
    text_truncated: review.text_truncated ?? false,
    date: review.date_estimated,
    date_precision: review.date_precision,
    date_confidence: review.date_confidence,
    language: review.language,
    likes: review.likes ?? null,
    photo_count: review.photo_count ?? null,
    owner_reply: projectOwnerReply(review.owner_reply),
    source: review.source,
    source_url: review.source_url ?? null,
    verified: review.verified ?? null,
    first_seen_at: record.first_seen_at,
    revision: record.revision,
  };
}

/**
 * The author's published fields, flattened.
 *
 * Flattened rather than nested because a consumer rendering a review card wants
 * `review.author_name`, and a nested object would make every widget write
 * `review.author?.name` to guard against an adapter that supplied none.
 *
 * @param {any} author
 * @returns {Record<string, any>}
 */
function projectAuthor(author) {
  const source = author ?? {};

  return Object.fromEntries(
    AUTHOR_FIELDS.map((field) => [`author_${field}`, projectAuthorField(field, source[field])]),
  );
}

/**
 * Applies the host allowlist to the two author fields that are URLs.
 *
 * `core/normalize/url.mjs` implements this control and shipped in PH-02 — and
 * **nothing had ever called it**. Every `avatar_url` and `profile_url` an
 * adapter supplied went into the payload exactly as the source gave it, which
 * coverage never revealed because a module nothing imports is a module the
 * report never lists.
 *
 * That module's own header states the consequence: *"the alternative to a
 * missing avatar is a `javascript:` URI on a client's page"*. The payload
 * renders on websites TradyPerch does not control, `avatar_url` becomes an
 * `<img src>` and `profile_url` an `<a href>`, and neither had been checked for
 * scheme, host, or embedded credentials.
 *
 * Applied at the projection boundary rather than raised as a validation
 * finding, because the control is defined as **fail-closed, not fatal**: an
 * unsafe URL becomes `null`, and `null` renders as initials. That is what
 * `author.initials` is for. Quarantining a whole review over its avatar would
 * discard a perfectly good record.
 *
 * @param {string} field
 * @param {unknown} value
 * @returns {unknown}
 */
function projectAuthorField(field, value) {
  if (field === 'avatar_url') return normaliseAvatarUrl(/** @type {any} */ (value));
  if (field === 'profile_url') return validateUrl(/** @type {any} */ (value));

  return value ?? null;
}

/** The author fields a payload publishes. `author_key` is deliberately absent. */
const AUTHOR_FIELDS = Object.freeze([
  'name',
  'initials',
  'avatar_url',
  'profile_url',
  'is_local_guide',
]);

/**
 * @param {any} reply
 * @returns {Record<string, any> | null}
 */
function projectOwnerReply(reply) {
  if (reply === null || reply === undefined) return null;

  return { text: reply.text ?? null, date: reply.date_estimated ?? null };
}

/**
 * The records this ledger would publish, in order, after filtering.
 *
 * Exported separately because the gate, the stats block and `latest` all need
 * the same set, and recomputing it in three places is how three answers to one
 * question start to disagree.
 *
 * @param {any} ledger
 * @param {any} [display]
 * @returns {any[]}
 */
export function selectPublishable(ledger, display) {
  const resolved = resolveDisplay(display);

  // Step 1 is `publishableRecords`, which drops terminal states. Suppression
  // and tombstoning are enforced there rather than here so that PT-04's claim -
  // a suppressed id never appears in ANY projection - has one place to hold.
  const surviving = applyDisplayFilters(publishableRecords(ledger), resolved);

  return orderForPublication(surviving, resolved.order);
}

/**
 * Builds the `reviews` artifact.
 *
 * @param {ProjectInput} input
 * @returns {Record<string, any>}
 */
export function projectPayload({ ledger, config, meta, generatedAt }) {
  const display = resolveDisplay(config.display);
  const ordered = selectPublishable(ledger, display);
  const reviews = ordered.map((record) => projectReview(record));

  const stats = computeStats({
    published: ordered,
    advertisedTotal: config.listing?.advertised_total ?? null,
    advertisedRating: config.listing?.advertised_rating ?? null,
    completeness: meta.harvest_completeness,
    lastFullHarvestAt: ledger.last_full_harvest_at,
  });

  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'reviews',
    generated_at: generatedAt,
    client: {
      slug: ledger.client_slug,
      display_name: config.client?.display_name ?? ledger.client_slug,
    },
    listing: buildListingBlock(ledger, config),
    provenance: buildProvenance(ledger, meta),
    stats,
    reviews,
    pagination: null,
    notices: buildNotices(meta.harvest_completeness, ledger.last_full_harvest_at),
  };
}

/**
 * @param {any} ledger
 * @param {any} config
 * @returns {Record<string, any>}
 */
function buildListingBlock(ledger, config) {
  const listing = config.listing ?? {};

  return {
    key: ledger.listing_key,
    source: listing.source ?? null,
    source_id: listing.source_id ?? null,
    // Engine-constructed, never scraped: a URL lifted from a page carries
    // whatever tracking parameters the source attached to our own session.
    source_url: listing.source_url ?? null,
    display_name: listing.display_name ?? ledger.listing_key,
    locale: listing.locale ?? null,
    advertised_total: listing.advertised_total ?? null,
    advertised_rating: listing.advertised_rating ?? null,
    address_hint: listing.address_hint ?? null,
  };
}

/**
 * The provenance block (T-117, INV-06).
 *
 * `content_hash` is filled by the serialiser, which is the only thing that can
 * know it — it is computed over the finished bytes. It is present here as
 * `null` rather than absent so the shape does not change between construction
 * and sealing, which would make the schema describe two different objects.
 *
 * @param {any} ledger
 * @param {any} meta
 * @returns {Record<string, any>}
 */
function buildProvenance(ledger, meta) {
  return {
    engine_version: meta.engine_version,
    schema_version: SCHEMA_VERSION,
    adapter: meta.adapter,
    // What the adapter COULD supply. This is what explains a null in the
    // payload: "this adapter cannot see owner replies" is a different fact from
    // "this review has no owner reply", and a consumer cannot tell them apart
    // without it.
    adapter_capabilities: meta.adapter_capabilities ?? [],
    selector_pack_version: meta.selector_pack_version ?? null,
    identity_algo_version: ledger.identity_algo_version,
    run_id: meta.run_id,
    harvest_started_at: meta.harvest_started_at,
    harvest_completeness: meta.harvest_completeness,
    content_hash: null,
  };
}

/**
 * Notices explain reduced completeness. They are **never an error channel**: a
 * failed harvest produces no payload at all, because the gate holds the
 * previous one. So a notice always accompanies data that is published and
 * correct, and only ever says why it might be less complete than usual.
 *
 * @param {string} completeness
 * @param {string | null} lastFullHarvestAt
 * @returns {string[] | null}
 */
function buildNotices(completeness, lastFullHarvestAt) {
  const notices = [];

  if (completeness === 'partial') notices.push('harvest_partial');
  if (completeness === 'full_capped') notices.push('harvest_capped');
  if (lastFullHarvestAt === null) notices.push('awaiting_first_full_harvest');

  return notices.length === 0 ? null : notices;
}

/**
 * Asserts no internal field reached the payload.
 *
 * The schema's `additionalProperties: false` is the authoritative rejection;
 * this runs first so the failure names the field at the point of construction
 * rather than surfacing as a schema error three stages later.
 *
 * @param {Record<string, any>} payload
 * @returns {string[]} Violations, empty when clean.
 */
export function checkPayloadSafety(payload) {
  const problems = [];

  for (const [index, review] of (payload.reviews ?? []).entries()) {
    const leaked = findForbiddenFields(review);

    if (leaked.length > 0) problems.push(`reviews[${index}] leaks ${leaked.join(', ')}`);
  }

  return problems;
}
