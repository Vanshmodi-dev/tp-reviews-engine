import { describe, expect, it } from 'vitest';

import { closeQuietly } from '../../../src/adapters/browser/close-quietly.mjs';
import {
  LAUNCH_ARGS,
  contextOptions,
  launchOptions,
  refuseHeaded,
} from '../../../src/adapters/browser/flags.mjs';
import {
  BLOCKED_TYPES,
  createCounters,
  decideRoute,
  hostAllowed,
} from '../../../src/adapters/browser/interception.mjs';
import {
  CONSTRAINTS,
  DEFAULT_BUDGETS,
  checkNesting,
  resolveBudgets,
} from '../../../src/adapters/browser/timeouts.mjs';

describe('EDR-028 — the six timeout budgets', () => {
  const budgets = resolveBudgets();

  it('resolves all six, none unset or infinite (TR-BRW-020)', () => {
    // "Unset" in Playwright means 30 s for some APIs and forever for others —
    // a default nobody chose and nobody remembers choosing.
    for (const value of Object.values(budgets)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }

    expect(Object.keys(budgets)).toHaveLength(6);
  });

  it('satisfies every containment constraint', () => {
    expect(checkNesting(budgets)).toEqual([]);
  });

  it('derives the action budget from navigation rather than configuring it', () => {
    expect(budgets.action_timeout_ms).toBeLessThan(budgets.navigation_timeout_ms);
    expect(resolveBudgets({ navigation_timeout_ms: 60_000 }).action_timeout_ms).toBe(10_000);
  });

  it('takes budgets from config and falls back to the documented defaults', () => {
    const configured = resolveBudgets(
      { navigation_timeout_ms: 20_000, surface_timeout_ms: 5_000 },
      { budget_run_ms: 600_000 },
    );

    expect(configured.navigation_timeout_ms).toBe(20_000);
    expect(configured.surface_timeout_ms).toBe(5_000);
    expect(configured.budget_run_ms).toBe(600_000);
    expect(configured.budget_target_ms).toBe(DEFAULT_BUDGETS.budget_target_ms);
  });

  it('ignores a non-positive or non-numeric override rather than adopting it', () => {
    // A zero or negative budget is an infinite budget wearing a disguise.
    const bad = resolveBudgets({ navigation_timeout_ms: 0, surface_timeout_ms: 'soon' });

    expect(bad.navigation_timeout_ms).toBe(DEFAULT_BUDGETS.navigation_timeout_ms);
    expect(bad.surface_timeout_ms).toBe(DEFAULT_BUDGETS.surface_timeout_ms);
  });

  describe('the constraint is a graph, not a chain', () => {
    it('deliberately allows the surface wait to be SHORTER than navigation', () => {
      // §29.2. Navigation is 30 s and the surface wait is 15 s, and a test
      // asserting `t1 < t2 < … < t6` fails on the documented values. The "fix"
      // it would push you toward — raising the surface wait above navigation —
      // doubles the time every selector break takes to detect, because a
      // surface that has not appeared in 15 s is not going to appear.
      expect(DEFAULT_BUDGETS.surface_timeout_ms).toBeLessThan(
        DEFAULT_BUDGETS.navigation_timeout_ms,
      );
      expect(checkNesting(resolveBudgets())).toEqual([]);
    });

    it('states each constraint as an explicit inner/outer pair', () => {
      expect(CONSTRAINTS).toContainEqual(['pagination_budget_ms', 'budget_target_ms']);
      expect(CONSTRAINTS).toContainEqual(['budget_target_ms', 'budget_run_ms']);
      // The pair that must NOT exist, because it is the naive reading.
      expect(CONSTRAINTS).not.toContainEqual(['navigation_timeout_ms', 'surface_timeout_ms']);
    });
  });

  describe('violations are reported, all of them', () => {
    it('REJECTS a target budget that cannot contain the pagination loop', () => {
      const problems = checkNesting(
        resolveBudgets({ pagination_budget_ms: 400_000 }, { budget_target_ms: 300_000 }),
      );

      expect(problems.join(' ')).toContain('pagination_budget_ms');
      expect(problems.join(' ')).toContain('must fire before');
    });

    it('REJECTS a run budget smaller than a target budget', () => {
      const problems = checkNesting(resolveBudgets({}, { budget_run_ms: 60_000 }));

      expect(problems.join(' ')).toContain('budget_target_ms');
    });

    it('reports every broken relationship, not the first', () => {
      // An operator who lowered budget_target_ms has usually broken two
      // relationships, not one.
      const problems = checkNesting({
        action_timeout_ms: 5_000,
        navigation_timeout_ms: 30_000,
        surface_timeout_ms: 15_000,
        pagination_budget_ms: 120_000,
        budget_target_ms: 100_000,
        budget_run_ms: 90_000,
      });

      expect(problems.length).toBeGreaterThan(1);
    });

    it('REJECTS an unset or non-positive budget explicitly', () => {
      const problems = checkNesting(
        /** @type {any} */ ({
          action_timeout_ms: 0,
          navigation_timeout_ms: 30_000,
          surface_timeout_ms: 15_000,
          pagination_budget_ms: 120_000,
          budget_target_ms: 300_000,
          budget_run_ms: 900_000,
        }),
      );

      expect(problems.join(' ')).toContain('never unset or infinite');
    });
  });
});

