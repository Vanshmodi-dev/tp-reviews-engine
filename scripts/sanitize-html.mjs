#!/usr/bin/env node
/**
 * Sanitises a captured markup subtree before it becomes a fixture.
 *
 * ## Why this uses a real parser and `core/extract` does not
 *
 * This is the one place a spec-compliant HTML parser is genuinely required, and
 * it is why TRD §10.3 budgets a development-only one (OIQ-03, resolved here as
 * `parse5`: no native compilation, no postinstall, one transitive dependency —
 * DEP-3 satisfied, and it never appears in production dependencies).
 *
 * Sanitising with regular expressions is the classic way to ship a sanitiser
 * that does not sanitise. `<scr<script>ipt>` defeats a naive tag-stripper and
 * does not defeat a tree walk, and there is a long list of similar tricks.
 *
 * `core/extract` is a different problem: it reads markup this script has
 * already produced, so its input is markup a spec-compliant parser emitted —
 * which is what makes a small hand-written reader defensible there and not
 * here. It also cannot import this, because `core/` has zero dependencies.
 *
 * ## What is removed, and what is deliberately kept
 *
 * Removed: scripts, styles, inline event handlers, tracking and analytics
 * attributes, and anything carrying a token or session identifier. Nothing
 * removed here is ever needed to test extraction.
 *
 * **Kept: review text and author names.** They are needed for parser
 * correctness and are already public. Stripping them would produce a corpus
 * that tests the shape of the markup and nothing about the extraction it
 * exists to verify — which is a corpus that passes while the parser is broken.
 *
 * Usage: `node scripts/sanitize-html.mjs <input.html> [output.html]`
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { parseFragment, serialize } from 'parse5';

/** Elements removed with their entire subtree. */
const DROP_ELEMENTS = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed']);

/** Attribute names removed wherever they appear. */
const DROP_ATTRIBUTES = new Set([
  'nonce',
  'integrity',
  'crossorigin',
  'ping',
  'referrerpolicy',
  'srcset',
  'style',
]);

/** Attribute-name patterns removed wherever they appear. */
const DROP_ATTRIBUTE_PATTERNS = [
  /^on/iu,
  /^data-(?:ved|csi|jsaction|jscontroller|jsmodel|jsdata|jsname|jslog)$/iu,
  /token|session|auth|cookie|tracking|analytics|gtm|utm|fbclid|gclid/iu,
];

/**
 * @param {{ name: string }} attribute
 * @returns {boolean}
 */
function keepAttribute(attribute) {
  if (DROP_ATTRIBUTES.has(attribute.name)) return false;

  return !DROP_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(attribute.name));
}

/**
 * Strips the query string from a URL, which is where the identifiers hide.
 *
 * An avatar URL's path is what extraction reads; its query string is a resize
 * directive and, often, a signed token. Keeping the token would put a
 * credential in the repository under the name `page.html`.
 *
 * @param {{ name: string, value: string }} attribute
 * @returns {{ name: string, value: string }}
 */
function scrubUrl(attribute) {
  if (!['href', 'src', 'action', 'data-src'].includes(attribute.name)) return attribute;

  const cut = attribute.value.indexOf('?');

  return cut === -1 ? attribute : { ...attribute, value: attribute.value.slice(0, cut) };
}

/**
 * Rewrites the tree in place, iteratively.
 *
 * Iterative and over a local rather than recursive over a parameter: parse5
 * nodes carry `parentNode` back-references, so rebuilding the tree immutably
 * would mean re-linking every parent by hand — more code, and more places to
 * get the links wrong, than the mutation it would avoid.
 *
 * @param {any} root
 * @returns {void}
 */
function walk(root) {
  /** @type {any[]} */
  const pending = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    const children = node.childNodes;

    if (!Array.isArray(children)) continue;

    node.childNodes = children.filter((child) => !DROP_ELEMENTS.has(child.nodeName));

    for (const child of node.childNodes) {
      if (Array.isArray(child.attrs)) child.attrs = child.attrs.filter(keepAttribute).map(scrubUrl);

      pending.push(child);
    }
  }
}

/**
 * Sanitises a markup string.
 *
 * @param {string} source
 * @returns {string}
 */
export function sanitizeHtml(source) {
  const fragment = parseFragment(source);

  walk(fragment);

  return serialize(fragment);
}

const [input, output] = process.argv.slice(2);

if (input !== undefined) {
  const sanitised = sanitizeHtml(readFileSync(input, 'utf8'));

  if (output === undefined) process.stdout.write(sanitised);
  else writeFileSync(output, `${sanitised.trim()}\n`, 'utf8');
}
