/**
 * Extraction against packs that are missing things.
 *
 * A selector pack is untyped JSON edited by hand under time pressure, usually
 * at the worst moment — a source has just changed and someone is repairing the
 * pack against a live incident. Every key in it is therefore optional at run
 * time whatever the schema says, and `extractReviews` reaches through eight
 * levels of it.
 *
 * The requirement these cases pin down is that a missing key degrades to a
 * STATED outcome. The failure they exist to prevent is the other one: a
 * `TypeError` thrown out of `core/`, which violates the no-throw rule (DR-1),
 * aborts the target instead of quarantining a record, and — because it escapes
 * the Result channel — reaches the operator as a stack trace with no error code
 * and no runbook.
 *
 * The distinction most of these turn on is INV-03: "the container is missing"
 * and "the container is empty" are different failures with opposite correct
 * responses, and confusing them is the difference between publishing nothing
 * correctly and wiping a client's site.
 */

import { describe, expect, it } from 'vitest';

import { extractReviews } from '../../../src/core/extract/index.mjs';
import { parseHtml } from '../../../src/core/extract/html.mjs';

/** The parser is injected, so `core/extract` stays free of a markup dependency. */
const parse = parseHtml;

/** Markup with a surface, holding one complete review. */
const POPULATED =
  '<div data-feed>' +
  '<div data-review>' +
  '<span data-author>Dana</span>' +
  "<span role='img' aria-label='Rated 4.0 out of 5'></span>" +
  '<p data-text>Good service.</p>' +
  '</div>' +
  '</div>';

/** The same surface with nothing in it. */
const EMPTY_SURFACE = '<div data-feed></div>';

/** @returns {any} A pack with every key extraction reads. */
const wholePack = () => ({
  containers: {
    surface: { strategies: [{ kind: 'data-attribute', selector: '[data-feed]' }] },
    review_node: { strategies: [{ kind: 'data-attribute', selector: '[data-review]' }] },
  },
  fields: {
    author_name: {
      required: true,
      strategies: [{ kind: 'data-attribute', selector: '[data-author]' }],
    },
    rating: {
      strategies: [
        {
          kind: 'aria-label-pattern',
          selector: "[role='img']",
          attribute: 'aria-label',
          pattern: 'Rated ([0-9.]+) out of 5',
        },
      ],
    },
    text: { strategies: [{ kind: 'data-attribute', selector: '[data-text]' }] },
  },
  truncation_markers: ['More'],
});

/**
 * @param {string} html
 * @param {any} pack
 * @param {object} [options]
 * @returns {any}
 */
const run = (html, pack, options = {}) => extractReviews(html, pack, { parse, ...options });

describe('extraction against a pack with missing keys', () => {
  it('reads a whole pack, so the degenerate cases below are subtractions from something that works', () => {
    const result = run(POPULATED, wholePack());

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.reviews[0].author.name).toBe('Dana');
    expect(result.value.reviews[0].rating).toBe(4);
    expect(result.value.quarantined).toEqual([]);
  });

  it('refuses without a parser rather than calling undefined', () => {
    // `parse` is a required dependency with an optional-looking signature. The
    // naive alternative — calling it anyway — throws a TypeError out of core/.
    const result = /** @type {any} */ (extractReviews(POPULATED, wholePack(), {}));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
    expect(result.error.message).toContain('parser');
  });

  it('reports a missing container when the pack declares no containers at all', () => {
    const result = run(POPULATED, { fields: {} });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
  });

  it('reports a missing container when the pack declares no review_node', () => {
    const pack = wholePack();

    delete pack.containers.review_node;

    // Not ERR-PARSE-EMPTY-UNEXPECTED. Nothing was searched, so nothing can be
    // said about whether the source is empty.
    const result = run(POPULATED, pack);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
  });

  it('reports a missing container when the declared surface is not in the markup', () => {
    const result = run('<main><p>something else entirely</p></main>', wholePack());

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
  });

  it('skips a strategy whose selector does not compile and uses the next one', () => {
    const pack = wholePack();

    // A malformed selector is the single most likely typo in a hand-edited
    // pack. It must cost that strategy only — the ranked list exists so the
    // pack survives one entry going bad.
    pack.containers.review_node.strategies = [
      { kind: 'broken', selector: "[data-review='" },
      { kind: 'data-attribute', selector: '[data-review]' },
    ];

    const result = run(POPULATED, pack);

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toHaveLength(1);
  });
});

