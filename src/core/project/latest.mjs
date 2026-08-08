/**
 * The `latest` artifact — the top-N slice (T-118).
 *
 * ## It slices, and recomputes nothing
 *
 * `latest.json` exists so the common widget case fetches ~7 KB instead of
 * ~37 KB. It is the **head of the same ordered payload**, and its stats block is
 * the **same stats block**, copied.
 *
 * Recomputing aggregates over the slice is the obvious mistake and it produces a
 * specific, embarrassing failure: a client's badge would read "4.9 stars from 20
 * reviews" because the twenty newest happen to be the good ones, while the full
 * payload on the same page says 4.2 from 180. The number a visitor sees would
 * depend on which file the widget happened to load.
 *
 * So `stats` here describes the whole listing, and `reviews` is a window onto
 * it. That is why the artifact also carries `total_count` in its stats while
 * holding fewer reviews than that — the difference is the point, not a defect.
 *
 * @module core/project/latest
 */

import { resolveDisplay } from './filters.mjs';

/**
 * Builds the `latest` artifact from an already-projected `reviews` payload.
 *
 * Takes the finished payload rather than the ledger, deliberately: deriving it
 * from the same object guarantees the two artifacts agree, where projecting
 * twice from the ledger would let them drift if a filter were applied in one
 * path and not the other.
 *
 * @param {Record<string, any>} payload The `reviews` artifact.
 * @param {any} [display]
 * @returns {Record<string, any>}
 */
export function projectLatest(payload, display) {
  const { latest_count: latestCount } = resolveDisplay(display);

  return {
    ...payload,
    artifact: 'latest',
    reviews: payload.reviews.slice(0, latestCount),
    // Untouched, and that is the whole design. See the module header.
    stats: payload.stats,
  };
}

/**
 * The `stats` artifact: the envelope with no reviews at all.
 *
 * `reviews` is absent rather than empty. An empty array says "we published
 * nothing"; absence says "this artifact is not about individual reviews", and a
 * consumer rendering a badge from an empty array would show a zero state for a
 * listing that has 180 reviews.
 *
 * @param {Record<string, any>} payload The `reviews` artifact.
 * @returns {Record<string, any>}
 */
export function projectStatsArtifact(payload) {
  /** @type {Record<string, any>} */
  const artifact = { ...payload, artifact: 'stats' };
  delete artifact.reviews;
  delete artifact.pagination;

  return artifact;
}