describe('TRD §16.1 — launch configuration', () => {
  it('is headless unless explicitly asked otherwise', () => {
    expect(launchOptions().headless).toBe(true);
    expect(launchOptions({ headed: true }).headless).toBe(false);
  });

  it('keeps the sandbox on and the debug aids off', () => {
    const options = launchOptions();

    expect(options.chromiumSandbox).toBe(true);
    expect(options.devtools).toBe(false);
    expect(options.slowMo).toBe(0);
  });

  it('carries no argument that weakens the sandbox (TR-BRW-021)', () => {
    // Several plausible-looking Chromium flags materially weaken sandboxing,
    // and they do it silently — the process still launches and still returns
    // markup. `--no-sandbox` is the one most often added to make CI work.
    const args = /** @type {string[]} */ (launchOptions().args);

    for (const forbidden of [
      '--no-sandbox',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--allow-running-insecure-content',
      '--disable-site-isolation-trials',
    ]) {
      expect(args).not.toContain(forbidden);
    }
  });

  it('keeps the argument list short enough to review', () => {
    // The list is a review artifact. Once it stops being readable in one sitting
    // it stops being reviewed, which is precisely when a bad flag lands.
    expect(LAUNCH_ARGS.length).toBeLessThanOrEqual(10);
  });
});

describe('TRD §16.2 — context configuration', () => {
  it('takes locale and timezone from client config (TR-BRW-022)', () => {
    // A runner in UTC harvesting an Indian client's listing renders different
    // relative-date phrasing than the pack expects — and the failure is silent,
    // because unparseable phrases become null estimates rather than errors.
    const options = contextOptions({ locale: 'hi-IN', timezone: 'Asia/Kolkata' });

    expect(options.locale).toBe('hi-IN');
    expect(options.timezoneId).toBe('Asia/Kolkata');
  });

  it('never inherits the runner default silently', () => {
    const options = contextOptions();

    expect(options.locale).toBeTruthy();
    expect(options.timezoneId).toBeTruthy();
  });

  it('grants no permission at all (TR-BRW-024)', () => {
    expect(contextOptions().permissions).toEqual([]);
  });

  it('never bypasses certificate validation or CSP (TR-BRW-023)', () => {
    expect(contextOptions().ignoreHTTPSErrors).toBe(false);
    expect(contextOptions().bypassCSP).toBe(false);
  });

  it('blocks service workers and downloads', () => {
    expect(contextOptions().serviceWorkers).toBe('block');
    expect(contextOptions().acceptDownloads).toBe(false);
  });

  it('uses a desktop viewport, because layout decides what renders', () => {
    const viewport = /** @type {any} */ (contextOptions().viewport);

    expect(viewport.width).toBeGreaterThanOrEqual(1024);
    expect(viewport.height).toBeGreaterThanOrEqual(768);
  });

  it('carries no storage state — a session is a credential', () => {
    expect(Object.hasOwn(contextOptions(), 'storageState')).toBe(false);
  });
});

describe('EDR-010 / TR-BRW-040 — headed mode is refused outside development', () => {
  it('refuses under ci and production', () => {
    expect(refuseHeaded(true, 'ci')).toContain('refused');
    expect(refuseHeaded(true, 'production')).toContain('refused');
  });

  it('permits it locally, which is the only reason it exists', () => {
    expect(refuseHeaded(true, 'development')).toBeNull();
    expect(refuseHeaded(true, undefined)).toBeNull();
  });

  it('never refuses headless, in any environment', () => {
    for (const environment of ['ci', 'production', 'development', undefined]) {
      expect(refuseHeaded(false, environment)).toBeNull();
    }
  });

  it('explains WHY rather than just refusing', () => {
    // An operator who hits this needs to know it is a deliberate line, not a
    // missing feature — otherwise the next step is finding a way around it.
    expect(refuseHeaded(true, 'production')).toContain('EDR-010');
  });
});