describe('INV-03 — an empty container is not a missing one', () => {
  it('publishes nothing, successfully, when the surface resolved and the source says it is empty', () => {
    const result = run(EMPTY_SURFACE, wholePack(), { emptyStateSignal: true });

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toEqual([]);
  });

  it('fails when the surface resolved, held nothing, and no empty-state signal was seen', () => {
    // The dangerous case: this is what a silent selector break looks like, and
    // it is indistinguishable from a genuinely empty source WITHOUT the signal.
    // Publishing it would delete every review a client has.
    const result = run(EMPTY_SURFACE, wholePack(), { emptyStateSignal: false });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-EMPTY-UNEXPECTED');
  });

  it('reports a MISSING container, not an empty one, when the pack declares no surface', () => {
    const pack = wholePack();

    delete pack.containers.surface;

    // Without a surface the search scope is the whole document, so "found no
    // review nodes" carries no information about the source being empty. It
    // must not be allowed to become a successful publish of zero.
    const result = run('<div><p>no reviews here</p></div>', pack, { emptyStateSignal: true });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-PARSE-STRUCTURE');
  });
});

describe('field strategies with missing parts', () => {
  it('quarantines rather than throwing when the pack has no fields block', () => {
    const pack = wholePack();

    delete pack.fields;

    const result = run(POPULATED, pack);

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toEqual([]);
    expect(result.value.quarantined).toHaveLength(1);
    expect(result.value.quarantined[0].ordinal).toBe(0);
  });

  it('quarantines rather than throwing when no rating can be read by any of the three parsers', () => {
    const pack = wholePack();

    delete pack.fields.rating;

    // No accessible label, no `rating_stars` block, no `rating_numeric` field.
    // The cascade has nothing to work with, and a record with no rating is not
    // publishable — a rating defaulted to 5 would be invisible and wrong.
    const result = run(POPULATED, pack);

    expect(result.value.quarantined).toHaveLength(1);
    expect(result.value.quarantined[0].field).toBe('rating');
  });

  it('treats a numeric rating field holding no number as absent', () => {
    const pack = wholePack();

    delete pack.fields.rating;
    pack.fields.rating_numeric = { strategies: [{ selector: '[data-text]' }] };

    // "Good service." parses to no number. The naive failure is `Number(raw)`
    // producing NaN and NaN reaching a payload as a rating.
    const result = run(POPULATED, pack);

    expect(result.value.quarantined).toHaveLength(1);
    expect(result.value.quarantined[0].field).toBe('rating');
  });

  it('counts stars only when the pack declares a filled selector', () => {
    const pack = wholePack();

    delete pack.fields.rating;
    // `total_selector` alone. TR-SEL-010 requires BOTH: a pack that cannot tell
    // filled from unfilled counts every star and reports 5 for every review,
    // which looks like success and is invisible until the mean is 5.0.
    pack.rating_stars = { total_selector: '[data-star]' };

    const result = run(POPULATED, pack);

    expect(result.value.quarantined).toHaveLength(1);
    expect(result.value.quarantined[0].field).toBe('rating');
  });

  it('treats a strategy whose attribute is absent on the matched element as no match', () => {
    const pack = wholePack();

    pack.fields.author_name.strategies = [
      // Matches the element, but the element has no `data-name` attribute.
      { kind: 'attribute', selector: '[data-author]', attribute: 'data-name' },
      { kind: 'data-attribute', selector: '[data-author]' },
    ];

    // The naive failure is `undefined` becoming the string "undefined" and
    // being published as an author name.
    const result = run(POPULATED, pack);

    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.reviews[0].author.name).toBe('Dana');
  });

  it('uses the whole match when a pattern declares no capture group', () => {
    const pack = wholePack();

    pack.fields.author_name.strategies = [
      { kind: 'pattern', selector: '[data-author]', pattern: 'Da[a-z]+' },
    ];

    const result = run(POPULATED, pack);

    expect(result.value.reviews[0].author.name).toBe('Dana');
  });

  it('collapses whitespace when a strategy declares no pattern', () => {
    const pack = wholePack();

    const result = run(
      POPULATED.replace('<span data-author>Dana</span>', '<span data-author>\n  Dana  R\n</span>'),
      pack,
    );

    expect(result.value.reviews[0].author.name).toBe('Dana R');
  });

  it('yields no badges when the badge field declares no strategies', () => {
    const pack = wholePack();

    pack.fields.author_badges = { strategies: [] };

    const result = run(POPULATED, pack);

    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.reviews[0].author.badges).toEqual([]);
  });
});
