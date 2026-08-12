/**
 * Subtree serialisation (DEL-94, SER-01…03, EDR-015).
 *
 * ## The string is the whole point
 *
 * Extraction operates on a serialised string, never on live browser handles.
 * That single choice is what makes `core/extract/` pure, property-testable, and
 * reproducible offline — and it is what the entire golden-fixture strategy
 * rests on. Extracting from live locators is the shorter path and it would
 * eliminate roughly half the test portfolio.
 *
 * ## Never the whole document (SER-02)
 *
 * A full-page serialisation on a five-thousand-review listing is a memory
 * event, not a slow function. The subtree is the part under test; the rest is
 * five to twenty times more input for the parser, and none of it is read.
 *
 * ## Minimal ancestry, and what "minimal" means here (SER-03)
 *
 * The requirement is "the review container plus minimal ancestry — the same
 * shape as a captured fixture, so that a production failure can be reproduced
 * by saving the string as a fixture".
 *
 * The operational reading: **enough ancestry that the pack's own surface
 * strategy still resolves against the saved string.** A pack whose surface is
 * `[role='main'] [role='feed']` needs the `main` element, or the fixture it
 * produces cannot be located by the pack that produced it — and the file lands
 * in the corpus looking fine and failing on load.
 *
 * That is what makes `tpre replay` work and what makes X-9 ("every incident
 * becomes a permanent test") nearly free for extraction defects: the
 * diagnostics bundle contains a string that *is* a fixture.
 *
 * @module adapters/acquisition/google-dom/dom-serialize
 */

/**
 * How far up the tree the serialiser will climb.
 *
 * Bounded so a surface strategy that names a deep ancestor chain cannot walk to
 * `<html>` and reintroduce whole-document serialisation through the back door.
 */
export const MAX_ANCESTRY = 4;

/**
 * Serialises the surface plus the ancestry its own selector needs.
 *
 * @param {any} page
 * @param {string} surfaceSelector  The strategy that located the surface.
 * @returns {Promise<string>}
 */
export function serializeSurface(page, surfaceSelector) {
  return page.evaluate(
    (/** @type {any} */ args) => {
      const dom = /** @type {any} */ (globalThis).document;
      const element = dom.querySelector(args.selector);

      if (element === null) return '';

      // Climb only while the climb buys something: each level is kept if the
      // selector fails to match when the subtree is rooted lower. Climbing a
      // fixed number of levels instead would either be too few for one pack or
      // an excuse to serialise the document for another.
      let node = element;

      for (let level = 0; level < args.maxAncestry; level += 1) {
        const parent = node.parentElement;

        if (parent === null || parent === dom.body || parent === dom.documentElement) break;

        const probe = dom.createElement('div');

        probe.innerHTML = node.outerHTML;

        if (probe.querySelector(args.selector) !== null) break;

        node = parent;
      }

      return node.outerHTML;
    },
    { selector: surfaceSelector, maxAncestry: MAX_ANCESTRY },
  );
}

/**
 * Re-exported from `core/`, where the predicate lives.
 *
 * "Is this string usable as a fixture" is a fact about extraction's input, not
 * about the browser — so it is pure, it is unit-tested in the fast suite, and
 * it stays out of this file. What remains here is one `page.evaluate` callback,
 * which is only meaningful against a real document.
 */
export { checkFixtureShape } from '../../../core/index.mjs';
