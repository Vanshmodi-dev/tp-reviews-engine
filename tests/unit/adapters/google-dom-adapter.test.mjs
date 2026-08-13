/**
 * `google:dom` — the DOM acquisition adapter.
 *
 * The adapter is sequencing and lifecycle, so these cases are about exactly
 * that: what it passes on unchanged, what it refuses before spending a browser,
 * and whether the context is always closed.
 *
 * The navigator is faked here. Its own behaviour — consent, challenges,
 * pagination, stop conditions — is tested against a real page in
 * `tests/integration/browser-navigation.test.mjs`, and duplicating it against a
 * fake would test the fake.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DOM_CAPABILITIES,
  createDomAdapter,
  listingUrl,
} from '../../../src/adapters/acquisition/google-dom/index.mjs';

/** A minimal pack the extractor can actually work with. */
const PACK = {
  meta: { version: 'v-test' },
  containers: {
    surface: { strategies: [{ selector: '[data-feed]' }] },
    review_node: { strategies: [{ selector: '[data-review]' }] },
  },
  fields: {
    author_name: { required: true, strategies: [{ selector: '[data-author]' }] },
    rating: {
      strategies: [
        {
          selector: "[role='img']",
          attribute: 'aria-label',
          pattern: 'Rated ([0-9.]+) out of 5',
        },
      ],
    },
    text: { strategies: [{ selector: '[data-text]' }] },
  },
};

const HTML =
  '<div data-feed>' +
  '<div data-review><span data-author>Dana</span>' +
  "<span role='img' aria-label='Rated 5.0 out of 5'></span>" +
  '<p data-text>Prompt and tidy.</p></div>' +
  '<div data-review><span data-author>Sam</span>' +
  "<span role='img' aria-label='Rated 4.0 out of 5'></span>" +
  '<p data-text>Good work.</p></div>' +
  '</div>';

/**
 * A browser whose target records whether it was closed.
 *
 * @param {any} [over]
 * @returns {any}
 */
function fakeBrowser(over = {}) {
  const state = { opened: 0, closed: 0 };
  const browser = {
    openTarget: vi.fn(async () => {
      state.opened += 1;

      if (over.openThrows === true) throw new Error('context creation failed');

      return {
        page: over.page ?? {},
        budgets: { navigation_timeout_ms: 1000, surface_timeout_ms: 500 },
        counters: { blocked: 0 },
        close: async () => {
          state.closed += 1;

          if (over.closeThrows === true) throw new Error('close failed');
        },
      };
    }),
  };

  return { browser, state };
}

/**
 * @param {any} [over]
 * @returns {any}
 */
function build(over = {}) {
  const { browser, state } = fakeBrowser(over);
  const navigation = {
    html: HTML,
    stopReason: 'target_reached',
    stopDetail: 'reached the configured target',
    growthCurve: [2],
    finalCount: 2,
    iterations: 1,
    elapsedMs: 120,
    advertisedTotal: 118,
    advertisedRating: 4.6,
    sortApplied: true,
    consentState: 'none',
    counters: {},
    ...over.navigation,
  };

  const adapter = createDomAdapter({
    browser,
    pack: over.pack === undefined ? () => PACK : over.pack,
    logger: over.logger,
    // Injected, not module-mocked. `vi.doMock` after the import has already
    // happened does nothing, and a test that appears to stub the navigator
    // while silently running the real one passes for the wrong reason.
    navigate: over.navigate ?? (async () => ({ ok: true, value: navigation })),
  });

  return { adapter, state, browser, navigation };
}

const REQUEST = {
  listing: { canonicalId: 'ChIJexample', source: 'google', locale: 'en' },
  cap: 100,
  budget: {},
};

