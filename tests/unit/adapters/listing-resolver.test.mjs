/**
 * C-08 · Listing Resolver (SAD §17.7, TRD §2.8).
 *
 * The failure this component exists to prevent has no downstream detector. If
 * the resolver lands on the wrong listing, the page loads, the selectors match,
 * the reviews extract cleanly, the reconciler records them as new, and the gate
 * sees a count that went up. Every check in the system reports success while
 * the payload fills with another business's reviews.
 *
 * So the tests here are weighted towards refusal: what makes it stop, and what
 * makes it stop rather than guess.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_TTL_DAYS,
  cacheIsFresh,
  parseListingUrl,
  planResolution,
  searchAllowed,
} from '../../../src/adapters/acquisition/google-dom/listing-identity.mjs';
import {
  chooseCandidate,
  normaliseName,
  similarity,
  verifyIdentity,
} from '../../../src/adapters/acquisition/google-dom/name-match.mjs';
import { createListingResolver } from '../../../src/adapters/acquisition/google-dom/resolver.mjs';

const NOW = Date.parse('2026-08-13T00:00:00.000Z');
const DAY = 86_400_000;

describe('TR-APP-021 — normalisation strips decoration, not identity', () => {
  it.each([
    ['Acme Dental Ltd', 'acme dental'],
    ['Acme Dental Limited', 'acme dental'],
    ['ACME  DENTAL', 'acme dental'],
    ['Acme-Dental', 'acme dental'],
    ['Café Rouge', 'cafe rouge'],
    ['Smith & Sons', 'smith and sons'],
    ['Smith + Sons', 'smith and sons'],
    ['Müller GmbH', 'muller'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseName(raw)).toBe(expected);
  });

  it('treats the Ltd/Limited rebrand as no change at all', () => {
    // A filing, not a change of premises. Alerting on this is the false
    // positive that gets the whole check disabled.
    expect(similarity('Acme Dental Ltd', 'Acme Dental Limited')).toBe(1);
  });

  it('does not strip a suffix word that is part of the name', () => {
    // "Co" is a suffix at the end and a word at the start. Stripping from both
    // ends would turn "Co Operative Stores" into "operative stores".
    expect(normaliseName('Co Operative Stores')).toBe('co operative stores');
  });

  it('never reduces a name to nothing', () => {
    // A business genuinely called "Limited" would otherwise normalise to the
    // empty string and match everything.
    expect(normaliseName('Limited')).toBe('limited');
  });

  it('tolerates the locality the platform appends and the config omits', () => {
    expect(similarity('Commerce Insight', 'Commerce Insight Manchester')).toBe(1);
  });

  it('still separates two genuinely different businesses', () => {
    expect(similarity('Acme Dental', 'Bright Smile Orthodontics')).toBeLessThan(0.5);
  });
});

describe('TR-APP-020 — identity is verified on every run', () => {
  it('accepts a match at the default threshold', () => {
    const verdict = verifyIdentity({
      observedName: 'Commerce Insight Ltd',
      expectedName: 'Commerce Insight',
    });

    expect(verdict.ok).toBe(true);
  });

  it('refuses a renamed or merged listing, and says why', () => {
    const verdict = verifyIdentity({
      observedName: 'Northern Facilities Group',
      expectedName: 'Commerce Insight',
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('ERR-IDENTITY-DRIFT');
    // The message has to be actionable at 2 a.m. by someone who did not write
    // the config.
    expect(verdict.detail).toContain('Northern Facilities Group');
    expect(verdict.detail).toContain('Commerce Insight');
  });

  it('FAILS CLOSED when no expected name is configured', () => {
    // The naive alternative — "nothing to compare against, so pass" — disables
    // the check for precisely the client whose config was written carelessly.
    const verdict = verifyIdentity({ observedName: 'Anything At All', expectedName: '' });

    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('ERR-IDENTITY-DRIFT');
  });

  it('honours a per-client threshold', () => {
    const strict = verifyIdentity({
      observedName: 'Commerce Insight Manchester Branch',
      expectedName: 'Commerce Insight',
      threshold: 1.01,
    });

    expect(strict.ok).toBe(false);
  });
});

describe('TR-APP-022 / FR-014 — the resolver never guesses', () => {
  const candidates = [
    { name: 'Acme Dental Didsbury', id: 'A' },
    { name: 'Acme Dental Chorlton', id: 'B' },
  ];

  it('REFUSES when two candidates match, rather than taking the best score', () => {
    const chosen = chooseCandidate(candidates, { expectedName: 'Acme Dental' });

    // Both branches of a chain score identically. Picking one is a coin flip,
    // and the wrong branch harvests successfully from the wrong premises.
    expect(chosen.ok).toBe(false);
    expect(chosen.code).toBe('ERR-RESOLVE-AMBIGUOUS');
    expect(chosen.detail).toContain('place_id');
  });

  it('accepts a single match', () => {
    const chosen = chooseCandidate([{ name: 'Acme Dental Didsbury', id: 'A' }], {
      expectedName: 'Acme Dental Didsbury',
    });

    expect(chosen.ok).toBe(true);
    expect(chosen.chosen.id).toBe('A');
  });

  it('reports not-found when nothing clears the threshold', () => {
    const chosen = chooseCandidate(candidates, { expectedName: 'Completely Different Business' });

    expect(chosen.code).toBe('ERR-RESOLVE-NOTFOUND');
  });

  it('reports not-found for an empty candidate list rather than throwing', () => {
    expect(chooseCandidate([], { expectedName: 'Acme' }).code).toBe('ERR-RESOLVE-NOTFOUND');
  });
});

describe('URL parsing', () => {
  it.each([
    ['https://www.google.com/maps/place/?q=place_id:X&place_id=ChIJabcdefghij', 'place_id'],
    ['https://maps.google.co.uk/?cid=12345678901234', 'cid'],
    ['https://www.google.com/maps/place/Acme/data=!3m1!4b1!4m5!1s0x487b:0x1f4', 'cid'],
  ])('extracts an identifier from %s', (url, kind) => {
    expect(parseListingUrl(url)?.kind).toBe(kind);
  });

  it('converts the hex CID in a data segment to decimal', () => {
    const parsed = parseListingUrl(
      'https://www.google.com/maps/place/Acme/data=!4m5!1s0x487b:0x1f4',
    );

    expect(parsed?.value).toBe('500');
  });

  it('REFUSES a non-Google host', () => {
    // A mistyped config must not send the browser somewhere unrelated.
    expect(parseListingUrl('https://evil.example/maps?cid=123456789')).toBeNull();
  });

  it('refuses a host that merely contains google', () => {
    expect(parseListingUrl('https://google.evil.test/?cid=123456789')).toBeNull();
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(parseListingUrl('not a url')).toBeNull();
    expect(parseListingUrl('')).toBeNull();
    expect(parseListingUrl(/** @type {any} */ (undefined))).toBeNull();
  });
});

