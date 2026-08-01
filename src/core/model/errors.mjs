/**
 * The complete error taxonomy — every `ERR-*` class with its retry policy,
 * scope, severity, and runbook.
 *
 * ERR-01: the taxonomy is complete at the end of PH-01, including classes for
 * phases not yet built. A class defined before its producer exists costs
 * nothing; a producer that invents its own class costs a taxonomy — you get
 * `ERR-PARSE-FAILED` alongside `ERR-PARSE-STRUCTURE` and a set that no longer
 * matches the document it came from.
 *
 * ERR-02: every class has exactly one retry policy, one scope, and one
 * severity. `tests/unit/model/errors.taxonomy.test.mjs` asserts that none is
 * missing, and that the set matches SAD Appendix B exactly.
 *
 * The `TABLE` below is deliberately one line per class, in Appendix B's order,
 * so that a reviewer can diff it against the document row by row. That is
 * T-050's stated verification method, and it only works if the shape stays
 * flat.
 *
 * @module core/model/errors
 */

/** Retry strategies. `never` is not "zero attempts" - it is a refusal. */
export const RETRY_STRATEGIES = Object.freeze(['never', 'immediate', 'backoff']);

/** What a failure invalidates. Drives the error envelope's blast radius. */
export const SCOPES = Object.freeze(['record', 'target', 'shard', 'source', 'run']);

/** Alert severity. Ascending. */
export const SEVERITIES = Object.freeze(['info', 'warn', 'error', 'high', 'critical']);

const RUNBOOK_DIR = 'docs/runbooks';
const HTTP_429_BASE_DELAY_MS = 60_000;

/**
 * SAD Appendix B, one row per line, in document order.
 *
 * `r` encodes the retry policy exactly as Appendix B writes it: `n` never,
 * `b<n>` backoff with n attempts, `i<n>` immediate with n attempts.
 *
 * `breaker` marks the two classes Appendix B scopes as "source + breaker".
 * Scope and breaker-opening are modelled separately because they are separate
 * behaviours: the scope says what this failure invalidates, the breaker flag
 * says the source stops being contacted at all.
 *
 * @type {ReadonlyArray<{ code: string, r: string, scope: string, severity: string, runbook: string, breaker?: true }>}
 */
