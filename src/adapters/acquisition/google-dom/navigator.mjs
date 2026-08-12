/**
 * The Navigator (DEL-84) — drive a surface as far as the budget allows, and
 * report honestly how far that was.
 *
 * ## The stop reason is the product
 *
 * TR-NAV-001. The reviews are the obvious output; the **stop reason** is the
 * one that decides whether absences mean anything. It is emitted here, at the
 * point of stopping, and never inferred downstream from counts — because
 * inferring it from counts is exactly how a stalled harvest gets classified
 * `full` and begins deleting a paying client's reviews.
 *
 * `core/validate/completeness.mjs` reads this and nothing else.
 *
 * ## The growth curve is the diagnostic
 *
 * EDR-014. When a harvest returns 12 of 118, the question is *where it stopped
 * growing*, and without the curve that is unanswerable after the fact. It is
 * retained on every run, not only on failure: a **successful** harvest with a
 * suspicious curve is precisely the case worth catching early.
 *
 * ## Scrolling is by ratio, never to the bottom
 *
 * EDR-013. Jumping to the bottom of a virtualised container skips the rows in
 * between — they are never materialised, so the harvest silently returns fewer
 * reviews than exist. It is a correctness failure disguised as a performance
 * win, and it raises no error of any kind.
 *
 * ## What is deliberately not here
 *
 * No retry of a challenge, no alternate route, no second dismissal strategy,
 * no identity change. INV-07 and ADR-010: the engine's entire response to a
 * refusal is to stop, record, and let a human decide policy.
 *
 * @module adapters/acquisition/google-dom/navigator
 */

import { classifySignals, detectSignals } from '../../../core/index.mjs';

import { CONSENT_WALL_ERROR, DISMISS_TIMEOUT_MS, classifyConsent } from './consent.mjs';
import { serializeSurface } from './dom-serialize.mjs';
import { backoffFor, evaluateStop, quietIterations, scrollStep } from './pagination.mjs';

/** Sort application is non-fatal and gets a short leash (§19.2). */
const SORT_TIMEOUT_MS = 5_000;

/** Defaults for the `nav` block, so an absent key is never an absent bound. */
const DEFAULT_MAX_REVIEWS = 5_000;
const DEFAULT_SCROLL_RATIO = 0.9;

/**
 * Settle after an iteration that DID grow.
 *
 * Short, because growth is its own evidence that the feed is responding. The
 * increasing backoff in `pagination.mjs` applies only to quiet iterations,
 * which are the ones where waiting longer changes the answer.
 */
const GROWING_SETTLE_MS = 250;

/**
 * The Result shape, written out rather than imported from `core/util/result`.
 *
 * DR-6: nothing outside `core/` reaches past `core/index.mjs`, and a JSDoc
 * `import()` counts — the architecture test resolves types as well as values,
 * which is the point of having it in addition to lint. The generic `Result` is
 * not re-exportable as a typedef through the barrel, so the shape is stated
 * here instead of quietly tunnelling through the boundary for a type.
 *
 * @typedef {{ ok: true, value: NavigationResult }
 *   | { ok: false, error: { code: string, message: string, stopReason: string, elapsedMs: number } }
 * } NavigationOutcome
 */

/**
 * @typedef {object} NavigationResult
 * @property {string} html            The serialised surface subtree.
 * @property {string} stopReason
 * @property {string} stopDetail
 * @property {number[]} growthCurve
 * @property {number} finalCount
 * @property {number} iterations
 * @property {number} elapsedMs
 * @property {number | null} advertisedTotal
 * @property {boolean} sortApplied
 * @property {string} consentState
 * @property {any} counters
 */

/**
 * Drives one target.
 *
 * @param {any} page       A page from the browser adapter.
 * @param {object} options
 * @param {string} options.url
 * @param {any} options.pack
 * @param {any} options.budgets
 * @param {any} [options.nav]
 * @param {any} [options.counters]
 * @param {() => number} [options.now]
 * @returns {Promise<NavigationOutcome>}
 */
