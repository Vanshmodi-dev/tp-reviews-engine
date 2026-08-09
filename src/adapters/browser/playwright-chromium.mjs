/**
 * The one file that imports `playwright` (TR-BRW-001, TR-BRW-010, DR-3).
 *
 * ## Why exactly one, and why two mechanisms enforce it
 *
 * PW-01 requires both an architecture test and a lint rule, because this is the
 * rule whose violation is most tempting and least visible. The usual breach is
 * not someone launching a second browser — it is the navigator importing
 * `playwright` *"just for a type"*. That single import makes the navigator
 * untestable without Chromium, and from there the pure pipeline follows.
 *
 * The migration path stated in SAD §2 — "Puppeteer, documented, confined to one
 * file" — is only true while this file is the one file.
 *
 * ## The lifecycle is the security control (EDR-011, INV-09)
 *
 * One browser per shard, one context per target, one page per context. A
 * context isolates storage, cookies, cache, and permissions; reusing one across
 * targets saves about a hundred milliseconds and leaks state between tenants.
 * That is the optimisation that looks harmless and violates INV-09.
 *
 * Every close runs in a `finally`, and every close tolerates the previous step
 * having already failed (BRW-02). IR-09 — contexts leaking because `finally`
 * was omitted on an error path — is invisible on a two-target local run and
 * fatal on a twenty-target shard.
 *
 * ## What this file must never grow
 *
 * §15.4 lists the Playwright capabilities deliberately not used, as a
 * security-review artifact. No persistent context, no `storageState`, no proxy,
 * no fingerprint patching, no `page.pause()`, no video, no second page per
 * context. TR-BRW-014 makes adding any of them a rejectable change.
 *
 * @module adapters/browser/playwright-chromium
 */

import { chromium } from 'playwright';

import { closeQuietly } from './close-quietly.mjs';
import { contextOptions, launchOptions, refuseHeaded } from './flags.mjs';
import { createCounters, decideRoute } from './interception.mjs';
import { checkNesting, resolveBudgets } from './timeouts.mjs';

/**
 * @typedef {object} BrowserSession
 * @property {(listing?: any) => Promise<any>} openTarget  A page in a fresh context.
 * @property {() => number} openContexts   Asserted to return to zero (BRW-03).
 * @property {() => Promise<void>} close
 */

/**
 * Launches one browser for a shard.
 *
 * @param {object} [options]
 * @param {boolean} [options.headed]
 * @param {string} [options.environment]  `TPRE_ENV`.
 * @param {Record<string, any>} [options.nav]
 * @param {Record<string, any>} [options.publish]
 * @param {ReadonlyArray<string>} [options.allowedHosts]
 * @param {{ debug: (event: string, fields?: any) => void }} [options.logger]
 * @returns {Promise<BrowserSession>}
 */
export async function launchBrowser(options = {}) {
  const refusal = refuseHeaded(options.headed === true, options.environment);

  if (refusal !== null) throw new Error(refusal);

  const budgets = resolveBudgets(options.nav, options.publish);
  const nesting = checkNesting(budgets);

  // Checked before launch, not after. A misconfigured budget discovered five
  // minutes into a run has already spent the budget it was meant to bound.
  if (nesting.length > 0) {
    throw new Error(`timeout budgets are not correctly nested:\n  ${nesting.join('\n  ')}`);
  }

  const browser = await chromium.launch(launchOptions({ headed: options.headed }));
  /** @type {Set<any>} */
  const open = new Set();

  return {
    openContexts: () => open.size,

    async openTarget(listing = {}) {
      const context = await browser.newContext(contextOptions(listing));

      open.add(context);

      try {
        const page = await context.newPage();

        // TR-BRW-020: explicit, never the library default. Playwright's unset
        // default is 30 s for some APIs and infinite for others — a value
        // nobody chose and nobody remembers choosing.
        page.setDefaultTimeout(budgets.action_timeout_ms);
        page.setDefaultNavigationTimeout(budgets.navigation_timeout_ms);

        const { counters, record } = createCounters();

        await installInterception(page, {
          allowedHosts: options.allowedHosts ?? [],
          record,
          logger: options.logger,
        });

        return {
          page,
          budgets,
          counters,
          async close() {
            // BRW-02: page → context → browser, each tolerating the previous
            // having already failed. A close that throws must not prevent the
            // next close from running, or one bad target leaks for the rest of
            // the shard.
            await closeQuietly(() => page.close(), options.logger, 'page');
            await closeQuietly(() => context.close(), options.logger, 'context');
            open.delete(context);
          },
        };
      } catch (error) {
        // The context was created before the failure, so it is ours to clean up
        // even though the caller never received a handle to it.
        await closeQuietly(() => context.close(), options.logger, 'context');
        open.delete(context);

        throw error;
      }
    },

    async close() {
      for (const context of [...open]) {
        await closeQuietly(() => context.close(), options.logger, 'context');
        open.delete(context);
      }

      await closeQuietly(() => browser.close(), options.logger, 'browser');
    },
  };
}

/**
 * Attaches the route policy and counts what it decides.
 *
 * @param {any} page
 * @param {{
 *   allowedHosts: ReadonlyArray<string>,
 *   record: (decision: any, bytes?: number) => void,
 *   logger?: { debug: (event: string, fields?: any) => void } | undefined,
 * }} wiring
 * @returns {Promise<void>}
 */
async function installInterception(page, wiring) {
  await page.route('**/*', async (/** @type {any} */ route) => {
    const request = route.request();
    const decision = decideRoute(
      { url: request.url(), resourceType: request.resourceType() },
      { allowedHosts: wiring.allowedHosts },
    );

    if (!decision.allowed) {
      wiring.record(decision);

      // `abort`, not `fulfill` with an empty body. A fulfilled request looks
      // successful to the page, which can leave it waiting on content that will
      // never arrive; an aborted one fails fast and visibly.
      await route.abort();

      return;
    }

    await route.continue();
  });

  // Response sizes are read here rather than at request time because the size
  // of an allowed response is not knowable until it arrives — and the byte
  // reduction TR-BRW-030 reports is only meaningful against a real total.
  page.on('response', async (/** @type {any} */ response) => {
    try {
      const length = Number(response.headers()['content-length'] ?? 0);

      wiring.record({ allowed: true, reason: 'allowed' }, Number.isFinite(length) ? length : 0);
    } catch {
      // A response whose headers cannot be read is not worth failing a harvest
      // over. The counter is a diagnostic, not a correctness invariant.
    }
  });
}
