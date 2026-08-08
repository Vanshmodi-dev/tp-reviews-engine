/**
 * Path-segment validation — a security control, shared by every adapter that
 * builds a path.
 *
 * ## Why this is infrastructure rather than part of one adapter
 *
 * It started inside the state adapter, and DR-3 caught it: the publisher needed
 * it too, and an adapter importing another adapter is how two adapters quietly
 * become one. The rule was right. A traversal guard is not knowledge about
 * ledgers or payloads — it knows nothing about what a review is — so it belongs
 * here, where both can reach it without reaching through each other.
 *
 * ## Why a rejected segment throws rather than being sanitised
 *
 * Client slugs come from configuration, configuration comes from a pull
 * request, and `../../` in a slug would let one client's config write into
 * another client's directory — or outside the checkout entirely.
 *
 * Silently rewriting `../../etc` into `etc` produces a path that works and is
 * not the one anybody asked for. The write would succeed, in the wrong place,
 * and nothing would report it. Throwing makes the misconfiguration visible at
 * the moment it is introduced.
 *
 * @module infra/path-segment
 */

/**
 * A path segment must be a lowercase slug.
 *
 * Deliberately narrower than what a filesystem accepts. Every segment in this
 * system is generated from a configuration key a human wrote, and the set of
 * characters useful there is much smaller than the set that is legal.
 */
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/**
 * Rejects anything that is not a safe path segment.
 *
 * @param {string} segment
 * @param {string} label  What the segment is, so the error names it.
 * @returns {string} The segment, unchanged.
 */
export function assertSafeSegment(segment, label) {
  if (typeof segment !== 'string' || !SAFE_SEGMENT.test(segment) || segment.includes('..')) {
    throw new Error(`unsafe ${label} for a path: ${JSON.stringify(segment)}`);
  }

  return segment;
}