const TABLE = Object.freeze([
  {
    code: 'ERR-POLICY-KILLSWITCH',
    r: 'n',
    scope: 'target',
    severity: 'info',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-POLICY-UNAUTHORIZED',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  { code: 'ERR-POLICY-ROBOTS', r: 'n', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-POLICY-BUDGET', r: 'n', scope: 'target', severity: 'info', runbook: 'stale-client' },
  {
    code: 'ERR-POLICY-BREAKER-OPEN',
    r: 'n',
    scope: 'source',
    severity: 'warn',
    runbook: 'bot-challenge',
  },
  {
    code: 'ERR-CONFIG-INVALID',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  { code: 'ERR-CONFIG-VERSION', r: 'n', scope: 'run', severity: 'error', runbook: 'stale-client' },
  {
    code: 'ERR-CONFIG-SECRET-MISSING',
    r: 'n',
    scope: 'run',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-RESOLVE-NO-IDENTIFIER',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-RESOLVE-NOTFOUND',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-RESOLVE-AMBIGUOUS',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-IDENTITY-DRIFT',
    r: 'n',
    scope: 'target',
    severity: 'high',
    runbook: 'stale-client',
  },
  { code: 'ERR-NET-DNS', r: 'b3', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-NET-TIMEOUT', r: 'b3', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-NET-RESET', r: 'b3', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-NET-TLS', r: 'b2', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-HTTP-429', r: 'b2', scope: 'source', severity: 'high', runbook: 'bot-challenge' },
  { code: 'ERR-HTTP-5XX', r: 'b3', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  { code: 'ERR-HTTP-4XX', r: 'n', scope: 'target', severity: 'error', runbook: 'stale-client' },
  { code: 'ERR-HTTP-403', r: 'n', scope: 'source', severity: 'high', runbook: 'bot-challenge' },
  { code: 'ERR-BROWSER-LAUNCH', r: 'i1', scope: 'run', severity: 'error', runbook: 'stale-client' },
  {
    code: 'ERR-BROWSER-CRASH',
    r: 'b1',
    scope: 'target',
    severity: 'warn',
    runbook: 'stale-client',
  },
  { code: 'ERR-BROWSER-OOM', r: 'n', scope: 'target', severity: 'error', runbook: 'stale-client' },
  { code: 'ERR-NAV-TIMEOUT', r: 'b2', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  {
    code: 'ERR-NAV-SURFACE-NOT-FOUND',
    r: 'n',
    scope: 'target',
    severity: 'high',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-NAV-CONSENT-WALL',
    r: 'n',
    scope: 'source',
    severity: 'high',
    runbook: 'bot-challenge',
  },
  { code: 'ERR-BUDGET-TARGET', r: 'n', scope: 'target', severity: 'warn', runbook: 'stale-client' },
  {
    code: 'ERR-BLOCKED-CHALLENGE',
    r: 'n',
    scope: 'source',
    severity: 'critical',
    runbook: 'bot-challenge',
    breaker: true,
  },
  {
    code: 'ERR-BLOCKED-UNUSUAL-TRAFFIC',
    r: 'n',
    scope: 'source',
    severity: 'critical',
    runbook: 'bot-challenge',
    breaker: true,
  },
  { code: 'ERR-BLOCKED-GEO', r: 'n', scope: 'source', severity: 'warn', runbook: 'bot-challenge' },
  {
    code: 'ERR-PARSE-STRUCTURE',
    r: 'n',
    scope: 'target',
    severity: 'high',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-PARSE-EMPTY-UNEXPECTED',
    r: 'n',
    scope: 'target',
    severity: 'high',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-PARSE-FIELD-REQUIRED',
    r: 'n',
    scope: 'record',
    severity: 'warn',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-PARSE-RATING-INVALID',
    r: 'n',
    scope: 'record',
    severity: 'warn',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-PARSE-SELECTOR-PACK',
    r: 'n',
    scope: 'run',
    severity: 'error',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-CLEAN-MARKUP-SURVIVED',
    r: 'n',
    scope: 'record',
    severity: 'critical',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-VALIDATE-QUARANTINE-RATE',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-VALIDATE-AGGREGATE',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-STATE-CORRUPT',
    r: 'n',
    scope: 'target',
    severity: 'high',
    runbook: 'disaster-recovery',
  },
  {
    code: 'ERR-STATE-WRITE',
    r: 'b2',
    scope: 'target',
    severity: 'error',
    runbook: 'disaster-recovery',
  },
  {
    code: 'ERR-GATE-REJECT-COUNT-DROP',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-GATE-REJECT-RATING-SHIFT',
    r: 'n',
    scope: 'target',
    severity: 'error',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-GATE-REJECT-EMPTY',
    r: 'n',
    scope: 'target',
    severity: 'critical',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-GATE-REJECT-COVERAGE',
    r: 'n',
    scope: 'target',
    severity: 'warn',
    runbook: 'selector-break',
  },
  {
    code: 'ERR-GATE-REJECT-SCHEMA',
    r: 'n',
    scope: 'target',
    severity: 'critical',
    runbook: 'stale-client',
  },
  {
    code: 'ERR-PUBLISH-CONFLICT',
    r: 'b3',
    scope: 'shard',
    severity: 'warn',
    runbook: 'publish-conflict',
  },
  {
    code: 'ERR-PUBLISH-AUTH',
    r: 'n',
    scope: 'run',
    severity: 'critical',
    runbook: 'publish-conflict',
  },
  {
    code: 'ERR-INTERNAL-INVARIANT',
    r: 'n',
    scope: 'run',
    severity: 'critical',
    runbook: 'disaster-recovery',
  },
  {
    code: 'ERR-INTERNAL-UNCLASSIFIED',
    r: 'n',
    scope: 'target',
    severity: 'critical',
    runbook: 'disaster-recovery',
  },
]);

const NEVER = Object.freeze({ strategy: 'never', maxAttempts: 0 });

/**
 * Expands Appendix B's shorthand into an explicit policy.
 *
 * `never` carries `maxAttempts: 0`, not `1`. X-10 forbids adding a retry to any
 * `ERR-BLOCKED-*` path, and a policy that reads "one attempt" invites someone
 * to make it two. Zero attempts *after the first* is the honest encoding.
 *
 * @param {string} code
 * @param {string} encoded
 * @returns {{ strategy: string, maxAttempts: number, baseDelayMs?: number }}
 */
function expandRetry(code, encoded) {
  if (encoded === 'n') return NEVER;

  const strategy = encoded.startsWith('b') ? 'backoff' : 'immediate';
  const maxAttempts = Number(encoded.slice(1));

  // ERR-HTTP-429 is the one class Appendix B gives an explicit base delay:
  // "b x2 (60 s base)". Backing off in milliseconds against a source that
  // asked for a minute is how a rate limit becomes a block.
  return code === 'ERR-HTTP-429'
    ? Object.freeze({ strategy, maxAttempts, baseDelayMs: HTTP_429_BASE_DELAY_MS })
    : Object.freeze({ strategy, maxAttempts });
}

/**
 * @typedef {object} ErrorClass
 * @property {string} code        The `ERR-*` identifier.
 * @property {{ strategy: string, maxAttempts: number, baseDelayMs?: number }} retry
 * @property {string} scope       What this failure invalidates.
 * @property {string} severity    Alert severity.
 * @property {boolean} opensBreaker  Whether observing this stops the source being contacted.
 * @property {string} runbook     Path to the document an on-call engineer should open.
 */

/** @type {Record<string, ErrorClass>} */
const built = {};

for (const row of TABLE) {
  built[row.code] = Object.freeze({
    code: row.code,
    retry: expandRetry(row.code, row.r),
    scope: row.scope,
    severity: row.severity,
    opensBreaker: row.breaker === true,
    runbook: `${RUNBOOK_DIR}/${row.runbook}.md`,
  });
}

/** Every error class, keyed by code. */
export const ERROR_CLASSES = Object.freeze(built);

/** Every code, in SAD Appendix B order. */
export const ERROR_CODES = Object.freeze(TABLE.map((row) => row.code));

/**
 * The classes that get special treatment (§26.3): they stop the target
 * immediately, are always recorded to health, raise a `critical` alert, and
 * must never reach a visitor.
 */
export const CRITICAL_CODES = Object.freeze(
  ERROR_CODES.filter((code) => ERROR_CLASSES[code]?.severity === 'critical'),
);

/**
 * Codes that must never acquire a retry path (X-10, INV-07). A challenge is a
 * stop signal, not a puzzle — not even one attempt "to see if it clears".
 */
export const BLOCKED_CODES = Object.freeze(
  ERROR_CODES.filter((code) => code.startsWith('ERR-BLOCKED-')),
);

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isErrorCode(code) {
  return Object.hasOwn(ERROR_CLASSES, code);
}

/**
 * Looks up a class, or `undefined` if the code is unknown.
 *
 * Callers that reach this with an unknown code have invented one, and the
 * correct response is `ERR-INTERNAL-UNCLASSIFIED` rather than a fabricated
 * entry — which is why this does not synthesise a default.
 *
 * @param {string} code
 * @returns {ErrorClass | undefined}
 */
export function getErrorClass(code) {
  return ERROR_CLASSES[code];
}

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isRetryable(code) {
  return ERROR_CLASSES[code]?.retry.strategy !== 'never';
}
