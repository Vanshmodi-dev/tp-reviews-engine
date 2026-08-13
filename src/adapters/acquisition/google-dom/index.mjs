/**
 * `google:dom` — the DOM acquisition adapter (§20, ADP-01).
 *
 * The primary adapter, and the last component to be built. Every other part of
 * the DOM path has existed for phases: the browser session (C-09), the
 * navigator (C-10), consent classification, pagination, subtree serialisation,
 * the resolver (C-08), the selector packs, the extractor. Nothing assembled
 * them into something implementing `AcquisitionPort`, so nothing could run.
 *
 * ## This file decides almost nothing
 *
 * Sequencing and lifecycle. That is the whole of it. Where to go comes from the
 * resolver; when to stop comes from the navigator; what the markup means comes
 * from the extractor and the pack. If a decision appears to be made here, it is
 * in the wrong place.
 *
 * ## The stop reason is passed through, never recomputed (VAL-01)
 *
 * The navigator reports why it stopped. This adapter hands that word onward
 * unchanged, and specifically does NOT compare `reviews.length` to
 * `advertisedTotal` to decide whether the harvest was complete.
 *
 * That comparison is the single most tempting line to write here and it is the
 * one that breaks the engine: an advertised total goes stale, a source
 * paginates badly, and a `target_reached` derived from counts tells the
 * reconciler it saw everything — at which point absence becomes evidence of
 * removal and a client's reviews are deleted. Completeness is classified from
 * the stop reason, downstream, by `classifyCompleteness`.
 *
 * ## It never throws (INV-09)
 *
 * Every failure is a `Result`. One target failing must not take down a shard of
 * twenty, and an adapter that threw would do exactly that.
 *
 * @module adapters/acquisition/google-dom
 */

import { extractReviews, parseHtml } from '../../../core/index.mjs';
import { navigate } from './navigator.mjs';

/** What this adapter can supply (FR-020). Declared, not inferred. */
export const DOM_CAPABILITIES = Object.freeze([
  'review_text',
  'owner_reply',
  'likes',
  'photo_count',
  'author_name',
  'author_profile_url',
  'author_avatar_url',
  'author_badges',
  'relative_date',
  'advertised_total',
  'advertised_rating',
  'full_pagination',
  'sort_by_newest',
]);

/** Navigation budgets when the caller supplies none. */
const DEFAULT_BUDGETS = Object.freeze({
  navigation_timeout_ms: 30_000,
  surface_timeout_ms: 15_000,
  total_ms: 180_000,
});

/**
 * @param {string} code
 * @param {string} message
 * @returns {any}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * The listing URL.
 *
 * Built by the engine, never scraped (TR-EXT-090). A URL read off the page is a
 * URL the page chose, and following it is how a redirect becomes a harvest of
 * somewhere else.
 *
 * @param {any} listing
 * @returns {string | null}
 */
