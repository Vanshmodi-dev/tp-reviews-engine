/**
 * The public payload — **the contract**.
 *
 * Every other type in this codebase is internal and can be changed in a
 * refactor. This one is read by client websites TradyPerch does not control,
 * cached at the edge for ten minutes, and embedded in markup that outlives any
 * given engine release. Breaking it is a migration, not a deploy.
 *
 * Three rules follow from that, and all three are enforced here rather than
 * left to the projector:
 *
 * 1. **No internal state field appears.** No `author_key`, no `missing_streak`,
 *    no `content_hash_history`. The schema sets `additionalProperties: false`,
 *    so a leaked field is a rejected publication rather than a privacy
 *    incident.
 * 2. **`generated_at` is excluded from the content hash** (TR-HASH-031). It
 *    changes every run by definition; including it would rewrite every file on
 *    every harvest and multiply commit churn by roughly fifty.
 * 3. **Nothing is fabricated.** A field the adapter could not supply is `null`,
 *    and `provenance.adapter_capabilities` says which those are, so a consumer
 *    can tell "absent because unavailable" from "absent because empty".
 *
 * TRD §52.3–§52.7 is the authority. `schemas/payload.v1.schema.json` becomes
 * the *runtime* authority in PH-06 (T-112) and is derived from this module —
 * which is why this lands first and why the field lists must agree exactly.
 *
 * @module core/model/payload
 */

/**
 * @typedef {import('./review.mjs').PayloadReview} PayloadReview
 * @typedef {import('./review.mjs').CleanString} CleanString
 */

/** The only schema version v1.0 emits. Consumers must check this. */
export const SCHEMA_VERSION = 1;

/** Artifact kinds. Each is a separate file under the listing directory. */
export const ARTIFACTS = Object.freeze(['reviews', 'latest', 'stats', 'schema_org', 'index']);

/**
 * Notices are human-readable context, **never an error channel**.
 *
 * A failed harvest does not produce a payload at all — the Publish Gate holds
 * the previous one. So a notice always accompanies data that is *published and
 * correct*, and only ever explains why it might be less complete than usual.
 */
export const NOTICES = Object.freeze([
  'harvest_partial',
  'harvest_capped',
  'source_unavailable',
  'awaiting_first_full_harvest',
]);

/** Fields that exist in the ledger and must never reach a payload. */
export const FORBIDDEN_PAYLOAD_FIELDS = Object.freeze([
  'author_key',
  'missing_streak',
  'content_hash_history',
  'tombstoned_at',
  'state',
  'last_seen_at',
]);

/**
 * The envelope every artifact shares (§52.3).
 *
 * @typedef {object} PayloadEnvelope
 * @property {number} schema_version   Major version. Consumers MUST check this.
 * @property {string} artifact         One of {@link ARTIFACTS}.
 * @property {string} generated_at     RFC 3339 UTC. **Excluded from the content hash.**
 * @property {{ slug: string, display_name: string }} client
 * @property {ListingBlock} listing
 * @property {Provenance} provenance
 * @property {Stats} stats
 * @property {ReadonlyArray<PayloadReview>} [reviews]  Absent in the `stats` artifact; may be empty.
 * @property {Pagination | null} [pagination]          Present only when sharded.
 * @property {ReadonlyArray<string> | null} [notices]
 */

/**
 * Listing identity (§52.4).
 *
 * @typedef {object} ListingBlock
 * @property {string} key                    Stable internal key. Part of the URL. **Never changes.**
 * @property {string} source
 * @property {string | null} source_id       Canonical identifier at the source, where publishable.
 * @property {string | null} source_url      Deep link. **Engine-constructed, never scraped.**
 * @property {string} display_name           Business name as configured.
 * @property {string | null} locale          BCP 47 tag used during acquisition.
 * @property {number | null} advertised_total  Source-reported total at harvest time.
 * @property {number | null} advertised_rating Source-reported aggregate.
 * @property {string | null} address_hint    Coarse label. **Never a precise address.**
 */

