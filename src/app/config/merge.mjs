/**
 * Layered merge, and the resolution trace (T-158…T-162, TR-CFG-020…024).
 *
 * ## Objects merge deeply; arrays REPLACE
 *
 * TR-CFG-020, and the asymmetry is deliberate. An operator who writes
 * `display.languages: ["en"]` in a client config means "publish English
 * reviews", not "add English to whatever the profile listed". A partially
 * merged array is never what anybody means, and it fails in the worst way:
 * quietly, producing a list that appears in no configuration file, that nobody
 * chose, and that an operator reading their own config cannot see.
 *
 * ## The trace exists because six layers is too many to hold in your head
 *
 * During an incident, "why did this client use a three-minute timeout?" must be
 * answerable in one command. Six layers means the effective value of any key is
 * the outcome of a computation nobody watched — so the loader records, per key,
 * which layer won and what it won with.
 *
 * **Secret values never appear in the trace** (TR-CFG-024). They are rendered
 * `«set»` or `«unset»`, because the trace is written into the diagnostics
 * bundle, and a diagnostics bundle is attached to issues.
 *
 * @module app/config/merge
 */

/** The six layers, weakest first. A later layer wins key by key. */
export const LAYERS = Object.freeze([
  'defaults',
  'profile',
  'client',
  'listing',
  'environment',
  'flags',
]);

/** Keys whose value is a secret and must never be traced. */
const SECRET_KEY = /token|secret|key|password|credential/iu;

/**
 * Whether a value should be merged into, rather than replacing.
 *
 * Arrays are excluded on purpose — see the module header.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isMergeable(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merges `overlay` onto `base`, replacing arrays wholesale.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, any>} overlay
 * @returns {Record<string, any>}
 */
export function mergeLayer(base, overlay) {
  /** @type {Record<string, any>} */
  const output = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    // `undefined` means "this layer said nothing", which is different from
    // `null`, which means "this layer explicitly chose the empty value".
    if (value === undefined) continue;

    output[key] =
      isMergeable(value) && isMergeable(base[key]) ? mergeLayer(base[key], value) : value;
  }

  return output;
}

/**
 * @typedef {object} TraceEntry
 * @property {string} layer  Which layer supplied the winning value.
 * @property {unknown} value The winning value, or a secret placeholder.
 */

/**
 * Merges every layer and records where each key came from.
 *
 * @param {{ layer: string, values: Record<string, any> }[]} layers Weakest first.
 * @returns {{ config: Record<string, any>, trace: Record<string, TraceEntry> }}
 */
export function resolveLayers(layers) {
  /** @type {Record<string, any>} */
  let config = {};
  /** @type {Record<string, TraceEntry>} */
  const trace = {};

  for (const { layer, values } of layers) {
    config = mergeLayer(config, values);

    for (const path of leafPaths(values)) {
      trace[path] = { layer, value: traceValue(path, readPath(values, path)) };
    }
  }

  return { config, trace };
}

/**
 * Every leaf path in an object, dotted.
 *
 * A `null` is a leaf, not a branch: `display.min_rating: null` is a decision.
 *
 * @param {Record<string, any>} source
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function leafPaths(source, prefix = '') {
  /** @type {string[]} */
  const paths = [];

  for (const [key, value] of Object.entries(source)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;

    if (isMergeable(value)) {
      paths.push(...leafPaths(value, path));
      continue;
    }

    paths.push(path);
  }

  return paths;
}

/**
 * @param {Record<string, any>} source
 * @param {string} path
 * @returns {unknown}
 */
export function readPath(source, path) {
  let current = /** @type {any} */ (source);

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }

  return current;
}

/**
 * The value as it appears in the trace.
 *
 * A secret is rendered `«set»` or `«unset»` — never its value. The trace goes
 * into the diagnostics bundle, and the bundle gets attached to issues.
 *
 * @param {string} path
 * @param {unknown} value
 * @returns {unknown}
 */
function traceValue(path, value) {
  if (!SECRET_KEY.test(path)) return value;

  return value === undefined || value === null || value === '' ? '«unset»' : '«set»';
}

/**
 * Deeply freezes a resolved config (TR-CFG-023, EDR-005).
 *
 * The config is read by every stage of a run, and a stage that could mutate it
 * would make the resolution trace a record of what the config *was* rather than
 * of what it is. Freezing turns "nobody mutates the config" from a convention
 * into a thrown error.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);

  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(/** @type {any} */ (value)[key]);
  }

  return value;
}
