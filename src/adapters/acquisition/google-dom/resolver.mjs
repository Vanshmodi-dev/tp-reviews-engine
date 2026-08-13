/**
 * C-08 · Listing Resolver (SAD §17.7, TRD §2.8).
 *
 * Turns whatever identity the operator supplied into a canonical, verified,
 * cached listing identity plus the advertised aggregates.
 *
 * ## This is stage 1, and it was missing
 *
 * PH-16's title names four deliverables — "resolver, consent, challenge,
 * serialise" — and three of them shipped. Its absence is why
 * `composition.mjs` has been wiring `notImplemented` into `runStages` since
 * PH-17, why the harvest could not complete end to end, and why `canary.yml`
 * exits `ERR-PIPELINE-INCOMPLETE`. Everything downstream of it was built and
 * tested against a stage that did not exist.
 *
 * ## The division of labour
 *
 * This file is impure: it drives a page and reads a cache. Every DECISION it
 * makes lives in two pure siblings —
 *
 *   - `listing-identity.mjs` — which route to take, and whether search is
 *     permitted at all
 *   - `name-match.mjs` — whether the page we landed on is the right business
 *
 * — which are unit-tested exhaustively on every run. What remains here is
 * sequencing and I/O, the same split as `navigator.mjs` and its pure siblings.
 *
 * ## Verification runs every time (TR-APP-020)
 *
 * Not only when re-resolving. A cached identifier still loads a page, and the
 * business behind it can be renamed, merged, or repointed between runs. The
 * check costs one string comparison against a name already on the page; the
 * failure it catches is a payload full of another business's reviews, which
 * nothing downstream can detect.
 *
 * @module adapters/acquisition/google-dom/resolver
 */

import { planResolution } from './listing-identity.mjs';
import { chooseCandidate, verifyIdentity } from './name-match.mjs';

/** Where a resolved identity is cached on the `state` branch. */
const CACHE_NAMESPACE = 'resolver';

/**
 * @param {string} code
 * @param {string} message
 * @returns {any}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Builds the resolver.
 *
 * @param {object} deps
 * @param {(id: {kind: string, value: string}) => Promise<any>} deps.openListing
 *   Navigates to the listing and returns `{ canonicalId, canonicalUrl,
 *   displayName, advertisedTotal, advertisedRating }` as read from the page.
 * @param {(query: string) => Promise<Array<{ name: string, id: string }>>} [deps.search]
 * @param {{ read: (key: string) => Promise<any>, write: (key: string, value: any) => Promise<void> }} [deps.cache]
 * @param {() => number} [deps.now]
 * @param {{ warn: (message: string, fields?: any) => void, info: (message: string, fields?: any) => void }} [deps.logger]
 * @param {string} [deps.env]
 * @returns {any}
 */
export function createListingResolver(deps) {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger ?? { warn: () => {}, info: () => {} };

  return {
    /**
     * @param {{ listing: any, config: any, clientSlug: string }} input
     * @returns {Promise<any>}
     */
    async resolve({ listing, config, clientSlug }) {
      const resolution = config?.resolution ?? {};
      const cacheKey = `${CACHE_NAMESPACE}/${clientSlug}/${listing?.key ?? 'main'}`;
      const plan = await choose({ listing, resolution, cacheKey, deps, now });

      if (plan.via === 'none') {
        return failure(plan.code ?? 'ERR-RESOLVE-NO-IDENTIFIER', plan.detail ?? 'unresolvable');
      }

      // Every time, at warn level. See listing-identity.mjs — this is meant to
      // be irritating enough to prompt an explicit place_id.
      if (plan.warn !== undefined) logger.warn(plan.warn, { client: clientSlug, via: plan.via });

      const located = await locate(plan, deps, resolution);

      if (located.ok === false) return located;

      return verifyAndCache({
        page: located.value,
        plan,
        resolution,
        listing,
        cacheKey,
        deps,
        now,
      });
    },
  };
}

/**
 * Reads the cache and picks the resolution route.
 *
 * @param {any} input
 * @returns {Promise<any>}
 */
async function choose({ listing, resolution, cacheKey, deps, now }) {
  const cached = (await deps.cache?.read(cacheKey)) ?? null;

  return planResolution({
    identity: listing?.identity ?? {},
    resolution,
    cached,
    now: now(),
    // Spread rather than assigned: under `exactOptionalPropertyTypes`,
    // `env: undefined` is a different thing from an absent `env`, and only the
    // latter means "fall back to the environment default".
    ...(deps.env === undefined ? {} : { env: deps.env }),
  });
}

/**
 * Verifies the page is the right business, then caches the identity.
 *
 * @param {any} input
 * @returns {Promise<any>}
 */
async function verifyAndCache({ page, plan, resolution, listing, cacheKey, deps, now }) {
  const verdict = verifyIdentity({
    observedName: page.displayName,
    expectedName: resolution.expected_name ?? listing?.identity?.expected_name,
    threshold: resolution.identity_threshold,
  });

  if (!verdict.ok) {
    // The cache is NOT cleared here. A drift verdict means we do not know which
    // listing is correct, and discarding the last known good identity would
    // turn "stop and ask a human" into "re-resolve by search next run", which
    // is how the wrong business gets adopted silently.
    return failure(/** @type {string} */ (verdict.code), verdict.detail);
  }

  const resolved = {
    canonicalId: page.canonicalId,
    canonicalUrl: page.canonicalUrl,
    displayName: page.displayName,
    advertisedTotal: numberOrNull(page.advertisedTotal),
    advertisedRating: numberOrNull(page.advertisedRating),
    resolvedVia: plan.via,
    verifiedAt: new Date(now()).toISOString(),
  };

  // Re-verified every run, re-resolved only on TTL expiry — so the cache is
  // refreshed on every successful verification, which is what keeps a stable
  // listing from ever needing a search.
  await deps.cache?.write(cacheKey, resolved);

  return { ok: true, value: resolved };
}

/**
 * Turns a plan into a page, by identifier or by search.
 *
 * @param {any} plan
 * @param {any} deps
 * @param {any} resolution
 * @returns {Promise<any>}
 */
async function locate(plan, deps, resolution) {
  if (plan.kind !== 'search') {
    const page = await deps.openListing({ kind: plan.kind, value: plan.value });

    return page === null || page === undefined
      ? failure('ERR-RESOLVE-NOTFOUND', `no listing at ${plan.kind} "${plan.value}"`)
      : { ok: true, value: page };
  }

  if (typeof deps.search !== 'function') {
    return failure(
      'ERR-RESOLVE-NO-IDENTIFIER',
      'search was selected but no search capability was wired into the resolver',
    );
  }

  const candidates = await deps.search(plan.value);
  const chosen = chooseCandidate(candidates ?? [], {
    expectedName: resolution.expected_name,
    threshold: resolution.identity_threshold,
  });

  if (!chosen.ok) return failure(/** @type {string} */ (chosen.code), chosen.detail);

  const page = await deps.openListing({ kind: 'place_id', value: chosen.chosen.id });

  return page === null || page === undefined
    ? failure('ERR-RESOLVE-NOTFOUND', `the chosen candidate did not open`)
    : { ok: true, value: page };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
