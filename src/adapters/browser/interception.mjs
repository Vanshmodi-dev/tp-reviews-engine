/**
 * Route interception: a host allowlist AND a resource-type denylist (EDR-012).
 *
 * ## Two filters, because either alone leaves a real hole
 *
 * Resource-type filtering alone permits requests to arbitrary hosts, which
 * leaves the runner usable as a request source by a compromised page
 * (THREAT-04). A host allowlist alone permits megabytes of images from an
 * allowlisted host, losing the 60–80% byte reduction that makes the harvest
 * affordable and polite.
 *
 * So both run, and both are counted.
 *
 * ## Why the policy is a pure function
 *
 * The decision — block or allow, and why — is arithmetic over a URL and a
 * resource type. Making it pure means every rule can be tested without
 * launching Chromium, which is what lets the *interesting* cases be covered:
 * the analytics host that looks like the CDN, the subdomain that merely
 * contains an allowlisted name, the stylesheet that must be allowed.
 *
 * The adapter's job is then only to attach it to `page.route` and add up bytes.
 *
 * ## Measurement is the point (TR-BRW-030)
 *
 * Controls that are not measured decay silently. Interception can stop working
 * — a config typo, a source moving to a new CDN — and the only visible symptom
 * is a slower, heavier run that still produces correct reviews. So the counters
 * are part of the acquisition report, not a debug aid.
 *
 * @module adapters/browser/interception
 */

/**
 * Resource types that are never needed for extraction (§16.3).
 *
 * Stylesheets are deliberately **allowed**: blocking them is tempting for speed
 * and breaks the layout-dependent visibility determinations extraction relies
 * on. Scripts are allowed because the content is not in the initial response —
 * blocking them would leave nothing to extract.
 */
export const BLOCKED_TYPES = Object.freeze(['image', 'media', 'font']);

/** Substrings that mark a host as telemetry, wherever it is hosted. */
export const TELEMETRY_MARKERS = Object.freeze([
  'google-analytics.',
  'googletagmanager.',
  'doubleclick.',
  'googlesyndication.',
  'facebook.',
  'hotjar.',
  'segment.io',
  'sentry.io',
  'mixpanel.',
]);

/**
 * @typedef {object} Decision
 * @property {boolean} allowed
 * @property {'allowed' | 'resource-type' | 'off-allowlist' | 'telemetry' | 'unparseable'} reason
 */

/**
 * Whether a host is the allowlisted host or a subdomain of it.
 *
 * Suffix matching with an explicit dot, never `includes`. `evil-lh3.example`
 * and `lh3.example.attacker.test` both contain an allowlisted name and are
 * both entirely attacker-controlled.
 *
 * @param {string} host
 * @param {ReadonlyArray<string>} allowlist
 * @returns {boolean}
 */
export function hostAllowed(host, allowlist) {
  const target = host.toLowerCase();

  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase();

    return target === allowed || target.endsWith(`.${allowed}`);
  });
}

/**
 * Decides one request.
 *
 * @param {{ url: string, resourceType: string }} request
 * @param {{ allowedHosts?: ReadonlyArray<string>, blockedTypes?: ReadonlyArray<string> }} policy
 * @returns {Decision}
 */
export function decideRoute(request, policy = {}) {
  const blocked = policy.blockedTypes ?? BLOCKED_TYPES;

  if (blocked.includes(request.resourceType)) {
    return { allowed: false, reason: 'resource-type' };
  }

  let host;

  try {
    host = new URL(request.url).hostname;
  } catch {
    // A request whose URL will not parse is not a request we can reason about.
    // Blocking it is the only answer that fails closed.
    return { allowed: false, reason: 'unparseable' };
  }

  if (TELEMETRY_MARKERS.some((marker) => host.toLowerCase().includes(marker))) {
    return { allowed: false, reason: 'telemetry' };
  }

  // TR-BRW-032: the allowlist is configuration, so adding a source in v2.0
  // does not mean touching the browser adapter. An empty allowlist blocks
  // everything, which is the correct fail-closed reading of "nothing is
  // permitted yet" — the alternative silently disables the control.
  if (!hostAllowed(host, policy.allowedHosts ?? [])) {
    return { allowed: false, reason: 'off-allowlist' };
  }

  return { allowed: true, reason: 'allowed' };
}

/**
 * @typedef {object} InterceptionCounters
 * @property {number} allowed_requests
 * @property {number} blocked_requests
 * @property {number} allowed_bytes
 * @property {number} blocked_bytes    Estimated; a blocked request is never fetched.
 * @property {Record<string, number>} blocked_by_reason
 */

/**
 * A counter set for one target.
 *
 * @returns {{ counters: InterceptionCounters, record: (decision: Decision, bytes?: number) => void }}
 */
export function createCounters() {
  /** @type {InterceptionCounters} */
  const counters = {
    allowed_requests: 0,
    blocked_requests: 0,
    allowed_bytes: 0,
    blocked_bytes: 0,
    blocked_by_reason: {},
  };

  return {
    counters,
    record(decision, bytes = 0) {
      if (decision.allowed) {
        counters.allowed_requests += 1;
        counters.allowed_bytes += bytes;

        return;
      }

      counters.blocked_requests += 1;
      counters.blocked_bytes += bytes;
      counters.blocked_by_reason[decision.reason] =
        (counters.blocked_by_reason[decision.reason] ?? 0) + 1;
    },
  };
}