describe('the cache', () => {
  it(`trusts an identity younger than ${CACHE_TTL_DAYS} days`, () => {
    expect(cacheIsFresh({ verifiedAt: new Date(NOW - 5 * DAY).toISOString() }, NOW)).toBe(true);
  });

  it('expires one older than the TTL', () => {
    expect(
      cacheIsFresh({ verifiedAt: new Date(NOW - (CACHE_TTL_DAYS + 1) * DAY).toISOString() }, NOW),
    ).toBe(false);
  });

  it('treats an unparseable timestamp as stale, not as fresh', () => {
    expect(cacheIsFresh({ verifiedAt: 'sometime last week' }, NOW)).toBe(false);
    expect(cacheIsFresh({}, NOW)).toBe(false);
    expect(cacheIsFresh(null, NOW)).toBe(false);
  });
});

describe('TR-APP-023 — search is off in production', () => {
  it('defaults to false under TPRE_ENV=production', () => {
    expect(searchAllowed({}, 'production')).toBe(false);
  });

  it('defaults to true elsewhere', () => {
    expect(searchAllowed({}, 'development')).toBe(true);
    expect(searchAllowed({}, undefined)).toBe(true);
  });

  it('lets an explicit setting win in both directions', () => {
    expect(searchAllowed({ allow_search: true }, 'production')).toBe(true);
    expect(searchAllowed({ allow_search: false }, 'development')).toBe(false);
  });
});

describe('resolution precedence (TRD §2.8)', () => {
  const fresh = { canonicalId: 'ChIJcached', verifiedAt: new Date(NOW - DAY).toISOString() };

  it('prefers an explicit place_id over everything', () => {
    const plan = planResolution({
      identity: {
        place_id: 'ChIJexplicit',
        cid: '123456789',
        url: 'https://google.com/?cid=999999',
      },
      cached: fresh,
      now: NOW,
    });

    expect(plan.via).toBe('explicit_place_id');
    expect(plan.value).toBe('ChIJexplicit');
  });

  it('prefers an explicit cid over a cached identity', () => {
    const plan = planResolution({ identity: { cid: '123456789' }, cached: fresh, now: NOW });

    expect(plan.via).toBe('explicit_cid');
  });

  it('ranks the cache BELOW explicit configuration', () => {
    // So that adding a place_id to a config takes effect on the next run rather
    // than in up to thirty days' time.
    expect(planResolution({ identity: {}, cached: fresh, now: NOW }).via).toBe('cache');
  });

  it('falls to URL parsing when the cache is stale', () => {
    const plan = planResolution({
      identity: { url: 'https://www.google.com/maps?place_id=ChIJfromurl' },
      cached: { verifiedAt: new Date(NOW - 90 * DAY).toISOString() },
      now: NOW,
    });

    expect(plan.via).toBe('url');
  });

  it('falls to search last, and warns every single time', () => {
    const plan = planResolution({
      identity: { search: { name: 'Acme', locality: 'Manchester' } },
      now: NOW,
      env: 'development',
    });

    expect(plan.via).toBe('search');
    // Not "once per run" and not at debug level. The irritation is the point:
    // the intended response is to set a place_id and make it stop.
    expect(plan.warn).toContain('not stable');
  });

  it('refuses a search-only listing in production', () => {
    const plan = planResolution({
      identity: { search: { name: 'Acme' } },
      now: NOW,
      env: 'production',
    });

    expect(plan.via).toBe('none');
    expect(plan.code).toBe('ERR-RESOLVE-NO-IDENTIFIER');
  });

  it('refuses a listing with no identity at all', () => {
    expect(planResolution({ identity: {}, now: NOW }).code).toBe('ERR-RESOLVE-NO-IDENTIFIER');
  });

  it('ignores a place_id that is not shaped like one', () => {
    // A config with `place_id: "Acme Dental"` must not become a request.
    const plan = planResolution({ identity: { place_id: 'Acme Dental!' }, now: NOW });

    expect(plan.via).toBe('none');
  });
});