export function listingUrl(listing) {
  const identity = listing?.identity ?? {};
  const placeId = firstNonEmpty([listing?.canonicalId, identity.place_id, listing?.place_id]);

  if (placeId !== null) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }

  const cid = firstNonEmpty([identity.cid, listing?.cid]);

  if (cid !== null) return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`;

  // The resolver's canonical URL is a last resort rather than a first choice:
  // it was captured on a previous run, and the identifier above is what THIS
  // run verified.
  return firstNonEmpty([listing?.canonicalUrl]);
}

/**
 * @param {ReadonlyArray<unknown>} values
 * @returns {string | null}
 */
function firstNonEmpty(values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;

    const text = String(value);

    if (text !== '') return text;
  }

  return null;
}

/**
 * Builds the adapter.
 *
 * @param {object} deps
 * @param {{ openTarget: (listing?: any) => Promise<any> }} deps.browser
 * @param {(source: string) => any} [deps.pack]  Resolves the pinned selector pack.
 * @param {(page: any, options: any) => Promise<any>} [deps.navigate]
 *   Injected so the adapter's sequencing can be tested without a browser. The
 *   default is the real navigator; its own behaviour is tested against a real
 *   page in the browser suite.
 * @param {any} [deps.logger]
 * @returns {any}
 */
export function createDomAdapter(deps) {
  const logger = deps.logger ?? { info: () => {}, warn: () => {} };
  const drive = deps.navigate ?? navigate;

  return {
    id: 'google:dom',

    capabilities: () => DOM_CAPABILITIES,

    /**
     * @param {any} request
     * @returns {Promise<any>}
     */
    async harvest(request) {
      const url = listingUrl(request.listing);

      if (url === null) {
        return failure(
          'ERR-RESOLVE-NO-IDENTIFIER',
          'the listing has no place_id, cid, or canonical URL to navigate to',
        );
      }

      const pack = deps.pack?.(request.listing?.source ?? 'google');

      if (pack === undefined || pack === null) {
        // Without a pack there is nothing to find on the page. Failing here
        // beats navigating first and reporting a structure error, which would
        // send an engineer to the selector-repair runbook for a pack that was
        // never loaded.
        return failure('ERR-PARSE-SELECTOR-PACK', 'no selector pack was resolved for this source');
      }

      return withTarget(deps.browser, request, async (target) => {
        const outcome = await drive(target.page, {
          url,
          pack,
          // The browser adapter owns the timeout graph (TR-BRW-020); the
          // request may tighten it but the defaults here are a last resort for
          // a browser that supplied none.
          budgets: { ...DEFAULT_BUDGETS, ...(target.budgets ?? {}), ...(request.budget ?? {}) },
          nav: request.nav ?? {},
          ...(target.counters === undefined ? {} : { counters: target.counters }),
        });

        return outcome.ok === false
          ? failure(outcome.error.code, outcome.error.message)
          : harvestOf(outcome.value, request, pack, logger);
      });
    },
  };
}

/**
 * Opens a target, runs the body, and always closes the context (BRW-03).
 *
 * The `finally` is the point. A leaked context is invisible on a two-target
 * local run and fatal on a twenty-target production shard, where twenty leaked
 * contexts exhaust the runner's memory and the failure looks like an OOM in
 * whichever target happened to be last.
 *
 * @param {any} browser
 * @param {any} request
 * @param {(target: any) => Promise<any>} body
 * @returns {Promise<any>}
 */
async function withTarget(browser, request, body) {
  /** @type {any} */
  let target = null;

  try {
    target = await browser.openTarget(request.listing);

    return await body(target);
  } catch (error) {
    // INV-09: a Result, never a throw. A browser crash on one target must cost
    // that target and nothing else.
    return failure('ERR-BROWSER-CRASH', error instanceof Error ? error.message : String(error));
  } finally {
    await target?.close?.().catch(() => {});
  }
}

/**
 * Extracts, and assembles the acquisition report.
 *
 * @param {any} navigation
 * @param {any} request
 * @param {any} pack
 * @param {any} logger
 * @returns {any}
 */
function harvestOf(navigation, request, pack, logger) {
  const extracted = extractReviews(navigation.html, pack, {
    parse: parseHtml,
    locale: request.listing?.locale ?? 'en',
    // The navigator already looked for the empty-state signal on the live page.
    // Re-deriving it from the serialised subtree would be a second opinion from
    // less information (INV-03).
    emptyStateSignal: navigation.stopReason === 'exhausted' && navigation.finalCount === 0,
  });

  if (extracted.ok === false) {
    return failure(extracted.error.code, extracted.error.message);
  }

  const { reviews, quarantined } = extracted.value;

  reportQuarantine(quarantined, reviews.length, logger);

  return {
    ok: true,
    value: {
      adapter_id: 'google:dom',
      reviews: reviews.slice(0, request.cap ?? Number.POSITIVE_INFINITY),
      // Straight from the navigator. Not derived, not adjusted, not compared
      // against `advertised_total` — see the module header.
      stop_reason: navigation.stopReason,
      advertised_total: numberOrNull(navigation.advertisedTotal),
      advertised_rating: numberOrNull(navigation.advertisedRating),
      capabilities: DOM_CAPABILITIES,
      diagnostics: {
        rejected_rows: quarantined,
        growth_curve: navigation.growthCurve,
        iterations: navigation.iterations,
        elapsed_ms: navigation.elapsedMs,
        consent_state: navigation.consentState,
        sort_applied: navigation.sortApplied,
        stop_detail: navigation.stopDetail,
        selector_pack_version: pack?.meta?.version ?? null,
        counters: navigation.counters ?? null,
      },
    },
  };
}

/**
 * Silence here is how a pack that has half-broken looks healthy.
 *
 * @param {ReadonlyArray<any>} quarantined
 * @param {number} extracted
 * @param {any} logger
 * @returns {void}
 */
function reportQuarantine(quarantined, extracted, logger) {
  if (quarantined.length === 0) return;

  logger.warn('records quarantined during extraction', {
    adapter: 'google:dom',
    quarantined: quarantined.length,
    extracted,
  });
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
