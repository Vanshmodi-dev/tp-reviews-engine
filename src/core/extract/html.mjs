/**
 * A dependency-free reader for sanitised markup subtrees (EDR-015, TR-EXT-010).
 *
 * ## Why this exists rather than a parser dependency
 *
 * TRD §10.4 is explicit: `core/` has **zero** dependencies, and the HTML parser
 * budgeted in §10.3 is development-only. It has a real job — `sanitize-html`
 * must strip scripts and tracking attributes with a spec-compliant tree, and
 * doing that with regular expressions is the classic way to ship a sanitiser
 * that does not sanitise. But that job is in `scripts/`, not here.
 *
 * TR-EXT-010 says the extractor MUST accept a string. Those two requirements
 * together leave exactly one design: `core/` reads the string itself, without
 * importing anything.
 *
 * ## What this deliberately is not
 *
 * It is not an HTML5 parser. It does not implement the insertion modes, the
 * adoption agency algorithm, or foster parenting. It reads *sanitised, trimmed
 * review subtrees* — the output of `scripts/sanitize-html.mjs`, which has
 * already been through a real parser and re-serialised.
 *
 * That narrowing is what makes a hand-written reader defensible. The input is
 * not arbitrary web markup; it is markup a spec-compliant parser produced.
 *
 * ## Failure is structural, never silent
 *
 * A malformed close tag is ignored rather than guessed at, and an unclosed
 * element is closed at the end of input. Both mean the tree is shallower or
 * shallower-nested than the author intended — which surfaces as a field that
 * does not resolve, which quarantines the record (T-191). A reader that
 * silently rearranged the tree to make a selector match would be worse.
 *
 * @module core/extract/html
 */

/**
 * @typedef {object} HtmlElement
 * @property {'element'} type
 * @property {string} tag
 * @property {Record<string, string>} attrs
 * @property {HtmlNode[]} children
 */

/**
 * @typedef {object} HtmlText
 * @property {'text'} type
 * @property {string} value
 */

/** @typedef {HtmlElement | HtmlText} HtmlNode */

/** Elements that never have children (HTML spec void elements). */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Elements whose content is not markup.
 *
 * Their text is never review text, and treating `<` inside them as a tag would
 * corrupt the tree around them. The sanitiser removes `script` and `style`
 * outright; they are handled here so that a fixture captured before the
 * sanitiser ran still reads correctly.
 */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Elements that separate words visually.
 *
 * `textOf` inserts a space at their boundaries so that `<p>Great</p><p>food</p>`
 * reads as `Great food` rather than `Greatfood`. Doing this for every element
 * would break the opposite case — `<b>Hel</b>lo` must stay `Hello` — so the set
 * is limited to elements the layout already separates.
 */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'dd',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/** The synthetic root every parse returns. */
const ROOT_TAG = '#fragment';

/** Named entities a review subtree can realistically contain. */
const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
});

/** Highest code point a numeric entity may name. */
const MAX_CODE_POINT = 0x10ffff;

/** Radixes for `&#x1F600;` and `&#128512;` respectively. */
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

/** The surrogate range, which is never a character on its own. */
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;

/**
 * Decodes the character references a sanitised subtree can contain.
 *
 * An undecoded `&amp;` in review text reaches the payload and renders as
 * `&amp;` on a client's website, which looks like a bug in their site.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;

  return text.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu, (whole, body) => {
    if (body.startsWith('#')) return decodeNumericEntity(body.slice(1)) ?? whole;

    return NAMED_ENTITIES[/** @type {keyof typeof NAMED_ENTITIES} */ (body.toLowerCase())] ?? whole;
  });
}

/**
 * @param {string} digits  Either `123` or `x7B`.
 * @returns {string | null}
 */
function decodeNumericEntity(digits) {
  const hex = digits[0] === 'x' || digits[0] === 'X';
  const code = Number.parseInt(hex ? digits.slice(1) : digits, hex ? HEX_RADIX : DECIMAL_RADIX);

  if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return null;

  // The surrogate range is checked explicitly because `fromCodePoint` does NOT
  // refuse it — `fromCodePoint(0xD800)` returns a lone surrogate quite happily,
  // producing an ill-formed string that survives all the way to JSON
  // serialisation and hashing, where it becomes a replacement character and a
  // content hash that changes on a round-trip. Leaving the source text is the
  // honest answer: the input was not a character.
  if (code >= SURROGATE_MIN && code <= SURROGATE_MAX) return null;

  return String.fromCodePoint(code);
}

/**
 * Parses a markup string into a plain-data tree.
 *
 * The result contains no functions, no parent links, and no cycles, so it is
 * structurally cloneable and safe to compare with `toEqual` — which is what a
 * golden fixture assertion needs.
 *
 * @param {string} source
 * @returns {HtmlElement}
 */
export function parseHtml(source) {
  /** @type {HtmlElement} */
  const root = { type: 'element', tag: ROOT_TAG, attrs: {}, children: [] };
  /** @type {HtmlElement[]} */
  const stack = [root];
  let index = 0;

  while (index < source.length) {
    const next = source.indexOf('<', index);

    if (next === -1) {
      pushText(top(stack), source.slice(index));
      break;
    }

    if (next > index) pushText(top(stack), source.slice(index, next));

    index = consumeTag(source, next, stack);
  }

  return root;
}

/**
 * The open element.
 *
 * The stack always holds at least the synthetic root — `closeTag` never pops
 * below index 1 — so this is total, and saying so once here is better than
 * asserting it at four call sites.
 *
 * @param {HtmlElement[]} stack
 * @returns {HtmlElement}
 */
function top(stack) {
  return /** @type {HtmlElement} */ (stack[stack.length - 1]);
}

