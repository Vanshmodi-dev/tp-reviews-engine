/**
 * A bounded CSS-selector subset over the parsed tree (TR-EXT-030).
 *
 * ## Why a subset, and why the boundary is enforced
 *
 * Selector packs are authored by operators, and the strategies in them are
 * plain selector strings. Supporting all of CSS would mean shipping a selector
 * engine in `core/`, which is a large amount of code whose failure mode is a
 * selector that silently matches the wrong element.
 *
 * So the subset is explicit: tag, `#id`, `.class`, `[attr]`, `[attr=value]`
 * with `^=`, `$=` and `*=`, `*`, the descendant and child combinators, and
 * comma groups. Anything outside it — `:nth-child`, `~`, `+`, functional
 * pseudo-classes — is **rejected at parse time**, not ignored.
 *
 * Rejection matters more than support. A silently-ignored `:not(.reply)` would
 * make a strategy match owner replies as well as reviews, and the pack author
 * would have no way to discover it: the selector looks right, the extraction
 * looks plausible, and the ratings are wrong. `resolveField` treats a throwing
 * strategy as a strategy that did not work, so an unsupported selector falls
 * through to the next one and shows up in the strategy histogram.
 *
 * @module core/extract/query
 */

/**
 * @typedef {object} AttributeTest
 * @property {string} name
 * @property {'exists' | '=' | '^=' | '$=' | '*='} operator
 * @property {string} value
 */

/**
 * @typedef {object} Compound
 * @property {string | null} tag
 * @property {string[]} classes
 * @property {string | null} id
 * @property {AttributeTest[]} attributes
 */

/** @typedef {{ compound: Compound, combinator: ' ' | '>' }} Step */

