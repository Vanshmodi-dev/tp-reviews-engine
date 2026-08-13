/**
 * Which identifier to resolve, and how (TRD §2.8 precedence).
 *
 * Pure. Given what the operator configured and what the cache holds, this
 * decides the ONE route to take — and, crucially, whether search is permitted
 * at all.
 *
 * ## The precedence exists to keep search last
 *
 * Every route above search is deterministic: the same config resolves to the
 * same listing forever. Search is not — it depends on what the platform's
 * ranking does today, and it can silently start returning a different business
 * without anything in the repository changing.
 *
 * So search is the last resort, it emits a warning **every time** (not once,
 * not at debug level), and TR-APP-023 disables it outright in production. A
 * warning that fires on every run is annoying by design: the intended response
 * is to put an explicit `place_id` in the config and make it stop.
 *
 * @module adapters/acquisition/google-dom/listing-identity
 */

/** How long a resolved identity is trusted before re-resolution (SAD §17.7). */
export const CACHE_TTL_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Radix for the hex→decimal CID conversion. */
const DECIMAL = 10;

/**
 * A Google Place ID. Opaque, but recognisably prefixed and base64-ish.
 *
 * Matched rather than merely checked for presence, so a `place_id` field
 * holding a URL or a business name is rejected here instead of producing an
 * unresolvable request later.
 */
const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/u;

/** A CID is a decimal 64-bit integer. */
const CID = /^\d{5,25}$/u;

/**
 * Registrable domains a listing URL may legitimately use.
 *
 * An explicit list, not a pattern. The obvious pattern —
 * `/(^|\.)google\.[a-z.]+$/` — accepts `google.evil.test`, because `google.`
 * appears at the start and the rest matches the tail. That is the same defect
 * `adapters/browser/interception.mjs` documents for its host allowlist, and it
 * is worth making the same mistake only once: an attacker-controlled host that
 * merely CONTAINS an allowlisted name is the whole trick.
 *
 * An unlisted Google ccTLD falls through to "no identifier from this URL",
 * which is fail-closed — the precedence moves on and, if nothing else resolves,
 * the operator gets `ERR-RESOLVE-NO-IDENTIFIER` naming the problem.
 */
const GOOGLE_DOMAINS = Object.freeze([
  'google.com',
  'google.co.uk',
  'google.ie',
  'google.ca',
  'google.com.au',
  'google.de',
  'google.fr',
  'google.es',
  'google.it',
  'google.nl',
  'google.pl',
  'google.pt',
  'goo.gl',
]);

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isGoogleHost(hostname) {
  const host = hostname.toLowerCase();

  return GOOGLE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Extracts an identifier from a Maps URL.
 *
 * Handles the three shapes that actually appear in the wild: a `place_id`
 * query parameter, a `!1s0x…:0x…` data segment, and a `cid=` parameter.
 *
 * @param {string} raw
 * @returns {{ kind: 'place_id' | 'cid', value: string } | null}
 */
export function parseListingUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  /** @type {URL} */
  let url;

  try {
    url = new URL(raw);
  } catch {
    // A malformed URL is a config error, but it is not this function's job to
    // say so — returning null lets the precedence fall through to the next
    // route, and the caller reports the absence of any identifier.
    return null;
  }

  // Not a Google host: refusing here keeps a mistyped — or hostile — config
  // from sending the browser somewhere unrelated.
  if (!isGoogleHost(url.hostname)) return null;

  const placeId = url.searchParams.get('place_id');

  if (placeId !== null && PLACE_ID.test(placeId)) return { kind: 'place_id', value: placeId };

  const cid = url.searchParams.get('cid');

  if (cid !== null && CID.test(cid)) return { kind: 'cid', value: cid };

  // `!1s0x47…:0xabc…` — the hex pair in a /data= segment. The second half is
  // the CID in hex.
  const data = /!1s0x[0-9a-f]+:0x([0-9a-f]+)/u.exec(url.pathname + url.search);

  if (data !== null) return { kind: 'cid', value: BigInt(`0x${data[1]}`).toString(DECIMAL) };

  return null;
}

/**
 * Whether a cached identity may still be used.
 *
 * @param {any} cached
 * @param {number} now  Epoch ms.
 * @returns {boolean}
 */