export async function navigate(page, options) {
  const now = options.now ?? (() => Date.now());
  const nav = options.nav ?? {};
  const started = now();

  try {
    await page.goto(options.url, {
      timeout: options.budgets.navigation_timeout_ms,
      // `domcontentloaded`, not `networkidle`. A review feed polls, so
      // `networkidle` on a live surface waits for a quiet moment that may never
      // come and then reports a navigation timeout for a page that loaded fine.
      waitUntil: 'domcontentloaded',
    });
  } catch (error) {
    return failure('ERR-NAV-TIMEOUT', message(error), { started, now });
  }

  // TR-NAV-011: before anything is parsed. A challenge found after a parse
  // failure produces a misleading ERR-PARSE-STRUCTURE and sends the engineer to
  // the wrong runbook — and triggers the retry that hardens a soft block.
  const blocked = classifySignals(detectSignals(await page.content(), options.pack));

  if (blocked !== null && blocked.code !== CONSENT_WALL_ERROR) {
    return failure(blocked.code, blocked.reason, { started, now });
  }

  const consent = await handleConsent(page, options.pack);

  if (consent.state === 'wall') {
    return failure(CONSENT_WALL_ERROR, consent.detail, { started, now });
  }

  const surface = await waitForSurface(page, options.pack, options.budgets.surface_timeout_ms);

  if (surface === null) {
    return failure(
      'ERR-NAV-SURFACE-NOT-FOUND',
      'no containers.surface strategy matched within the surface budget',
      { started, now },
    );
  }

  const sortApplied = await applySort(page, options.pack);
  const pagination = await paginate(page, {
    surface,
    pack: options.pack,
    nav,
    budgetMs: options.budgets.pagination_budget_ms,
    now,
  });

  return {
    ok: true,
    value: {
      html: await serializeSurface(page, surface),
      stopReason: pagination.stopReason,
      stopDetail: pagination.stopDetail,
      growthCurve: pagination.growthCurve,
      finalCount: pagination.finalCount,
      iterations: pagination.iterations,
      elapsedMs: now() - started,
      advertisedTotal: pagination.advertisedTotal,
      sortApplied,
      consentState: consent.state,
      counters: options.counters ?? null,
    },
  };
}

/**
 * @param {any} page
 * @param {any} pack
 * @returns {Promise<import('./consent.mjs').ConsentOutcome>}
 */
async function handleConsent(page, pack) {
  const patterns = firstOf(pack, ['signals', 'consent', 'patterns']) ?? [];
  const control = strategySelector(pack, 'consent_dismiss');
  const interstitialPresent = matchesAny(await page.content(), patterns);

  if (!interstitialPresent) {
    return classifyConsent({
      interstitialPresent: false,
      surfacePresentAfter: true,
      dismissAttempted: false,
    });
  }

  if (control === null) {
    return classifyConsent({
      interstitialPresent: true,
      surfacePresentAfter: false,
      dismissAttempted: false,
    });
  }

  try {
    // Once. Never a sequence of strategies (TR-NAV-012).
    await page.click(control, { timeout: DISMISS_TIMEOUT_MS });
  } catch {
    // The attempt happened. Whether it worked is decided by looking at the
    // page, not by whether the click resolved — a control that is present but
    // inert resolves fine and changes nothing.
  }

  return classifyConsent({
    interstitialPresent: true,
    dismissAttempted: true,
    surfacePresentAfter: !matchesAny(await page.content(), patterns),
  });
}

/**
 * @param {string} body
 * @param {ReadonlyArray<unknown>} patterns
 * @returns {boolean}
 */
function matchesAny(body, patterns) {
  const haystack = body.toLowerCase();

  return patterns.some(
    (pattern) => typeof pattern === 'string' && haystack.includes(pattern.toLowerCase()),
  );
}

/**
 * @param {any} page
 * @param {any} pack
 * @param {number} timeoutMs
 * @returns {Promise<string | null>}
 */
