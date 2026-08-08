/**
 * Layer 5 — the environment, and the rejection of unknown variables
 * (T-160, EDR-006, IR-16).
 *
 * ============================================================================
 * AN UNKNOWN `TPRE_*` VARIABLE IS A STARTUP ERROR, NEVER IGNORED.
 * ============================================================================
 *
 * ## Why silence is the wrong default
 *
 * The conventional loader reads the variables it knows and ignores the rest.
 * Applied here, that means an operator who sets `TPRE_MAX_REVIEW=2000` — the
 * singular, a plausible typo — gets a run that succeeds, reports success, and
 * harvests the default 1,000 reviews. Nothing is wrong anywhere in the output.
 * The operator believes the setting took effect, and every number they reason
 * about afterwards is measured against an intent the engine never received.
 *
 * That is the same failure class as a silently tolerated CLI flag
 * (TR-CLI-006), and both exit 2.
 *
 * ## And the rejection names the nearest match
 *
 * Rejecting without a suggestion converts a typo into a search through the
 * documentation. The engine already knows every valid name, so it can say which
 * one was probably meant.
 *
 * @module app/config/environment
 */

import { defaultKeyPaths } from './defaults.mjs';

/** The prefix that marks a variable as ours. */
export const PREFIX = 'TPRE_';

/**
 * Variables that configure the *run* rather than a config key.
 *
 * They are recognised so they are not rejected, and deliberately not merged
 * into the config: force flags in particular must reach the gate as an explicit
 * request, not as a threshold somebody quietly lowered.
 */
export const RUN_VARIABLES = Object.freeze([
  'TPRE_FORCE_PUBLISH',
  'TPRE_FORCE_REASON',
  'TPRE_LOG_LEVEL',
  'TPRE_SHARD_INDEX',
  'TPRE_SHARD_COUNT',
  'TPRE_DRY_RUN',
]);

/**
 * `TPRE_NAV_MAX_REVIEWS` names `nav.max_reviews`.
 *
 * @param {string} path Dotted config path.
 * @returns {string}
 */
export function variableNameFor(path) {
  return `${PREFIX}${path.replaceAll('.', '_').toUpperCase()}`;
}

/**
 * Every variable name this engine understands.
 *
 * Derived from the defaults, so a key added there is automatically accepted
 * here. A hand-maintained list is a list that goes stale, and the symptom of a
 * stale list is a valid variable rejected at startup.
 *
 * @returns {Map<string, string>} Variable name to config path.
 */
export function knownVariables() {
  return new Map(defaultKeyPaths().map((path) => [variableNameFor(path), path]));
}

/**
 * Coerces an environment string to the type its default implies.
 *
 * Environment variables are always strings; the config is typed. Coercing
 * against the default's type rather than guessing means `TPRE_DISPLAY_ORDER`
 * stays a string while `TPRE_NAV_MAX_REVIEWS` becomes a number, with no
 * per-key table to maintain.
 *
 * @param {string} raw
 * @param {unknown} defaultValue
 * @returns {{ ok: true, value: unknown } | { ok: false, expected: string }}
 */
export function coerce(raw, defaultValue) {
  if (typeof defaultValue === 'number') {
    const value = Number(raw);

    // `Number('')` is 0 and `Number('abc')` is NaN. Both would otherwise become
    // a configured value that nobody typed.
    if (raw.trim() === '' || Number.isNaN(value)) return { ok: false, expected: 'a number' };

    return { ok: true, value };
  }

  if (typeof defaultValue === 'boolean') {
    const normalised = raw.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalised)) return { ok: true, value: true };
    if (['false', '0', 'no', 'off'].includes(normalised)) return { ok: true, value: false };

    return { ok: false, expected: 'a boolean (true/false)' };
  }

  // Arrays are comma-separated, and REPLACE rather than extend, exactly as the
  // merge rule requires (TR-CFG-020).
  if (Array.isArray(defaultValue)) {
    return {
      ok: true,
      value: raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
  }

  return { ok: true, value: raw };
}

/**
 * Levenshtein distance, for the "did you mean" suggestion.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  /** @type {number[]} */
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution =
        /** @type {number} */ (previous[j - 1]) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = /** @type {number} */ (previous[j]) + 1;
      const insertion = /** @type {number} */ (current[j - 1]) + 1;

      current.push(Math.min(substitution, deletion, insertion));
    }

    previous = current;
  }

  return /** @type {number} */ (previous[b.length]);
}

/** How far a suggestion may be before it stops being helpful. */
const MAX_SUGGESTION_DISTANCE = 5;

/**
 * The closest known variable to an unknown one.
 *
 * @param {string} unknown
 * @param {Iterable<string>} known
 * @returns {string | null}
 */
export function nearestVariable(unknown, known) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of known) {
    const distance = editDistance(unknown, candidate);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= MAX_SUGGESTION_DISTANCE ? best : null;
}

/**
 * Reads the environment layer.
 *
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, any>} defaults Used for type coercion.
 * @returns {{ values: Record<string, any>, errors: string[], run: Record<string, string> }}
 */
export function readEnvironment(env, defaults) {
  const known = knownVariables();
  /** @type {Record<string, any>} */
  const values = {};
  /** @type {Record<string, string>} */
  const run = {};
  /** @type {string[]} */
  const errors = [];

  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith(PREFIX) || raw === undefined) continue;

    if (RUN_VARIABLES.includes(name)) {
      run[name] = raw;
      continue;
    }

    const path = known.get(name);

    if (path === undefined) {
      const suggestion = nearestVariable(name, [...known.keys(), ...RUN_VARIABLES]);

      errors.push(
        suggestion === null
          ? `unknown environment variable ${name}`
          : `unknown environment variable ${name}; did you mean ${suggestion}?`,
      );
      continue;
    }

    const coerced = coerce(raw, readDefault(defaults, path));

    if (!coerced.ok) {
      errors.push(`${name} must be ${coerced.expected}, got ${JSON.stringify(raw)}`);
      continue;
    }

    writePath(values, path, coerced.value);
  }

  return { values, errors, run };
}

/**
 * @param {Record<string, any>} source
 * @param {string} path
 * @returns {unknown}
 */
function readDefault(source, path) {
  let current = /** @type {any} */ (source);

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }

  return current;
}

/**
 * @param {Record<string, any>} target
 * @param {string} path
 * @param {unknown} value
 * @returns {void}
 */
function writePath(target, path, value) {
  const segments = path.split('.');
  const last = /** @type {string} */ (segments.pop());
  let current = target;

  for (const segment of segments) {
    if (current[segment] === undefined) current[segment] = {};
    current = current[segment];
  }

  current[last] = value;
}