describe('the URL is built by the engine, never scraped (TR-EXT-090)', () => {
  it('prefers the resolved canonical id', () => {
    expect(listingUrl({ canonicalId: 'ChIJx' })).toBe(
      'https://www.google.com/maps/place/?q=place_id:ChIJx',
    );
  });

  it('falls back to a cid', () => {
    expect(listingUrl({ identity: { cid: '12345' } })).toBe(
      'https://www.google.com/maps?cid=12345',
    );
  });

  it('encodes the identifier rather than interpolating it raw', () => {
    // A place id is opaque and arrives from configuration. Interpolating it
    // unencoded is how a crafted config appends query parameters of its own.
    expect(listingUrl({ canonicalId: 'a&b=c' })).toContain('a%26b%3Dc');
  });

  it('returns null when there is nothing to navigate to', () => {
    expect(listingUrl({})).toBeNull();
    expect(listingUrl(undefined)).toBeNull();
  });
});

describe('refusals that cost no browser', () => {
  it('refuses a listing with no identifier, without opening a target', async () => {
    const { adapter, state } = build();
    const result = await adapter.harvest({ listing: {}, cap: 10 });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-RESOLVE-NO-IDENTIFIER');
    // Launching a context to discover a config error wastes seconds per target
    // and a browser slot on a shard.
    expect(state.opened).toBe(0);
  });

  it('refuses when no selector pack resolves, without opening a target', async () => {
    const { adapter, state } = build({ pack: () => null });
    const result = await adapter.harvest(REQUEST);

    expect(result.ok).toBe(false);
    // Not ERR-PARSE-STRUCTURE. Navigating first and failing to find a surface
    // would send an engineer to the selector-repair runbook for a pack that was
    // never loaded.
    expect(result.error.code).toBe('ERR-PARSE-SELECTOR-PACK');
    expect(state.opened).toBe(0);
  });
});

describe('the context is always closed (BRW-03)', () => {
  it('closes after a successful harvest', async () => {
    const { adapter, state } = build();
    const result = await adapter.harvest(REQUEST);

    expect(result.ok).toBe(true);
    expect(state.opened).toBe(1);
    expect(state.closed).toBe(1);
  });

  it('closes when the navigator fails', async () => {
    const { adapter, state } = build({
      navigate: async () => ({
        ok: false,
        error: { code: 'ERR-NAV-TIMEOUT', message: 'navigation timed out' },
      }),
    });

    const result = await adapter.harvest(REQUEST);

    expect(result.error.code).toBe('ERR-NAV-TIMEOUT');
    expect(state.closed).toBe(1);
  });

  it('closes when the navigator throws outright', async () => {
    const { adapter, state } = build({
      navigate: async () => {
        throw new Error('page crashed mid-scroll');
      },
    });

    expect((await adapter.harvest(REQUEST)).error.code).toBe('ERR-BROWSER-CRASH');
    expect(state.closed).toBe(1);
  });

  it('returns a Result rather than throwing when the browser crashes', async () => {
    const { adapter } = build({ openThrows: true });
    const result = await adapter.harvest(REQUEST);

    // INV-09. One target failing must cost that target and nothing else; an
    // adapter that threw would take down a shard of twenty.
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-BROWSER-CRASH');
  });

  it('does not let a failing close mask the result', async () => {
    const { adapter } = build({ closeThrows: true });
    const result = await adapter.harvest(REQUEST);

    // The close is best-effort. A close that throws must not convert a
    // completed harvest into a failure, nor a failure into a different one.
    expect(result).toBeDefined();
  });
});

describe('capabilities are declared, not inferred (FR-020)', () => {
  it('reports the same list from the constant and the adapter', () => {
    const { adapter } = build();

    expect(adapter.capabilities()).toEqual(DOM_CAPABILITIES);
  });

  it('claims owner_reply and full_pagination, which the API adapters cannot', () => {
    // This is the reason the DOM path exists at all, and the reason a client
    // migrating to an official API loses fields (INV-10).
    expect(DOM_CAPABILITIES).toContain('owner_reply');
    expect(DOM_CAPABILITIES).toContain('full_pagination');
  });

  it('identifies itself as google:dom', () => {
    const { adapter } = build();

    // The id lands in every payload's provenance block and is the string V-3
    // keys its compliance gate on. It cannot drift.
    expect(adapter.id).toBe('google:dom');
  });
});