async function waitForSurface(page, pack, timeoutMs) {
  const strategies = pack?.containers?.surface?.strategies ?? [];
  // The budget covers the whole search, not each strategy. Otherwise a pack
  // with four strategies waits four times the configured surface timeout, and
  // the value in the config file stops describing anything real.
  const share = Math.max(1, Math.floor(timeoutMs / Math.max(1, strategies.length)));

  for (const strategy of strategies) {
    try {
      await page.waitForSelector(strategy.selector, { timeout: share, state: 'attached' });

      return strategy.selector;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Applies the sort control. Non-fatal by requirement (TR-NAV-010).
 *
 * A missing sort control is a product change, not a harvest failure. Failing
 * the target here would turn a cosmetic upstream change into an outage, and
 * the payload's ordering is decided by the projection anyway.
 *
 * @param {any} page
 * @param {any} pack
 * @returns {Promise<boolean>}
 */
async function applySort(page, pack) {
  const control = pack?.containers?.sort_control?.strategies?.[0]?.selector ?? null;

  if (control === null) return false;

  try {
    await page.click(control, { timeout: SORT_TIMEOUT_MS });

    return true;
  } catch {
    return false;
  }
}

/**
 * ALG-PAGINATE (§19.3).
 *
 * @param {any} page
 * @param {{ surface: string, pack: any, nav: any, budgetMs: number, now: () => number }} context
 * @returns {Promise<any>}
 */
async function paginate(page, context) {
  const selectors = {
    scroll: strategySelector(context.pack, 'scroll') ?? context.surface,
    node: strategySelector(context.pack, 'review_node'),
  };
  const limits = paginationLimits(context);
  const ratio = context.nav.scroll_increment_ratio ?? DEFAULT_SCROLL_RATIO;
  const started = context.now();
  const advertisedTotal = await readAdvertisedTotal(page);

  /** @type {number[]} */
  const growthCurve = [await countNodes(page, selectors.node)];
  let iterations = 0;
  let decision = evaluateStop({ growthCurve, elapsedMs: 0, advertisedTotal }, limits);

  while (!decision.stop) {
    iterations += 1;

    await scrollOnce(page, selectors.scroll, ratio);
    await settle(page, quietIterations(growthCurve));

    growthCurve.push(await countNodes(page, selectors.node));

    decision = evaluateStop(
      { growthCurve, elapsedMs: context.now() - started, advertisedTotal },
      limits,
    );
  }

  return {
    stopReason: decision.reason,
    stopDetail: decision.detail,
    growthCurve,
    finalCount: growthCurve[growthCurve.length - 1],
    iterations,
    advertisedTotal,
  };
}

/**
 * @param {any} pack
 * @param {string} container
 * @returns {string | null}
 */
function strategySelector(pack, container) {
  return pack?.containers?.[container]?.strategies?.[0]?.selector ?? null;
}

/**
 * @param {any} source
 * @param {ReadonlyArray<string>} path
 * @returns {any}
 */
function firstOf(source, path) {
  return path.reduce(
    (value, key) => (value === null || value === undefined ? null : value[key]),
    source,
  );
}

/**
 * @param {any} context
 * @returns {any}
 */
function paginationLimits(context) {
  return {
    maxReviews: context.nav.max_reviews ?? DEFAULT_MAX_REVIEWS,
    paginationBudgetMs: context.budgetMs,
    stallThreshold: context.nav.stall_threshold,
  };
}

/**
 * Waits after a scroll, longer each time the feed stays quiet (TR-NAV-020).
 *
 * A stall declared after three immediate re-scrolls is a stall declared about
 * the network rather than about the source — and a false `stalled` marks a
 * complete harvest `partial`, which stops removals ever being confirmed.
 *
 * @param {any} page
 * @param {number} quiet
 * @returns {Promise<void>}
 */
async function settle(page, quiet) {
  await page.waitForTimeout(quiet === 0 ? GROWING_SETTLE_MS : backoffFor(quiet));
}

/**
 * @param {any} page
 * @param {string} selector
 * @param {number} ratio
 * @returns {Promise<void>}
 */
async function scrollOnce(page, selector, ratio) {
  // These callbacks are serialised and run inside the page, so `document` is a
  // browser global rather than one this module can see. The cast is local to
  // each callback because a closure over an outer alias would not survive
  // serialisation — the function arrives in the page with no scope.
  const height = await page.evaluate((/** @type {string} */ target) => {
    const dom = /** @type {any} */ (globalThis).document;
    const element = dom.querySelector(target);

    return element === null ? 0 : element.clientHeight || dom.body.clientHeight;
  }, selector);
  const step = scrollStep(height, ratio);

  await page.evaluate(
    (/** @type {any} */ args) => {
      const scope = /** @type {any} */ (globalThis);
      const element = scope.document.querySelector(args.selector);

      // Scroll the container that actually overflows. A feed that fits its own
      // box never materialises more rows however hard you scroll it, so the
      // window is the fallback rather than the other way round.
      if (element !== null && element.scrollHeight > element.clientHeight) {
        element.scrollTop += args.step;

        return;
      }

      scope.scrollBy(0, args.step);
    },
    { selector, step },
  );
}

/**
 * @param {any} page
 * @param {string | null} selector
 * @returns {Promise<number>}
 */
async function countNodes(page, selector) {
  if (selector === null) return 0;

  return page.evaluate(
    (/** @type {string} */ target) =>
      /** @type {any} */ (globalThis).document.querySelectorAll(target).length,
    selector,
  );
}

/**
 * The total the source claims exists.
 *
 * Null when the source does not say. That is not a failure — TR-NAV-021 and the
 * completeness table both handle a missing advertised total, and inventing one
 * would make `target_reached` reachable by accident.
 *
 * @param {any} page
 * @returns {Promise<number | null>}
 */
async function readAdvertisedTotal(page) {
  try {
    const total = await page.evaluate(() => /** @type {any} */ (globalThis).__advertisedTotal);

    return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} code
 * @param {string} detail
 * @param {{ started: number, now: () => number }} timing
 * @returns {any}
 */
function failure(code, detail, timing) {
  // Even a failure carries a stop reason. `error` maps to `failed`, and a
  // report without one would be classified by the fail-closed default rather
  // than by a stated fact.
  return {
    ok: false,
    error: {
      code,
      message: detail,
      stopReason: 'error',
      elapsedMs: timing.now() - timing.started,
    },
  };
}