export function cacheIsFresh(cached, now) {
  if (cached === null || cached === undefined) return false;

  const verifiedAt = Date.parse(cached.verifiedAt ?? '');

  if (Number.isNaN(verifiedAt)) return false;

  return now - verifiedAt < CACHE_TTL_DAYS * MS_PER_DAY;
}

/**
 * Whether search may be used (TR-APP-023).
 *
 * Defaults to `false` under `TPRE_ENV=production` and `true` otherwise, and an
 * explicit setting always wins. The default flips on environment rather than
 * being a single value because search is a genuinely useful development
 * convenience and a genuinely bad production dependency.
 *
 * @param {any} resolution
 * @param {string | undefined} env
 * @returns {boolean}
 */
export function searchAllowed(resolution, env) {
  const explicit = resolution?.allow_search;

  if (typeof explicit === 'boolean') return explicit;

  return env !== 'production';
}

/**
 * Chooses the resolution route (TRD §2.8).
 *
 * @param {{ identity?: any, resolution?: any, cached?: any, now: number, env?: string }} input
 * @returns {{ via: string, kind?: string, value?: string, cached?: any, warn?: string, code?: string, detail?: string }}
 */
export function planResolution(input) {
  for (const route of ROUTES) {
    const plan = route(input);

    if (plan !== null) return plan;
  }

  return {
    via: 'none',
    code: 'ERR-RESOLVE-NO-IDENTIFIER',
    detail: 'the listing has no place_id, cid, url, or search tuple. There is nothing to resolve.',
  };
}

/** 1. An explicit canonical identifier. Deterministic and free. @param {any} input */
function routeExplicitPlaceId({ identity = {} }) {
  return typeof identity.place_id === 'string' && PLACE_ID.test(identity.place_id)
    ? { via: 'explicit_place_id', kind: 'place_id', value: identity.place_id }
    : null;
}

/** 2. An explicit numeric id. @param {any} input */
function routeExplicitCid({ identity = {} }) {
  return identity.cid !== undefined && CID.test(String(identity.cid))
    ? { via: 'explicit_cid', kind: 'cid', value: String(identity.cid) }
    : null;
}

/**
 * 3. A cached identity inside its TTL.
 *
 * Ranked BELOW explicit configuration so that adding a `place_id` to a config
 * takes effect on the next run rather than in up to thirty days' time.
 *
 * @param {any} input
 */
function routeCache({ cached, now }) {
  return cacheIsFresh(cached, now)
    ? { via: 'cache', kind: 'place_id', value: cached.canonicalId, cached }
    : null;
}

/** 4. An identifier parsed out of a URL. @param {any} input */
function routeUrl({ identity = {} }) {
  const fromUrl = parseListingUrl(identity.url);

  return fromUrl === null ? null : { via: 'url', kind: fromUrl.kind, value: fromUrl.value };
}

/** 5. Search. Last resort, loud every time. @param {any} input */
function routeSearch({ identity = {}, resolution = {}, env }) {
  const tuple = identity.search ?? identity.query;

  if (tuple === undefined || tuple === null) return null;

  if (!searchAllowed(resolution, env)) {
    return {
      via: 'none',
      code: 'ERR-RESOLVE-NO-IDENTIFIER',
      detail:
        'only a search tuple was supplied and resolution.allow_search is false ' +
        '(TR-APP-023 defaults it off in production). Put an explicit place_id in the ' +
        'client config — a search result is not a stable identity.',
    };
  }

  return {
    via: 'search',
    kind: 'search',
    value: typeof tuple === 'string' ? tuple : JSON.stringify(tuple),
    warn:
      'resolving by search. The result is not stable across runs and may silently ' +
      'change which business is harvested. Set an explicit place_id to stop this warning.',
  };
}

/**
 * The precedence, in order (TRD §2.8).
 *
 * A list rather than a chain of early returns, so that "what is the order" is
 * answered by reading five names. The order IS the specification here, and it
 * is the thing most likely to be rearranged by someone who has not read §2.8.
 */
const ROUTES = Object.freeze([
  routeExplicitPlaceId,
  routeExplicitCid,
  routeCache,
  routeUrl,
  routeSearch,
]);
