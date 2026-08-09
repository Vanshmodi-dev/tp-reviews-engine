/**
 * Launch arguments and context options, as a reviewed list (TRD §16.1, §16.2).
 *
 * ## Why this is data in its own file
 *
 * TR-BRW-021: launch arguments MUST be a reviewed, documented list. **An
 * argument added to "make it work" without a recorded reason is a defect** —
 * several plausible-looking Chromium flags materially weaken sandboxing, and
 * they weaken it silently, in a process that still launches and still returns
 * markup.
 *
 * Keeping them here, each with its reason, makes adding one a visible diff in a
 * file whose entire purpose is to be reviewed. Inline in a `launch()` call they
 * are a growing array nobody reads.
 *
 * ## What is deliberately absent
 *
 * TRD §15.4 is a security-review artifact: it documents what the codebase must
 * *not* contain, so an auditor can verify absence rather than infer it. None of
 * the following appears here or anywhere else, and TR-BRW-014 makes adding one
 * a rejectable change:
 *
 * - `--no-sandbox` — the flag most often added to make CI work. It removes the
 *   process boundary between untrusted page content and the runner.
 * - `--ignore-certificate-errors` — TR-BRW-023 forbids bypassing certificate
 *   validation under any configuration or environment variable.
 * - Proxy configuration, fingerprint patching, stealth plugins, input-timing
 *   randomisation — ADR-010: the engine never disguises itself.
 * - `storageState` — a session is a credential and is never persisted.
 *
 * @module adapters/browser/flags
 */

/**
 * Chromium launch arguments.
 *
 * Short list, on purpose. Each entry states what it buys; anything that cannot
 * state one does not belong.
 */
export const LAUNCH_ARGS = Object.freeze([
  // Chromium's shared-memory default is 64 MB, and a review feed with a few
  // hundred nodes exceeds it inside a container — where the symptom is a tab
  // crash mid-pagination, not an error message.
  '--disable-dev-shm-usage',

  // Nothing is ever downloaded. Removing the path removes a file-write surface
  // reachable from untrusted page content (§16.1).
  '--disable-background-downloads',

  // Extensions, default apps, and the first-run experience are request sources
  // and rendering variables the harvest has no use for.
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',

  // Backgrounded renderers get throttled timers, which stalls the scroll loop
  // in a way that looks exactly like a source rate-limiting us.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]);

/** Viewport wide enough that the desktop review layout renders (§16.2). */
export const VIEWPORT = Object.freeze({ width: 1366, height: 900 });

/**
 * Launch options.
 *
 * @param {{ headed?: boolean | undefined }} [options]
 * @returns {Record<string, unknown>}
 */
export function launchOptions(options = {}) {
  return {
    headless: options.headed !== true,
    args: [...LAUNCH_ARGS],
    // Debug aids, pinned off. `slowMo` left unset would be 0 anyway; stating it
    // means a future edit that sets it is a visible change rather than a
    // default drifting.
    devtools: false,
    slowMo: 0,
    chromiumSandbox: true,
  };
}

/**
 * Context options for one target.
 *
 * Locale and timezone come from client configuration and never from the
 * runner's defaults (TR-BRW-022). A runner in UTC harvesting an Indian
 * client's listing renders different relative-date phrasing than the pack's
 * locale expects — and the failure is silent, because unparseable phrases
 * become null estimates rather than errors.
 *
 * @param {{ locale?: string | undefined, timezone?: string | undefined }} [listing]
 * @returns {Record<string, unknown>}
 */
export function contextOptions(listing = {}) {
  return {
    viewport: { ...VIEWPORT },
    locale: listing.locale ?? 'en-GB',
    timezoneId: listing.timezone ?? 'Etc/UTC',
    // Removes animation-driven timing variance from the scroll loop, which is
    // otherwise a source of flakiness that looks like a source problem.
    reducedMotion: 'reduce',
    // §16.2, each one load-bearing:
    permissions: [], //            TR-BRW-024 — no permission is ever granted.
    ignoreHTTPSErrors: false, //   TR-BRW-023 — never bypassed, under any env.
    bypassCSP: false, //           No reason to weaken the page's own defences.
    serviceWorkers: 'block', //    An uncontrolled request source we do not need.
    acceptDownloads: false, //     Nothing is ever downloaded.
    javaScriptEnabled: true, //    The content is not in the initial response.
  };
}

/**
 * Refuses headed mode outside local development (EDR-010, TR-BRW-040).
 *
 * Headed is not merely "the same but visible": it differs in rendering timing
 * and in properties an anti-automation system can inspect. Running it in
 * production would be transparently an attempt to look more human, which is
 * the line ADR-010 draws.
 *
 * Returns the reason rather than throwing, so the CLI can exit 2 with a
 * message rather than a stack trace.
 *
 * @param {boolean} headed
 * @param {string | undefined} environment  `TPRE_ENV`.
 * @returns {string | null}
 */
export function refuseHeaded(headed, environment) {
  if (!headed) return null;
  if (environment !== 'ci' && environment !== 'production') return null;

  return (
    `--headed is refused when TPRE_ENV=${environment}. Headed mode exists only as a local ` +
    `debug aid (EDR-010): it needs a display, roughly doubles memory, and differs from ` +
    `headless in ways that would make an incident impossible to attribute across the fleet.`
  );
}