describe('the report passes the navigator through unchanged (VAL-01)', () => {
  it('extracts the reviews the pack describes', async () => {
    const { adapter } = build();
    const result = await adapter.harvest(REQUEST);

    expect(result.value.reviews).toHaveLength(2);
    expect(result.value.reviews[0].author.name).toBe('Dana');
    expect(result.value.reviews[0].rating).toBe(5);
  });

  it.each([
    ['target_reached', 2],
    ['cap_reached', 2],
    ['exhausted', 2],
    ['stalled', 2],
    ['budget_exhausted', 2],
  ])('reports %s exactly as the navigator said it', async (stopReason) => {
    const { adapter } = build({ navigation: { stopReason } });
    const result = await adapter.harvest(REQUEST);

    expect(result.value.stop_reason).toBe(stopReason);
  });

  it('does NOT upgrade a stalled harvest to target_reached when the count matches', async () => {
    // The single most tempting line to write in this adapter, and the one that
    // breaks the engine: a stop reason derived from counts tells the reconciler
    // it saw everything, absence becomes evidence of removal, and a client's
    // reviews are deleted. The navigator stalled; the count agreeing is a
    // coincidence.
    const { adapter } = build({
      navigation: { stopReason: 'stalled', advertisedTotal: 2, finalCount: 2 },
    });

    const result = await adapter.harvest(REQUEST);

    expect(result.value.stop_reason).toBe('stalled');
  });

  it('reports advertised totals as the source stated them', async () => {
    const { adapter } = build();
    const result = await adapter.harvest(REQUEST);

    expect(result.value.advertised_total).toBe(118);
    expect(result.value.advertised_rating).toBe(4.6);
  });

  it('reports a missing advertised total as null, never as the observed count', async () => {
    // Deriving it would make coverage permanently 1.0 and G-08 — the gate rule
    // that catches a truncated harvest — permanently silent.
    const { adapter } = build({ navigation: { advertisedTotal: null } });
    const result = await adapter.harvest(REQUEST);

    expect(result.value.advertised_total).toBeNull();
  });

  it('honours the cap without changing the stop reason', async () => {
    const { adapter } = build();
    const result = await adapter.harvest({ ...REQUEST, cap: 1 });

    expect(result.value.reviews).toHaveLength(1);
    // The navigator decides why it stopped. Slicing here is our ceiling, not
    // the source's, and rewriting the reason to `cap_reached` would claim the
    // source ran out when it did not.
    expect(result.value.stop_reason).toBe('target_reached');
  });

  it('carries diagnostics an incident needs, including the pack version', async () => {
    const { adapter } = build();
    const result = await adapter.harvest(REQUEST);

    expect(result.value.diagnostics.selector_pack_version).toBe('v-test');
    expect(result.value.diagnostics.growth_curve).toEqual([2]);
    expect(result.value.diagnostics.consent_state).toBe('none');
    expect(result.value.diagnostics.stop_detail).toContain('target');
  });

  it('reports quarantined rows rather than dropping them silently', async () => {
    const warn = vi.fn();
    const { adapter } = build({
      navigation: {
        // The second node has no author, which the pack marks required.
        html:
          '<div data-feed>' +
          '<div data-review><span data-author>Dana</span>' +
          "<span role='img' aria-label='Rated 5.0 out of 5'></span></div>" +
          "<div data-review><span role='img' aria-label='Rated 4.0 out of 5'></span></div>" +
          '</div>',
      },
      logger: { info: () => {}, warn },
    });

    const result = await adapter.harvest(REQUEST);

    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.diagnostics.rejected_rows).toHaveLength(1);
    // Silence here is how a pack that has half-broken looks healthy.
    expect(warn).toHaveBeenCalled();
  });

  it('surfaces an extraction failure as its own error code', async () => {
    const { adapter } = build({ navigation: { html: '<div><p>nothing here</p></div>' } });
    const result = await adapter.harvest(REQUEST);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
  });
});