describe('the resolver end to end', () => {
  /** @param {any} over */
  const build = (over = {}) => {
    const written = new Map();
    const openListing =
      over.openListing ??
      vi.fn(async () => ({
        canonicalId: 'ChIJresolved',
        canonicalUrl: 'https://maps.google.com/?cid=1',
        displayName: 'Commerce Insight Ltd',
        advertisedTotal: 118,
        advertisedRating: 4.6,
      }));

    const resolver = createListingResolver({
      openListing,
      now: () => NOW,
      cache: {
        read: async (/** @type {string} */ key) => over.cached?.[key] ?? null,
        write: async (/** @type {string} */ key, /** @type {any} */ value) => {
          written.set(key, value);
        },
      },
      ...over.deps,
    });

    return { resolver, written, openListing };
  };

  const input = {
    clientSlug: 'commerce-insight',
    listing: { key: 'main', identity: { place_id: 'ChIJexplicit' } },
    config: { resolution: { expected_name: 'Commerce Insight' } },
  };

  it('resolves, verifies, and returns the advertised aggregates', async () => {
    const { resolver } = build();
    const result = await resolver.resolve(input);

    expect(result.ok).toBe(true);
    expect(result.value.canonicalId).toBe('ChIJresolved');
    // The advertised totals are what G-08 compares coverage against. A resolver
    // that dropped them would make coverage permanently unmeasurable.
    expect(result.value.advertisedTotal).toBe(118);
    expect(result.value.advertisedRating).toBe(4.6);
    expect(result.value.resolvedVia).toBe('explicit_place_id');
    expect(result.value.verifiedAt).toBe('2026-08-13T00:00:00.000Z');
  });

  it('caches the verified identity', async () => {
    const { resolver, written } = build();

    await resolver.resolve(input);

    expect(written.get('resolver/commerce-insight/main').canonicalId).toBe('ChIJresolved');
  });

  it('ABORTS on drift, and does not clear the cache', async () => {
    const { resolver, written } = build({
      openListing: async () => ({
        canonicalId: 'ChIJresolved',
        displayName: 'Northern Facilities Group',
      }),
    });

    const result = await resolver.resolve(input);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-IDENTITY-DRIFT');
    // Clearing it would turn "stop and ask a human" into "re-resolve by search
    // next run", which is how the wrong business gets adopted quietly.
    expect(written.size).toBe(0);
  });

  it('verifies even when the identity came from cache', async () => {
    // The check that makes a merged listing detectable. A cached identifier
    // still loads a page, and the business behind it can change.
    const { resolver } = build({
      cached: {
        'resolver/commerce-insight/main': {
          canonicalId: 'ChIJcached',
          verifiedAt: new Date(NOW - DAY).toISOString(),
        },
      },
      openListing: async () => ({
        canonicalId: 'ChIJcached',
        displayName: 'Someone Else Entirely',
      }),
    });

    const result = await resolver.resolve({
      ...input,
      listing: { key: 'main', identity: {} },
    });

    expect(result.error.code).toBe('ERR-IDENTITY-DRIFT');
  });

  it('reports not-found when the page does not open', async () => {
    const { resolver } = build({ openListing: async () => null });

    expect((await resolver.resolve(input)).error.code).toBe('ERR-RESOLVE-NOTFOUND');
  });

  it('refuses when search is planned but no search capability was wired', async () => {
    const { resolver } = build();
    const result = await resolver.resolve({
      ...input,
      listing: { key: 'main', identity: { search: { name: 'Acme' } } },
      config: { resolution: { expected_name: 'Acme', allow_search: true } },
    });

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('search');
  });

  it('refuses an ambiguous search rather than picking one', async () => {
    const { resolver } = build({
      deps: {
        search: async () => [
          { name: 'Acme Dental Didsbury', id: 'A' },
          { name: 'Acme Dental Chorlton', id: 'B' },
        ],
      },
    });

    const result = await resolver.resolve({
      ...input,
      listing: { key: 'main', identity: { search: 'Acme Dental' } },
      config: { resolution: { expected_name: 'Acme Dental', allow_search: true } },
    });

    expect(result.error.code).toBe('ERR-RESOLVE-AMBIGUOUS');
  });

  it('works with no cache wired at all', async () => {
    const resolver = createListingResolver({
      openListing: async () => ({ canonicalId: 'ChIJx', displayName: 'Commerce Insight' }),
      now: () => NOW,
    });

    expect((await resolver.resolve(input)).ok).toBe(true);
  });
});
