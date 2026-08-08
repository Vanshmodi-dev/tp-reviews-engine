/**
 * Selector-pack loading and validation (T-188, TR-SEL-003, TR-SEL-030).
 *
 * ## A malformed pack fails at LOAD, loudly
 *
 * The alternative — discovering it during extraction — produces "mysterious
 * extraction failures later" (TR-SEL-003), and they are genuinely mysterious:
 * a field silently returns nothing, records quarantine, the quarantine rate
 * crosses the gate threshold, and the alert says the *data* is bad. Three
 * layers away from a typo in a JSON file.
 *
 * So the pack is validated before any target executes, and a failure aborts
 * the run rather than degrading it.
 *
 * ## Why some rules live here rather than in the schema
 *
 * JSON Schema can require two strategies. It cannot require that they are of
 * **different kinds** (TR-SEL-010), and it cannot express "not `css` alone"
 * (TR-SEL-011) without enumerating every combination. Both are structural
 * mitigations for IR-03 — a redesign taking out every strategy at once — and
 * both are checked here.
 *
 * The split is deliberate and worth stating: the schema holds the shape, the
 * loader holds the rules the shape cannot express. Neither is optional, and
 * both report the same error class so a caller does not have to care which
 * caught it.
 *
 * @module core/selectors/loader
 */

/** Strategy kinds, most stable first (TRD §20.3). */
export const STRATEGY_KINDS = Object.freeze([
  'role',
  'aria-label-pattern',
  'data-attribute',
  'structural-relative',
  'text-pattern',
  'css',
]);

/** The kind that may never stand alone for a required field. */
const LAST_RESORT_KIND = 'css';

/** Shortest notes that could plausibly explain a strategy (TR-SEL-013). */
const MIN_NOTES_LENGTH = 10;

/** Minimum distinct kinds for a required field (TR-SEL-010). */
const MIN_REQUIRED_KINDS = 2;

/**
 * @typedef {object} LoadResult
 * @property {boolean} ok
 * @property {any} [value]
 * @property {{ code: string, message: string, problems: string[] }} [error]
 */

/**
 * Validates a parsed pack.
 *
 * Returns **every** problem rather than the first. A pack author fixing one
 * rejection per load spends an afternoon on what one message could have said.
 *
 * @param {any} pack
 * @param {{ engineVersion?: string }} [options]
 * @returns {string[]}
 */
export function checkPack(pack, options = {}) {
  /** @type {string[]} */
  const problems = [];

  if (pack === null || typeof pack !== 'object') return ['pack is not an object'];
  if (pack.meta === null || typeof pack.meta !== 'object') problems.push('meta is missing');
  if (pack.fields === null || typeof pack.fields !== 'object') {
    return [...problems, 'fields is missing'];
  }

  problems.push(...checkMeta(pack.meta ?? {}, options));

  for (const [name, field] of Object.entries(pack.fields)) {
    problems.push(...checkField(name, /** @type {any} */ (field)));
  }

  return problems;
}

/**
 * @param {any} meta
 * @param {{ engineVersion?: string }} options
 * @returns {string[]}
 */
function checkMeta(meta, options) {
  const problems = [];

  if (typeof meta.version !== 'string' || !/^v[0-9]+$/u.test(meta.version)) {
    problems.push('meta.version must look like "v1"');
  }

  if (options.engineVersion !== undefined && typeof meta.min_engine_version === 'string') {
    if (compareVersions(meta.min_engine_version, options.engineVersion) > 0) {
      // TR-SEL-031. A pack written against a capability this engine does not
      // have would fail somewhere specific and confusing halfway through a
      // harvest; refusing it here costs one clear message.
      problems.push(
        `pack requires engine ${meta.min_engine_version} but this engine is ${options.engineVersion}`,
      );
    }
  }

  return problems;
}

/**
 * @param {string} name
 * @param {any} field
 * @returns {string[]}
 */
