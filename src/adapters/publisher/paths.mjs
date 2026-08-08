/**
 * Path templates for the `data` branch — the public artifact layout.
 *
 * ```
 * <client>/<listing>/reviews.json      the complete payload
 * <client>/<listing>/latest.json       the top-N slice
 * <client>/<listing>/stats.json        aggregates only
 * <client>/<listing>/schema-org.json   opt-in structured data
 * <client>/<listing>/index.json        the manifest, and the freshness pointer
 * ```
 *
 * ## The listing directory is the unit of disjointness (EDR-035)
 *
 * Shards run in parallel with no locking, and the only thing that makes that
 * safe is that no two shards write the same path. One shard owns one listing
 * directory for the whole run — which is why every template here goes through
 * the client and listing segments before it names a file, and why paths are
 * never assembled at a call site.
 *
 * These live beside the publisher rather than beside the state adapter because
 * an adapter may not import another adapter (DR-3). The shared traversal guard
 * is in `infra/`, where both can reach it without reaching through each other.
 *
 * @module adapters/publisher/paths
 */

import { join } from 'node:path';

import { assertSafeSegment } from '../../infra/path-segment.mjs';

/**
 * @param {string} root The `data` checkout root.
 * @returns {any}
 */
export function dataPaths(root) {
  return {
    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @returns {string}
     */
    listingDir: (clientSlug, listingKey) =>
      join(
        root,
        assertSafeSegment(clientSlug, 'client slug'),
        assertSafeSegment(listingKey, 'listing key'),
      ),

    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @param {string} artifact
     * @returns {string}
     */
    artifact: (clientSlug, listingKey, artifact) =>
      join(
        root,
        assertSafeSegment(clientSlug, 'client slug'),
        assertSafeSegment(listingKey, 'listing key'),
        `${assertSafeSegment(artifact, 'artifact name')}.json`,
      ),
  };
}