describe('EDR-012 — route interception', () => {
  const policy = { allowedHosts: ['google.com', 'gstatic.com'] };

  it('blocks the resource types extraction never needs', () => {
    for (const resourceType of BLOCKED_TYPES) {
      expect(decideRoute({ url: 'https://google.com/x', resourceType }).allowed).toBe(false);
    }
  });

  it('ALLOWS stylesheets and scripts, deliberately', () => {
    // Blocking stylesheets is tempting for speed and breaks the
    // layout-dependent visibility determinations extraction relies on.
    // Blocking scripts would leave nothing to extract at all.
    expect(
      decideRoute({ url: 'https://google.com/a.css', resourceType: 'stylesheet' }, policy),
    ).toMatchObject({ allowed: true });
    expect(
      decideRoute({ url: 'https://google.com/a.js', resourceType: 'script' }, policy),
    ).toMatchObject({ allowed: true });
    expect(
      decideRoute({ url: 'https://google.com/api', resourceType: 'xhr' }, policy),
    ).toMatchObject({ allowed: true });
  });

  it('blocks any host outside the allowlist (THREAT-04)', () => {
    // Defence in depth: a compromised page cannot use the runner as a request
    // source. Resource-type filtering alone would permit this.
    expect(
      decideRoute({ url: 'https://evil.example/x', resourceType: 'xhr' }, policy),
    ).toMatchObject({ allowed: false, reason: 'off-allowlist' });
  });

  it('blocks telemetry hosts even when they would otherwise be allowed', () => {
    expect(
      decideRoute(
        { url: 'https://www.google-analytics.com/collect', resourceType: 'xhr' },
        { allowedHosts: ['google-analytics.com'] },
      ),
    ).toMatchObject({ allowed: false, reason: 'telemetry' });
  });

  it('blocks a URL it cannot parse, failing closed', () => {
    expect(decideRoute({ url: 'not a url', resourceType: 'xhr' }, policy)).toMatchObject({
      allowed: false,
      reason: 'unparseable',
    });
  });

  it('blocks everything when the allowlist is empty', () => {
    // The fail-closed reading of "nothing is permitted yet". The alternative —
    // an empty list meaning "allow all" — silently disables the control at
    // exactly the moment a config key gets misspelled.
    expect(decideRoute({ url: 'https://google.com/x', resourceType: 'xhr' }, {}).allowed).toBe(
      false,
    );
  });

  describe('host matching is by suffix, never by substring', () => {
    it('accepts the host itself and its subdomains', () => {
      expect(hostAllowed('google.com', ['google.com'])).toBe(true);
      expect(hostAllowed('maps.google.com', ['google.com'])).toBe(true);
      expect(hostAllowed('MAPS.GOOGLE.COM', ['google.com'])).toBe(true);
    });

    it('REJECTS the lookalikes a substring check would accept', () => {
      // Both of these contain an allowlisted name and are entirely
      // attacker-controlled.
      expect(hostAllowed('google.com.evil.example', ['google.com'])).toBe(false);
      expect(hostAllowed('evil-google.com', ['google.com'])).toBe(false);
      expect(hostAllowed('notgoogle.com', ['google.com'])).toBe(false);
    });
  });

  describe('TR-BRW-030 — blocking is measured', () => {
    it('counts requests and bytes by reason', () => {
      // Controls that are not measured decay silently. Interception can stop
      // working and the only symptom is a slower, heavier run that still
      // produces correct reviews.
      const { counters, record } = createCounters();

      record({ allowed: false, reason: 'resource-type' });
      record({ allowed: false, reason: 'resource-type' });
      record({ allowed: false, reason: 'off-allowlist' });
      record({ allowed: true, reason: 'allowed' }, 2_048);

      expect(counters.blocked_requests).toBe(3);
      expect(counters.allowed_requests).toBe(1);
      expect(counters.allowed_bytes).toBe(2_048);
      expect(counters.blocked_by_reason).toEqual({ 'resource-type': 2, 'off-allowlist': 1 });
    });

    it('starts at zero rather than undefined, so a report is always a number', () => {
      const { counters } = createCounters();

      expect(counters).toMatchObject({
        allowed_requests: 0,
        blocked_requests: 0,
        allowed_bytes: 0,
        blocked_bytes: 0,
      });
    });
  });
});

describe('TR-BRW-057 — a close that throws is swallowed and recorded', () => {
  it('does not propagate the cleanup failure', async () => {
    // Rethrowing would replace the real error with a cleanup error, which is
    // how the actual cause of an incident gets lost: a target fails for one
    // reason, its context fails to close for another, and the report names
    // only the second.
    await expect(
      closeQuietly(() => Promise.reject(new Error('target crashed')), undefined, 'context'),
    ).resolves.toBeUndefined();
  });

  it('records what failed and why', async () => {
    // Swallowed is not silent. Without this line a context that CONSISTENTLY
    // fails to close looks identical to one that closes fine — right up until
    // the shard runs out of memory.
    /** @type {any[]} */
    const events = [];

    await closeQuietly(
      () => Promise.reject(new Error('target crashed')),
      { debug: (event, fields) => events.push([event, fields]) },
      'context',
    );

    expect(events).toEqual([
      ['browser.close_failed', { what: 'context', message: 'target crashed' }],
    ]);
  });

  it('handles a thrown non-Error without throwing itself', async () => {
    // Not every rejection is an Error. A browser process that dies can surface
    // a string or a plain object, and a handler that assumed `.message` would
    // throw inside the very code meant to keep teardown alive.
    /** @type {any[]} */
    const events = [];
    /**
     * @param {unknown} value
     * @returns {Promise<never>}
     */
    const rejectWith = (value) => Promise.reject(value);

    await closeQuietly(
      () => rejectWith('a string'),
      { debug: (event, fields) => events.push([event, fields]) },
      'page',
    );

    expect(events[0][1]).toMatchObject({ message: 'a string' });
  });

  it('stays quiet on the happy path', async () => {
    /** @type {any[]} */
    const events = [];

    await closeQuietly(() => Promise.resolve(), { debug: (event) => events.push(event) }, 'page');

    expect(events).toEqual([]);
  });
});