function checkField(name, field) {
  const problems = [];
  const strategies = field?.strategies;

  if (!Array.isArray(strategies) || strategies.length === 0) {
    return [`field "${name}" declares no strategies`];
  }

  for (const [index, strategy] of strategies.entries()) {
    problems.push(...checkStrategy(name, index, strategy));
  }

  if (field.required !== true) return problems;

  const kinds = new Set(strategies.map((strategy) => strategy?.kind));

  if (kinds.size < MIN_REQUIRED_KINDS) {
    // Two `css` strategies are one strategy with a spare. The redesign that
    // breaks the first breaks the second, which is exactly the single point of
    // failure the rule exists to prevent (IR-03).
    problems.push(
      `required field "${name}" declares ${kinds.size} distinct strategy kind(s); ` +
        `at least ${MIN_REQUIRED_KINDS} of DIFFERENT kinds are required (TR-SEL-010)`,
    );
  }

  if (kinds.size === 1 && kinds.has(LAST_RESORT_KIND)) {
    problems.push(
      `required field "${name}" relies on "${LAST_RESORT_KIND}" alone, which is the fastest ` +
        `to write and the first to break (TR-SEL-011)`,
    );
  }

  problems.push(...checkOrdering(name, strategies));

  return problems;
}

/**
 * Strategies must be listed most-stable-first.
 *
 * A new strategy appended for convenience means the pack tries the least
 * reliable option first and records a healthy-looking strategy-0 hit rate while
 * actually depending on `css` (TR-SEL-012).
 *
 * @param {string} name
 * @param {ReadonlyArray<any>} strategies
 * @returns {string[]}
 */
function checkOrdering(name, strategies) {
  const ranks = strategies.map((strategy) => STRATEGY_KINDS.indexOf(strategy?.kind));

  for (let index = 1; index < ranks.length; index += 1) {
    if (/** @type {number} */ (ranks[index]) < /** @type {number} */ (ranks[index - 1])) {
      return [
        `field "${name}" lists "${strategies[index].kind}" after ` +
          `"${strategies[index - 1].kind}"; strategies must be ordered most stable first ` +
          `(TR-SEL-012)`,
      ];
    }
  }

  return [];
}

/**
 * @param {string} field
 * @param {number} index
 * @param {any} strategy
 * @returns {string[]}
 */
function checkStrategy(field, index, strategy) {
  const problems = [];

  if (!STRATEGY_KINDS.includes(strategy?.kind)) {
    problems.push(`field "${field}" strategy ${index} has unknown kind "${strategy?.kind}"`);
  }

  if (typeof strategy?.selector !== 'string' || strategy.selector === '') {
    problems.push(`field "${field}" strategy ${index} has no selector`);
  }

  if (typeof strategy?.notes !== 'string' || strategy.notes.trim().length < MIN_NOTES_LENGTH) {
    // TR-SEL-013. Six months later nobody remembers why strategy 2 exists, and
    // a pack of undocumented selectors cannot be safely edited by anyone who
    // did not write it — which, on a six-month-old pack, is everybody.
    problems.push(
      `field "${field}" strategy ${index} has no usable notes; every strategy must explain ` +
        `what it targets and why it is ranked where it is (TR-SEL-013)`,
    );
  }

  return problems;
}

/**
 * Parses and validates pack text.
 *
 * @param {string} text
 * @param {{ engineVersion?: string, source?: string }} [options]
 * @returns {LoadResult}
 */
export function loadPack(text, options = {}) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return failure([`not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }

  const problems = checkPack(parsed, options);

  if (problems.length > 0) return failure(problems);

  return { ok: true, value: parsed };
}

/**
 * @param {string[]} problems
 * @returns {LoadResult}
 */
function failure(problems) {
  return {
    ok: false,
    error: {
      code: 'ERR-PARSE-SELECTOR-PACK',
      message: `selector pack is unusable: ${problems.length} problem(s)`,
      problems,
    },
  };
}

/**
 * Compares dotted numeric versions.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) return difference > 0 ? 1 : -1;
  }

  return 0;
}
