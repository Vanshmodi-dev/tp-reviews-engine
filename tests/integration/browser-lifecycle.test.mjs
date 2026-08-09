import { afterAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../../src/adapters/browser/playwright-chromium.mjs';

/**
 * These tests launch a real Chromium and touch no network.
 *
 * They are NOT in `tests/live/`, which exists for tests that reach the internet
 * (TR-TEST-010, IR-18) and is therefore opt-in. TR-BRW-053 is not optional
 * decoration: **a leaked context is invisible on a two-target local run and
 * fatal on a twenty-target production shard**, so the test that catches it has
 * to block a merge.
 *
 * They run as their own vitest project instead, for a resource reason rather
 * than a network one. Chromium competes for CPU with `tests/budgets/`, which
 * measures a *ratio* of two timings taken moments apart — and under contention
 * that ratio stops meaning anything. The reconcile scaling budget failed on its
 * first run alongside this suite and passed alone, which is a flaky test rather
 * than a slow one. CI runs both projects; neither can hide the other.
 */

/** An allowlisted origin, served from memory so nothing touches the network. */
const ORIGIN = 'https://localhost/tenant';

/**
 * @param {any} page
 * @returns {Promise<void>}
 */
async function serveOrigin(page) {
  // Registered after the adapter's own `**/*` route, so it wins — Playwright
  // gives precedence to the most recently added handler.
  await page.route(ORIGIN, (/** @type {any} */ route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>x</body></html>' }),
  );
}

/** @type {Array<{ close: () => Promise<void> }>} */
const sessions = [];

/**
 * @param {Record<string, any>} [options]
 * @returns {Promise<any>}
 */
async function session(options = {}) {
  const created = await launchBrowser({ allowedHosts: ['localhost'], ...options });

  sessions.push(created);

  return created;
}

afterAll(async () => {
  for (const created of sessions) await created.close();
});

describe('EDR-011 — launch, use, close', () => {
  it('launches headless and closes cleanly', async () => {
    const browser = await launchBrowser({ allowedHosts: [] });
    const target = await browser.openTarget();

    await target.page.setContent('<div role="article">hello</div>');

    expect(await target.page.content()).toContain('hello');

    await target.close();
    await browser.close();

    expect(browser.openContexts()).toBe(0);
  });

  it('refuses to launch when the budgets are not correctly nested', async () => {
    // Checked before launch, not after. A misconfigured budget discovered five
    // minutes into a run has already spent the budget it was meant to bound.
    await expect(launchBrowser({ nav: { pagination_budget_ms: 999_999_999 } })).rejects.toThrow(
      /not correctly nested/u,
    );
  });

  it('refuses headed mode under production before touching the browser', async () => {
    await expect(launchBrowser({ headed: true, environment: 'production' })).rejects.toThrow(
      /EDR-010/u,
    );
  });
});

describe('BRW-03 / TR-BRW-053 — the open-context count returns to zero', () => {
  it('after every target in a multi-target run', async () => {
    const browser = await session();

    for (const listing of [{ locale: 'en-GB' }, { locale: 'de-DE' }, { locale: 'hi-IN' }]) {
      const target = await browser.openTarget(listing);

      expect(browser.openContexts()).toBe(1);

      await target.page.setContent('<div role="article">x</div>');
      await target.close();

      // Asserted after EVERY target, not merely at the end of the run. A leak
      // that is cleaned up by the final close still peaked at N contexts, and
      // the peak is what exhausts the runner.
      expect(browser.openContexts()).toBe(0);
    }
  });

  it('after a target that FAILS mid-way (BRW-01, IR-09)', async () => {
    // The test that matters. A suite covering only the success path proves
    // nothing about the path where the leak occurs, and `finally` is omitted
    // precisely on error paths because they are the ones nobody exercises.
    const browser = await session();
    const target = await browser.openTarget();

    expect(browser.openContexts()).toBe(1);

    try {
      await target.page.goto('https://127.0.0.1:9/never', { timeout: 500 });
      expect.unreachable('the navigation was supposed to fail');
    } catch {
      // The failure is the point of the test.
    } finally {
      await target.close();
    }

    expect(browser.openContexts()).toBe(0);
  });

  it('after openTarget itself throws, leaving no orphan context', async () => {
    // The context is created before a page can fail to open. If openTarget
    // leaked on its own error path the caller would never even hold a handle
    // to clean up.
    const browser = await session();

    await browser.close();

    await expect(browser.openTarget()).rejects.toThrow();
    expect(browser.openContexts()).toBe(0);
  });

  it('closes any straggler when the browser closes', async () => {
    const browser = await launchBrowser({ allowedHosts: [] });

    await browser.openTarget();
    await browser.openTarget();

    expect(browser.openContexts()).toBe(2);

    await browser.close();

    expect(browser.openContexts()).toBe(0);
  });
});

describe('BRW-02 — teardown tolerates a step that already failed', () => {
  it('does not throw when close is called twice', async () => {
    // TR-BRW-057: a close failure is logged and swallowed. Rethrowing would
    // replace the real error with a cleanup error, which is how the actual
    // cause of an incident gets lost.
    const browser = await session();
    const target = await browser.openTarget();

    await target.close();
    await expect(target.close()).resolves.toBeUndefined();
    expect(browser.openContexts()).toBe(0);
  });

  it('cannot be made to throw through the public API, which is why the unit test exists', async () => {
    // Playwright's closes are idempotent no-ops in this version: closing twice
    // succeeds, and closing after the browser is gone succeeds too. So the
    // failure TR-BRW-057 exists to survive is NOT reachable from here.
    //
    // That is a happy accident of one library version, not a guarantee — a
    // crashed process or a future release can make a close throw. The tolerance
    // is proven directly in tests/unit/browser/, against a throwing step.
    const browser = await session();
    const target = await browser.openTarget();

    await target.page.close();
    await target.page.context().close();

    await expect(target.close()).resolves.toBeUndefined();
    expect(browser.openContexts()).toBe(0);
  });
});

describe('INV-09 — contexts do not share state', () => {
  it('gives each target its own storage', async () => {
    // One context reused across targets saves about a hundred milliseconds and
    // leaks storage, cookies, and cache between tenants. This is the
    // optimisation that looks harmless and violates INV-09.
    // `setContent` leaves the page on an opaque `about:blank` origin, where
    // localStorage throws SecurityError. Storage isolation is only meaningful
    // against a real origin, so one is served locally through the route layer —
    // no network, and the allowlist still applies.
    const browser = await session();
    const first = await browser.openTarget();

    await serveOrigin(first.page);
    await first.page.goto(ORIGIN);
    await first.page.evaluate(() => globalThis.localStorage.setItem('tenant', 'client-a'));

    expect(await first.page.evaluate(() => globalThis.localStorage.getItem('tenant'))).toBe(
      'client-a',
    );

    await first.close();

    const second = await browser.openTarget();

    await serveOrigin(second.page);
    await second.page.goto(ORIGIN);

    expect(await second.page.evaluate(() => globalThis.localStorage.getItem('tenant'))).toBeNull();

    await second.close();
  });

  it('applies the configured locale to the page, not the runner default', async () => {
    const browser = await session();
    const target = await browser.openTarget({ locale: 'de-DE', timezone: 'Europe/Berlin' });

    await target.page.setContent('<html><body>x</body></html>');

    expect(await target.page.evaluate(() => globalThis.navigator.language)).toBe('de-DE');
    expect(
      await target.page.evaluate(() => globalThis.Intl.DateTimeFormat().resolvedOptions().timeZone),
    ).toBe('Europe/Berlin');

    await target.close();
  });
});
