/**
 * Sink-level redaction (T-131, EDR-031, INV-08).
 *
 * ============================================================================
 * THIS FILE IS A SECURITY CONTROL. IT REQUIRES 100% STATEMENT COVERAGE
 * (TR-LOG-022), AND A FAILURE HERE IS NOT ROLLED BACK — IT IS CORRECTED
 * FORWARD, BECAUSE A LEAKED SECRET IN A PUBLIC REPOSITORY CANNOT BE UNLEAKED.
 * ============================================================================
 *
 * ## Why redaction lives here and not at the call site
 *
 * The conventional approach asks every call site to avoid logging secrets. That
 * works until one call site logs a whole config object — and one omission is a
 * permanent secret exposure in a public repository. Human discipline is not a
 * control for an irreversible failure.
 *
 * So `log.debug({ detail: effectiveConfig })` must be safe **by construction**.
 * Avoiding the leak is not the caller's responsibility, which is the only
 * arrangement that survives a careless afternoon.
 *
 * ## The ordering rule that makes it work (TR-LOG-021, LOG-ORD-01)
 *
 * The filter is seeded with every secret value at startup, in step 4 of the boot
 * sequence, and the logger is constructed in step 5. **That order is not
 * negotiable**: a logger constructed before the filter is seeded can emit a
 * secret in its own startup event, and IR-21 is exactly that mistake.
 *
 * ## Four independent mechanisms
 *
 * Any one of them can miss; they are layered because they miss different things.
 *
 * 1. **Known values.** Exact and substring matches of seeded secrets, at any
 *    depth and in any position — including embedded in a URL or an error
 *    message, which a key-name check would never see.
 * 2. **Key names.** Any key matching the sensitive pattern has its value
 *    replaced regardless of content, which catches a secret this process never
 *    read and therefore could not have been seeded with.
 * 3. **Structural rules.** Authorization headers and cookies are dropped
 *    outright, at every level. There is no legitimate reason to log either.
 * 4. **Data minimisation.** Review text is truncated and author names are
 *    reduced to a key prefix. Logs are not a data store; the payload is where
 *    review text belongs.
 *
 * @module infra/logger/redact
 */

/**
 * Keys whose value is replaced whatever it contains.
 *
 * Deliberately broad. A false positive redacts something harmless and costs a
 * debugging session a little context; a false negative publishes a credential.
 * Those are not symmetric, and the pattern is tuned accordingly.
 */
const SENSITIVE_KEY = /token|secret|key|password|cookie|auth|credential|refresh/iu;

/**
 * Keys dropped entirely rather than masked.
 *
 * Masking still records that the field existed and how long it was. For these
 * there is no reason to record even that.
 */
const FORBIDDEN_KEY = /^(authorization|cookie|set-cookie|storage_state|storagestate)$/iu;

/** Review text is truncated to this many characters (TRD §37). */
export const TEXT_LIMIT = 120;

/** Author identifiers are logged as this many hex characters, never as names. */
export const AUTHOR_KEY_PREFIX = 8;

/** Keys treated as review text for truncation purposes. */
const TEXT_KEY = /^(text|review_text|body|reviewbody|snippet)$/iu;

/** Keys treated as an author name. Never logged in full. */
const AUTHOR_NAME_KEY = /^(author_name|authorname|reviewer_name|name)$/iu;

/** How deep a structure is walked before it is replaced wholesale. */
const MAX_DEPTH = 8;

/** Shortest secret worth substring-matching. */
const MIN_SECRET_LENGTH = 6;

/** The marker a redacted value is replaced with. */
const mask = (/** @type {string} */ label) => `«redacted:${label}»`;

/**
 * Query parameters that may survive in a logged URL.
 *
 * Everything else is stripped, because a query string is where a signed URL
 * keeps its signature and where an OAuth flow keeps its code. The allowlist
 * exists so avatar sizing parameters stay legible in diagnostics.
 */
const ALLOWED_QUERY_PARAMS = Object.freeze(['w', 'h', 's', 'size', 'sz']);

/**
 * A redactor seeded with the run's secrets.
 *
 * @typedef {object} Redactor
 * @property {(value: unknown) => unknown} redact  Applies every rule, at every depth.
 * @property {(text: string) => string} scrub      Applies the value rules to a bare string.
 * @property {number} secretCount                  How many values were seeded.
 */

/**
 * Builds a redactor.
 *
 * Secrets arrive as `{ NAME: value }` so the replacement can name which secret
 * was seen — `«redacted:GITHUB_TOKEN»` tells an engineer which credential leaked
 * into a log line, which is exactly what they need to know to rotate it.
 *
 * Values shorter than {@link MIN_SECRET_LENGTH} are seeded for exact matching
 * but not substring matching. A two-character secret would otherwise match
 * inside ordinary prose and turn every log line into redaction confetti, which
 * is its own kind of failure: an unreadable log is not consulted.
 *
 * @param {Record<string, unknown>} [secrets]
 * @returns {Redactor}
 */
export function createRedactor(secrets = {}) {
  /** @type {{ value: string, label: string }[]} */
  const seeded = [];

  for (const [label, value] of Object.entries(secrets)) {
    if (typeof value !== 'string' || value === '') continue;

    seeded.push({ value, label });
  }

  // Longest first, so a secret that contains another secret is replaced whole
  // rather than leaving a fragment of itself behind.
  seeded.sort((a, b) => b.value.length - a.value.length);

  /**
   * @param {string} text
   * @returns {string}
   */
  const scrub = (text) => {
    let output = text;

    for (const { value, label } of seeded) {
      if (value.length < MIN_SECRET_LENGTH) {
        if (output === value) output = mask(label);
        continue;
      }

      if (output.includes(value)) output = output.split(value).join(mask(label));
    }

    return output;
  };

  return {
    secretCount: seeded.length,
    scrub,
    redact: (value) => walk(value, scrub, 0),
  };
}