/**
 * Handles one `<…>` construct, returning the index just past it.
 *
 * @param {string} source
 * @param {number} start  Index of the `<`.
 * @param {HtmlElement[]} stack
 * @returns {number}
 */
function consumeTag(source, start, stack) {
  if (source.startsWith('<!--', start)) return skipTo(source, start, '-->');
  if (source.startsWith('<!', start) || source.startsWith('<?', start)) {
    return skipTo(source, start, '>');
  }

  if (source.startsWith('</', start)) {
    const end = source.indexOf('>', start);
    const name = source.slice(start + 2, end === -1 ? source.length : end).trim();

    closeTag(stack, name.toLowerCase());

    return end === -1 ? source.length : end + 1;
  }

  return openTag(source, start, stack);
}

/**
 * @param {string} source
 * @param {number} start
 * @param {string} terminator
 * @returns {number}
 */
function skipTo(source, start, terminator) {
  const end = source.indexOf(terminator, start + 1);

  return end === -1 ? source.length : end + terminator.length;
}

/**
 * @param {string} source
 * @param {number} start
 * @param {HtmlElement[]} stack
 * @returns {number}
 */
function openTag(source, start, stack) {
  const match = /^<([A-Za-z][^\s/>]*)/u.exec(source.slice(start));

  // A bare `<` that does not begin a tag is literal text, which is exactly what
  // "5 < 6" in a review body looks like.
  if (match === null) {
    pushText(top(stack), '<');

    return start + 1;
  }

  const tag = /** @type {string} */ (match[1]).toLowerCase();
  const { attrs, end, selfClosing } = readAttributes(source, start + match[0].length);
  /** @type {HtmlElement} */
  const element = { type: 'element', tag, attrs, children: [] };

  top(stack).children.push(element);

  if (selfClosing || VOID_TAGS.has(tag)) return end;
  if (RAW_TEXT_TAGS.has(tag)) return consumeRawText(source, end, tag, element);

  stack.push(element);

  return end;
}

/**
 * @param {string} source
 * @param {number} from
 * @param {string} tag
 * @param {HtmlElement} element
 * @returns {number}
 */
function consumeRawText(source, from, tag, element) {
  const closing = source.toLowerCase().indexOf(`</${tag}`, from);
  const stop = closing === -1 ? source.length : closing;

  if (stop > from) element.children.push({ type: 'text', value: source.slice(from, stop) });
  if (closing === -1) return source.length;

  const end = source.indexOf('>', closing);

  return end === -1 ? source.length : end + 1;
}

/**
 * Closes to the nearest matching open element.
 *
 * A close tag with no matching open element is **ignored** rather than treated
 * as closing something else. Guessing here is how a reader ends up producing a
 * plausible-looking tree that does not match the document.
 *
 * @param {HtmlElement[]} stack
 * @param {string} tag
 * @returns {void}
 */
function closeTag(stack, tag) {
  for (let depth = stack.length - 1; depth > 0; depth -= 1) {
    if (/** @type {HtmlElement} */ (stack[depth]).tag !== tag) continue;

    stack.splice(depth);

    return;
  }
}

/**
 * @param {HtmlElement} parent
 * @param {string} raw
 * @returns {void}
 */
function pushText(parent, raw) {
  if (raw === '') return;

  parent.children.push({ type: 'text', value: decodeEntities(raw) });
}

/**
 * Reads attributes up to the tag's `>`.
 *
 * @param {string} source
 * @param {number} from
 * @returns {{ attrs: Record<string, string>, end: number, selfClosing: boolean }}
 */
function readAttributes(source, from) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const pattern = /\s*([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/guy;

  pattern.lastIndex = from;

  let selfClosing = false;
  let cursor = from;

  while (pattern.lastIndex < source.length) {
    const rest = /^\s*(\/?)>/u.exec(source.slice(pattern.lastIndex));

    if (rest !== null) {
      selfClosing = rest[1] === '/';
      cursor = pattern.lastIndex + rest[0].length;

      return { attrs, end: cursor, selfClosing };
    }

    const match = pattern.exec(source);

    if (match === null || match[0] === '') break;

    const name = /** @type {string} */ (match[1]).toLowerCase();

    if (!Object.hasOwn(attrs, name)) attrs[name] = decodeEntities(unquote(match[2]));

    cursor = pattern.lastIndex;
  }

  return { attrs, end: Math.max(cursor, from), selfClosing };
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function unquote(value) {
  if (value === undefined) return '';

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  return quoted ? value.slice(1, -1) : value;
}

/**
 * Concatenated visible text, with block boundaries separated.
 *
 * @param {HtmlNode} node
 * @returns {string}
 */
export function textOf(node) {
  if (node.type === 'text') return node.value;
  if (RAW_TEXT_TAGS.has(node.tag)) return '';

  const inner = node.children.map((child) => textOf(child)).join('');

  return BLOCK_TAGS.has(node.tag) ? ` ${inner} ` : inner;
}

/**
 * @param {HtmlNode} node
 * @param {string} name
 * @returns {string | null}
 */
export function attr(node, name) {
  if (node.type !== 'element') return null;

  return node.attrs[name] ?? null;
}

/**
 * Every element in the subtree, in document order, excluding `root` itself.
 *
 * @param {HtmlNode} root
 * @returns {HtmlElement[]}
 */
export function descendants(root) {
  /** @type {HtmlElement[]} */
  const found = [];

  if (root.type !== 'element') return found;

  // Accumulating into one array rather than spreading a fresh array per level.
  // The spread version is quadratic in tree size, which on the five-thousand
  // node cap fixture is the difference between milliseconds and minutes.
  /** @param {HtmlElement} node */
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;

      found.push(child);
      visit(child);
    }
  };

  visit(root);

  return found;
}