/**
 * Aggregates (§52.6).
 *
 * `advertised_total` is never substituted for `total_count`, and `mean_rating`
 * is computed from published reviews rather than copied from
 * `advertised_rating`. Both substitutions would make the payload claim more
 * than the engine actually has, which is the specific dishonesty this product
 * exists to avoid.
 *
 * @typedef {object} Stats
 * @property {number} total_count            Published reviews, post-filter, post-suppression.
 * @property {number | null} advertised_total As reported by the source.
 * @property {number | null} coverage        `total_count / advertised_total`, or null.
 * @property {number} mean_rating            Computed over published reviews, 2 dp.
 * @property {number | null} advertised_rating
 * @property {Record<string, number>} distribution  Counts keyed "1".."5". Sums to `total_count`.
 * @property {number} with_text_count
 * @property {number} with_reply_count
 * @property {string | null} newest_review_date
 * @property {string | null} oldest_review_date
 * @property {Record<string, number>} languages     Count per detected code.
 * @property {string} completeness           `full` / `full_capped` / `partial`.
 * @property {string | null} last_full_harvest_at  **The honest freshness signal.**
 */

/**
 * Engine and run provenance (§52.7). INV-06 is satisfied entirely by this
 * object: given a payload, an engineer can identify the exact code, the exact
 * selector pack, and the exact run that produced it.
 *
 * @typedef {object} Provenance
 * @property {string} engine_version
 * @property {number} schema_version         Duplicated for convenience.
 * @property {string} adapter                e.g. `google:dom`.
 * @property {ReadonlyArray<string>} adapter_capabilities  What this adapter could supply — **explains any nulls**.
 * @property {string | null} selector_pack_version  `null` for API adapters.
 * @property {number} identity_algo_version
 * @property {string} run_id
 * @property {string} harvest_started_at
 * @property {string} harvest_completeness
 * @property {string} content_hash           Over canonical bytes **excluding `generated_at`**.
 */

/**
 * Present only when a payload is sharded across files.
 *
 * @typedef {object} Pagination
 * @property {number} page
 * @property {number} page_count
 * @property {number} page_size
 * @property {string | null} next
 */

/**
 * Strips the fields that must never be published, returning what is left.
 *
 * Used as a self-check before serialisation. The schema's
 * `additionalProperties: false` is the authoritative rejection; this exists so
 * the failure is caught with a useful message at the point of construction
 * rather than as a schema error three stages later.
 *
 * @param {Record<string, unknown>} candidate
 * @returns {string[]} Forbidden field names present, empty when clean.
 */
export function findForbiddenFields(candidate) {
  return FORBIDDEN_PAYLOAD_FIELDS.filter((field) => Object.hasOwn(candidate, field));
}

/**
 * The canonical hash input for a payload: everything except `generated_at`.
 *
 * TR-HASH-031. `generated_at` changes on every run by definition. Including it
 * would make every file differ every time, defeating hash-gating and
 * multiplying commit churn by roughly fifty — the exact failure IR-06 names.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>} A copy without `generated_at`.
 */
export function hashableProjection(payload) {
  // Copy-then-delete rather than a rest-sibling omission. The destructuring
  // idiom needs an unused binding, and silencing no-unused-vars to allow it
  // would weaken the rule everywhere for one line's convenience.
  const projection = { ...payload };
  delete projection.generated_at;

  return projection;
}

/**
 * Whether a stats block is internally consistent.
 *
 * A distribution that does not sum to `total_count` means reviews were counted
 * in one place and not another — the kind of arithmetic error that makes a
 * client's displayed average disagree with their own star bars.
 *
 * @param {Stats} stats
 * @returns {string[]} Inconsistencies, empty when sound.
 */
export function checkStatsConsistency(stats) {
  const problems = [];
  const distributionTotal = Object.values(stats.distribution).reduce((sum, n) => sum + n, 0);

  if (distributionTotal !== stats.total_count) {
    problems.push(
      `distribution sums to ${distributionTotal} but total_count is ${stats.total_count}`,
    );
  }
  if (stats.with_text_count > stats.total_count) {
    problems.push(
      `with_text_count ${stats.with_text_count} exceeds total_count ${stats.total_count}`,
    );
  }
  if (stats.with_reply_count > stats.total_count) {
    problems.push(
      `with_reply_count ${stats.with_reply_count} exceeds total_count ${stats.total_count}`,
    );
  }
  if (stats.coverage !== null && (stats.coverage < 0 || stats.coverage > 1)) {
    problems.push(`coverage ${stats.coverage} is outside 0..1`);
  }

  return problems;
}