/**
 * @param {unknown} value
 * @param {(text: string) => string} scrub
 * @param {number} depth
 * @returns {unknown}
 */
function walk(value, scrub, depth) {
  if (depth > MAX_DEPTH) return mask('depth');

  const primitive = walkPrimitive(value, scrub);
  if (primitive !== NOT_PRIMITIVE) return primitive;

  if (value instanceof Error) return walkError(value, scrub, depth);
  if (Array.isArray(value)) return value.map((entry) => walk(entry, scrub, depth + 1));
  if (value instanceof Map) return walkEntries([...value.entries()], scrub, depth);
  if (value instanceof Set) return [...value].map((entry) => walk(entry, scrub, depth + 1));
  if (value instanceof Date) return value.toISOString();

  return walkEntries(Object.entries(/** @type {Record<string, unknown>} */ (value)), scrub, depth);
}

/** Distinguishes "this was not a primitive" from a primitive that IS undefined. */
const NOT_PRIMITIVE = Symbol('not-primitive');

/**
 * Everything that is not walked structurally.
 *
 * A `bigint` is stringified because `JSON.stringify` throws on one, and a logger
 * that throws while reporting a failure loses the failure.
 *
 * @param {unknown} value
 * @param {(text: string) => string} scrub
 * @returns {unknown} {@link NOT_PRIMITIVE} when the value needs a structural walk.
 */
function walkPrimitive(value, scrub) {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return scrub(stripUrlQuery(value));
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'function':
      return mask('function');
    case 'symbol':
      return mask('symbol');
    default:
      return NOT_PRIMITIVE;
  }
}

/**
 * An Error carries its message and stack, and both routinely contain the
 * request that failed — which is where a token in a URL ends up.
 *
 * @param {Error} error
 * @param {(text: string) => string} scrub
 * @param {number} depth
 * @returns {Record<string, unknown>}
 */
function walkError(error, scrub, depth) {
  return {
    name: error.name,
    message: scrub(stripUrlQuery(error.message)),
    stack: typeof error.stack === 'string' ? scrub(error.stack) : null,
    ...(error.cause === undefined ? {} : { cause: walk(error.cause, scrub, depth + 1) }),
  };
}

/**
 * @param {ReadonlyArray<[unknown, unknown]>} entries
 * @param {(text: string) => string} scrub
 * @param {number} depth
 * @returns {Record<string, unknown>}
 */
function walkEntries(entries, scrub, depth) {
  /** @type {Record<string, unknown>} */
  const output = {};

  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey);

    // Dropped entirely rather than masked: there is no reason to record even
    // that an Authorization header was present.
    if (FORBIDDEN_KEY.test(key)) continue;

    // The KEY is scrubbed too, and it is not a theoretical concern: a Map keyed
    // by API token, or an object built with a credential as a property name,
    // serialises that credential into the output exactly as a value would. The
    // rules below still match on the original key, because what a field means is
    // decided by its real name rather than by its redacted form.
    output[scrub(key)] = redactByKey(key, rawValue, scrub, depth);
  }

  return output;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {(text: string) => string} scrub
 * @param {number} depth
 * @returns {unknown}
 */
function redactByKey(key, value, scrub, depth) {
  if (SENSITIVE_KEY.test(key)) return mask(key);
  if (typeof value === 'string' && TEXT_KEY.test(key)) return truncate(scrub(value));
  if (typeof value === 'string' && AUTHOR_NAME_KEY.test(key)) return mask('author');

  return walk(value, scrub, depth + 1);
}

/**
 * Truncates review text (TRD §37).
 *
 * A data-minimisation control, not a formatting preference: full review text
 * lives in the payload, which is its proper home. A log that accumulates review
 * bodies is a second, unmanaged copy of personal data with a different
 * retention policy and no erasure path.
 *
 * @param {string} text
 * @returns {string}
 */
export function truncate(text) {
  const characters = [...text];

  return characters.length <= TEXT_LIMIT ? text : `${characters.slice(0, TEXT_LIMIT).join('')}…`;
}

/**
 * Strips a URL query string, keeping only allowlisted parameters.
 *
 * A query string is where a signed URL keeps its signature and where an OAuth
 * redirect keeps its code, so the default is to remove it. Sizing parameters are
 * allowed through because an avatar URL without them is useless in diagnostics.
 *
 * Anything that is not a parseable absolute URL is returned untouched — this is
 * a URL rule, and prose containing a question mark is not a URL.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripUrlQuery(text) {
  if (!/^https?:\/\//iu.test(text)) return text;

  let url;
  try {
    url = new URL(text);
  } catch {
    // Not parseable, so not a URL this rule can reason about. Left alone rather
    // than guessed at; the value rules still apply to it downstream.
    return text;
  }

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (ALLOWED_QUERY_PARAMS.includes(key.toLowerCase())) kept.set(key, value);
  }

  url.search = kept.toString();
  url.hash = '';

  return url.toString();
}

/**
 * An author identifier reduced to a hash prefix (TRD §37).
 *
 * Enough to correlate two events about the same reviewer within a run; not
 * enough to identify them. Author names are never logged in plain form.
 *
 * @param {string} authorKey
 * @returns {string}
 */
export function authorKeyPrefix(authorKey) {
  return authorKey.slice(0, AUTHOR_KEY_PREFIX);
}