/** Matches one compound selector, anchored. */
const COMPOUND = /^(\*|[A-Za-z][\w-]*)?((?:[#.][\w-]+|\[[^\]]*\])*)$/u;

/** Matches one `#id`, `.class`, or `[attr…]` piece. */
const PIECE = /[#.][\w-]+|\[[^\]]*\]/gu;

/**
 * One compound, or a bare `>`.
 *
 * The bracket alternative comes first and consumes quoted values whole, which
 * is what keeps `[aria-label^='Review by']` a single token. Splitting on
 * whitespace instead tore it in half — a defect fixture 019 exposed, and one
 * that hid itself by degrading to the next strategy rather than failing.
 */
const TOKEN = /(?:\[(?:"[^"]*"|'[^']*'|[^\]])*\]|[^\s>])+|>/gu;

/** Matches the inside of `[…]`. */
const ATTRIBUTE = /^([\w-]+)(?:\s*([~^$*|]?=)\s*(.*))?$/u;

/**
 * Compiles a selector, throwing on anything outside the supported subset.
 *
 * @param {string} selector
 * @returns {Step[][]}  One step list per comma group.
 */
export function compileSelector(selector) {
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw new Error('selector is empty');
  }

  return selector.split(',').map((group) => compileGroup(group.trim()));
}

/**
 * Splits a group into compounds and combinators.
 *
 * Whitespace is a combinator *except inside brackets or quotes*, which is not a
 * detail that can be skipped: `[aria-label^='Review by']` contains a space, and
 * a naive `split(/\s+/)` turns it into two nonsense tokens. That failure is
 * quiet — `resolveField` treats a throwing strategy as one that did not work,
 * so the field silently resolves from the next strategy down and the pack looks
 * like it is degrading when in fact the selector was correct.
 *
 * @param {string} group
 * @returns {string[]}
 */
function tokenise(group) {
  assertBalanced(group);

  return group.match(TOKEN) ?? [];
}

/**
 * Rejects an unterminated quote or unbalanced bracket before scanning.
 *
 * Checked separately from the scan because a scanner that silently stops at
 * the first thing it cannot match produces a shorter selector that still
 * matches something — the failure mode this whole module exists to avoid.
 *
 * @param {string} group
 * @returns {void}
 */
function assertBalanced(group) {
  let depth = 0;
  let quote = '';

  for (const character of group) {
    if (quote !== '') {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
    }
  }

  if (quote !== '') throw new Error(`selector "${group}" has an unterminated quote`);
  if (depth !== 0) throw new Error(`selector "${group}" has an unbalanced bracket`);
}

/**
 * @param {string} group
 * @returns {Step[]}
 */
function compileGroup(group) {
  if (group === '') throw new Error('selector group is empty');

  const tokens = tokenise(group);
  /** @type {Step[]} */
  const steps = [];
  /** @type {' ' | '>'} */
  let combinator = ' ';

  for (const token of tokens) {
    if (token === '>') {
      combinator = '>';
      continue;
    }

    if (token === '+' || token === '~') {
      throw new Error(`sibling combinator "${token}" is outside the supported subset`);
    }

    steps.push({ compound: compileCompound(token), combinator });
    combinator = ' ';
  }

  if (steps.length === 0) throw new Error(`selector "${group}" has no compound`);

  return steps;
}

/**
 * @param {string} token
 * @returns {Compound}
 */
function compileCompound(token) {
  if (token.includes(':')) {
    // Silently ignoring a pseudo-class would widen the match rather than
    // narrow it, which is the direction that produces wrong data.
    throw new Error(`pseudo-class in "${token}" is outside the supported subset`);
  }

  const match = COMPOUND.exec(token);

  if (match === null) throw new Error(`selector "${token}" is not supported`);

  const tag = match[1];
  const pieces = (match[2] ?? '').match(PIECE) ?? [];

  return {
    tag: tag === undefined || tag === '*' ? null : tag.toLowerCase(),
    id: pieces.filter((piece) => piece.startsWith('#')).map((piece) => piece.slice(1))[0] ?? null,
    classes: pieces.filter((piece) => piece.startsWith('.')).map((piece) => piece.slice(1)),
    attributes: pieces
      .filter((piece) => piece.startsWith('['))
      .map((piece) => compileAttribute(piece.slice(1, -1).trim())),
  };
}

/**
 * @param {string} body
 * @returns {AttributeTest}
 */
function compileAttribute(body) {
  const match = ATTRIBUTE.exec(body);

  if (match === null) throw new Error(`attribute selector "[${body}]" is not supported`);

  const [, name, operator, raw] = match;

  if (operator === undefined)
    return { name: /** @type {string} */ (name), operator: 'exists', value: '' };
  if (operator === '~=' || operator === '|=') {
    throw new Error(`attribute operator "${operator}" is outside the supported subset`);
  }

  return {
    name: /** @type {string} */ (name),
    operator: /** @type {'=' | '^=' | '$=' | '*='} */ (operator),
    value: unquote(raw ?? ''),
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));

  return quoted ? trimmed.slice(1, -1) : trimmed;
}

/**
 * Every element in `root`'s subtree matching `selector`, in document order.
 *
 * @param {import('./html.mjs').HtmlNode} root
 * @param {string} selector
 * @returns {import('./html.mjs').HtmlElement[]}
 */
export function queryAll(root, selector) {
  const groups = compileSelector(selector);
  /** @type {import('./html.mjs').HtmlElement[]} */
  const found = [];
  /** @type {import('./html.mjs').HtmlElement[]} */
  const ancestry = [];

  // One depth-first pass carrying the ancestor stack, rather than recomputing
  // each candidate's ancestry from the root.
  //
  // The obvious version — walk from the root once per candidate — is quadratic,
  // and it is quadratic in a place nothing small reveals. Fixture 018 runs the
  // cap at five thousand nodes and took over thirty seconds; every other
  // fixture in the corpus finished in milliseconds. The cap case exists for
  // exactly this, and the correct response was to fix the traversal rather than
  // raise the timeout.
  /** @param {import('./html.mjs').HtmlElement} node */
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;

      if (groups.some((steps) => matchesSteps(steps, child, ancestry))) found.push(child);

      ancestry.push(child);
      visit(child);
      ancestry.pop();
    }
  };

  if (root.type !== 'element') return found;

  ancestry.push(root);
  visit(root);

  return found;
}

/**
 * @param {import('./html.mjs').HtmlNode} root
 * @param {string} selector
 * @returns {import('./html.mjs').HtmlElement | null}
 */
export function query(root, selector) {
  return queryAll(root, selector)[0] ?? null;
}

/**
 * @param {Step[]} steps
 * @param {import('./html.mjs').HtmlElement} element
 * @param {import('./html.mjs').HtmlElement[]} ancestry
 * @returns {boolean}
 */
function matchesSteps(steps, element, ancestry) {
  const last = /** @type {Step} */ (steps[steps.length - 1]);

  if (!matchesCompound(last.compound, element)) return false;

  let available = ancestry.length;

  for (let index = steps.length - 2; index >= 0; index -= 1) {
    const step = /** @type {Step} */ (steps[index]);
    const child = /** @type {Step} */ (steps[index + 1]);
    const matched = findAncestor(step.compound, ancestry, available, child.combinator);

    if (matched === -1) return false;

    available = matched;
  }

  return true;
}

/**
 * @param {Compound} compound
 * @param {import('./html.mjs').HtmlElement[]} ancestry
 * @param {number} available  Search within `ancestry[0 … available - 1]`.
 * @param {' ' | '>'} combinator
 * @returns {number}  Index of the match, or -1.
 */
function findAncestor(compound, ancestry, available, combinator) {
  if (combinator === '>') {
    const index = available - 1;

    if (index < 0) return -1;

    return matchesCompound(compound, /** @type {any} */ (ancestry[index])) ? index : -1;
  }

  for (let index = available - 1; index >= 0; index -= 1) {
    if (matchesCompound(compound, /** @type {any} */ (ancestry[index]))) return index;
  }

  return -1;
}

/**
 * @param {Compound} compound
 * @param {import('./html.mjs').HtmlElement} element
 * @returns {boolean}
 */
function matchesCompound(compound, element) {
  if (compound.tag !== null && compound.tag !== element.tag) return false;
  if (compound.id !== null && element.attrs['id'] !== compound.id) return false;

  if (compound.classes.length > 0) {
    const classes = new Set((element.attrs['class'] ?? '').split(/\s+/u).filter(Boolean));

    if (compound.classes.some((name) => !classes.has(name))) return false;
  }

  return compound.attributes.every((test) => matchesAttribute(test, element));
}

/**
 * @param {AttributeTest} test
 * @param {import('./html.mjs').HtmlElement} element
 * @returns {boolean}
 */
function matchesAttribute(test, element) {
  if (!Object.hasOwn(element.attrs, test.name)) return false;

  const actual = /** @type {string} */ (element.attrs[test.name]);

  switch (test.operator) {
    case 'exists':
      return true;
    case '=':
      return actual === test.value;
    case '^=':
      return test.value !== '' && actual.startsWith(test.value);
    case '$=':
      return test.value !== '' && actual.endsWith(test.value);
    default:
      return test.value !== '' && actual.includes(test.value);
  }
}
