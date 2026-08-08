/**
 * Path templates for the `state` branch (T-146, LEDG-08, TR-STD-110).
 *
 * ## Every path in the system is assembled here and nowhere else
 *
 * The acceptance criterion is a code search for string concatenation of paths
 * at a call site, finding none. That is stricter than it sounds and worth the
 * strictness:
 *
 * - **Path disjointness is the concurrency control (EDR-035).** Shards run in
 *   parallel with no locking, and the only thing making that safe is that two
 *   shards never write the same path. That property is provable when paths come
 *   from one table and unprovable when they are built from template literals
 *   scattered across a dozen modules.
 * - **A slug reaching a path is a traversal vector.** Client slugs come from
 *   config, config comes from a pull request, and `../../` in a slug would let
 *   one client's config write into another client's directory — or outside the
 *   checkout entirely.
 *
 * So segments are validated here, once, and a rejected segment throws rather
 * than being sanitised. Silently rewriting `../../etc` into `etc` produces a
 * path that works and is not the one anybody asked for.
 *
 * @module adapters/state/paths
 */

import { join } from 'node:path';

import { assertSafeSegment } from '../../infra/path-segment.mjs';

/**
 * The `state` branch layout.
 *
 * ```
 * ledgers/<client>/<listing>.json     one ledger per listing
 * cache/<client>/identity.json        identity cache, TTL-bounded
 * budget/<source>.json                rate counters, per source
 * breakers/<source>_<access>.json     circuit state, per source-access pair
 * health/<client>/<listing>.jsonl     append-only, one record per run
 * ```
 *
 * @param {string} root The `state` checkout root.
 * @returns {any}
 */
export function statePaths(root) {
  return {
    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @returns {string}
     */
    ledger: (clientSlug, listingKey) =>
      join(
        root,
        'ledgers',
        assertSafeSegment(clientSlug, 'client slug'),
        `${assertSafeSegment(listingKey, 'listing key')}.json`,
      ),

    /**
     * @param {string} clientSlug
     * @returns {string}
     */
    identityCache: (clientSlug) =>
      join(root, 'cache', assertSafeSegment(clientSlug, 'client slug'), 'identity.json'),

    /**
     * @param {string} source
     * @returns {string}
     */
    budget: (source) => join(root, 'budget', `${assertSafeSegment(source, 'source')}.json`),

    /**
     * Breakers are keyed by source AND access method, joined with an
     * underscore rather than a separator — the pair is one key, not a
     * hierarchy, and a nested directory would imply otherwise.
     *
     * @param {string} source
     * @param {string} access
     * @returns {string}
     */
    breaker: (source, access) =>
      join(
        root,
        'breakers',
        `${assertSafeSegment(source, 'source')}_${assertSafeSegment(access, 'access method')}.json`,
      ),

    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @returns {string}
     */
    health: (clientSlug, listingKey) =>
      join(
        root,
        'health',
        assertSafeSegment(clientSlug, 'client slug'),
        `${assertSafeSegment(listingKey, 'listing key')}.jsonl`,
      ),
  };
}
