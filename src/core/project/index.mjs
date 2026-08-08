/**
 * The projector — ledger to the full artifact set (ALG-PROJECT step 6-7).
 *
 * ## The consumer contract this shape exists to serve
 *
 * `index.json` is the **freshness pointer**: small, short cache TTL, and it
 * carries the content hash of every other artifact. Consumers read it first,
 * then fetch the artifact it names, which can have a long TTL because its
 * content is effectively immutable for a given hash.
 *
 * That pattern gives both freshness and cacheability with **no cache-purge
 * capability**, which matters because the zero-cost hosting this project
 * targets does not offer programmatic purging. There is no "invalidate the CDN"
 * step available, so the design cannot need one.
 *
 * ## Hashing
 *
 * Each artifact's `content_hash` is computed over its canonical bytes with
 * `generated_at` removed (EDR-022), then written back into its provenance
 * block. The hash therefore describes the *content*, not the run, which is what
 * lets the publisher skip a write when nothing changed.
 *
 * Writing the hash into the object after computing it does not invalidate the
 * hash, because `content_hash` itself is excluded from the input — it is set to
 * `null` during construction and the hashable projection drops `generated_at`
 * while the field is still null. The order is: build with `content_hash: null`,
 * hash, then seal.
 *
 * @module core/project
 */

import { sha256Hex } from '../util/hash.mjs';
import { projectLatest, projectStatsArtifact } from './latest.mjs';
import { projectPayload } from './payload.mjs';
import { projectSchemaOrg } from './schema-org.mjs';
import { hashableBytes, serialisePayload } from './serialise.mjs';

/**
 * @typedef {object} Artifact
 * @property {Record<string, any>} payload  The object, with `content_hash` sealed in.
 * @property {string} bytes                 Canonical minified bytes, as written.
 * @property {string} contentHash           Over bytes excluding `generated_at`.
 */

/**
 * Computes an artifact's content hash and seals it into the provenance block.
 *
 * @param {Record<string, any>} payload
 * @returns {Artifact}
 */
export function sealArtifact(payload) {
  const contentHash = sha256Hex(hashableBytes(payload));
  const sealed = {
    ...payload,
    provenance: { ...payload.provenance, content_hash: contentHash },
  };

  return { payload: sealed, bytes: serialisePayload(sealed), contentHash };
}

/**
 * Builds every artifact for one listing.
 *
 * @param {import('./payload.mjs').ProjectInput} input
 * @returns {{ reviews: Artifact, latest: Artifact, stats: Artifact, schemaOrg: Artifact | null, index: Artifact }}
 */
export function projectArtifacts(input) {
  const base = projectPayload(input);

  const reviews = sealArtifact(base);
  const latest = sealArtifact(projectLatest(base, input.config.display));
  const stats = sealArtifact(projectStatsArtifact(base));

  const schemaOrgPayload = projectSchemaOrg(base, input.config.publish);
  const schemaOrg =
    schemaOrgPayload === null
      ? null
      : sealArtifact({ ...base, artifact: 'schema_org', schema_org: schemaOrgPayload });

  const index = sealArtifact(
    buildIndex(base, { reviews, latest, stats, schemaOrg }, input.generatedAt),
  );

  return { reviews, latest, stats, schemaOrg, index };
}

/**
 * The listing manifest (T-121).
 *
 * Carries each artifact's hash so a consumer — and the publisher's hash gate —
 * can tell whether anything actually changed without downloading it.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, Artifact | null>} artifacts
 * @param {string} generatedAt
 * @returns {Record<string, any>}
 */
function buildIndex(base, artifacts, generatedAt) {
  return {
    schema_version: base.schema_version,
    artifact: 'index',
    generated_at: generatedAt,
    client: base.client,
    listing: base.listing,
    provenance: base.provenance,
    stats: base.stats,
    artifacts: Object.fromEntries(
      Object.entries(artifacts)
        .filter(([, artifact]) => artifact !== null)
        .map(([name, artifact]) => [
          name,
          { content_hash: /** @type {Artifact} */ (artifact).contentHash },
        ]),
    ),
    notices: base.notices,
  };
}

export {
  projectPayload,
  projectReview,
  selectPublishable,
  checkPayloadSafety,
} from './payload.mjs';
export { projectLatest, projectStatsArtifact } from './latest.mjs';
export { projectSchemaOrg, datePublishable } from './schema-org.mjs';
export { computeStats, computeCoverage, hasText } from './stats.mjs';
export { canonicalise, hashableBytes, serialiseLedger, serialisePayload } from './serialise.mjs';
export {
  compareForPublication,
  compareForPublicationReversed,
  orderForPublication,
} from './order.mjs';
export {
  DISPLAY_DEFAULTS,
  applyDisplayFilters,
  passesDisplayFilters,
  resolveDisplay,
} from './filters.mjs';
