import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseHtml } from '../../src/core/extract/html.mjs';
import { extractReviews } from '../../src/core/extract/index.mjs';
import { parseRating } from '../../src/core/extract/rating.mjs';
import { pinDate, resolveOrKeep } from '../../src/core/dates/pin.mjs';
import { loadFixture } from '../helpers/fixtures.mjs';

const RUNS = 1000;

const fixture = loadFixture('001-standard-120-reviews');

/**
 * @param {string} html
 * @returns {any}
 */
function extract(html) {
  return extractReviews(html, fixture.pack, { parse: parseHtml });
}

describe('PT-06 — a pinned date is NEVER recomputed', () => {
  it('keeps the first estimate whatever the phrase later says', () => {
    // On the first harvest a review reads "2 months ago"; a year later the same
    // review reads "1 year ago". Recomputing on each harvest pushes the review
    // forward in time on every run, permanently scrambling sort order and
    // making "newest first" meaningless (TR-EXT-050, FR-036).
    const phrase = fc.record({
      quantity: fc.integer({ min: 1, max: 300 }),
      unit: fc.constantFrom('day', 'week', 'month', 'year'),
    });

    fc.assert(
      fc.property(
        phrase,
        phrase,
        fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
        (initial, later, observedAt) => {
          const first = pinDate(`${initial.quantity} ${initial.unit}s ago`, observedAt);

          if (first.date_estimated === null) return true;

          const second = resolveOrKeep(
            first,
            `${later.quantity} ${later.unit}s ago`,
            observedAt + 86_400_000,
          );

          return second.date_estimated === first.date_estimated;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('REJECTS the naive implementation that recomputes each time', () => {
    // The law must fail against the obvious wrong code, or it proves nothing.
    const recompute = (
      /** @type {any} */ _existing,
      /** @type {string} */ phrase,
      /** @type {number} */ at,
    ) => pinDate(phrase, at);

    const first = pinDate('2 months ago', 1_700_000_000_000);
    const naive = recompute(first, '1 year ago', 1_700_000_000_000 + 86_400_000);

    expect(naive.date_estimated).not.toBe(first.date_estimated);
    expect(resolveOrKeep(first, '1 year ago', 1_700_000_000_000 + 86_400_000).date_estimated).toBe(
      first.date_estimated,
    );
  });
});

describe('PT-05 — extraction is a pure function of its input', () => {
  it('produces identical output for identical input, every time', () => {
    // EDR-015 and DR-1. If this ever fails, the golden corpus stops being a
    // regression mechanism and becomes a source of intermittent CI failures
    // nobody can reproduce.
    const once = extract(fixture.html);
    const twice = extract(fixture.html);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('does not mutate the input string or the pack', () => {
    const packBefore = JSON.stringify(fixture.pack);
    const htmlBefore = fixture.html;

    extract(fixture.html);

    expect(JSON.stringify(fixture.pack)).toBe(packBefore);
    expect(fixture.html).toBe(htmlBefore);
  });

  it('never throws, whatever markup it is handed', () => {
    // `core/` returns a Result and does not throw. Arbitrary strings include
    // unbalanced tags, lone angle brackets, and nesting deep enough to be
    // interesting — all of which a live source can serve.
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (source) => {
        const outcome = extract(source);

        return typeof outcome.ok === 'boolean';
      }),
      { numRuns: RUNS },
    );
  });

  it('never throws on markup-shaped noise', () => {
    const markupish = fc.stringMatching(/^[<>/="' a-z0-9à-ÿ-]{0,200}$/u);

    fc.assert(
      fc.property(
        markupish,
        (source) => typeof extract(`<div role="feed">${source}</div>`).ok === 'boolean',
      ),
      { numRuns: RUNS },
    );
  });
});

describe('TR-EXT-040 — no input yields a rating outside [1, 5]', () => {
  it('a resolved rating is always an integer 1..5', () => {
    // The post-check is the mitigation for IR-14, so its guarantee is asserted
    // over arbitrary parser output rather than over the handful of shapes
    // anybody thought to write a test for.
    fc.assert(
      fc.property(
        fc.oneof(fc.double({ min: -100, max: 100, noNaN: true }), fc.string({ maxLength: 40 })),
        (raw) => {
          const outcome = parseRating({
            accessibleLabel: () => /** @type {any} */ (raw),
            starCount: () => null,
            numericText: () => null,
          });

          if (outcome.value === null) return true;

          return Number.isInteger(outcome.value) && outcome.value >= 1 && outcome.value <= 5;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('REJECTS a cascade with the post-check removed', () => {
    // Mutation check. Without the post-check, an aggregate business rating of
    // 4.3 is accepted and published as a review — repeatedly, inflating the
    // client's displayed mean.
    const withoutCheck = (/** @type {string} */ text) => Number(/[\d.]+/u.exec(text)?.[0]);

    expect(withoutCheck('Rated 4.3 out of 5')).toBe(4.3);
    expect(
      parseRating({
        accessibleLabel: () => 'Rated 4.3 out of 5',
        starCount: () => null,
        numericText: () => null,
      }).value,
    ).toBeNull();
  });
});

describe('EDR-016 — detachment order is a structural property', () => {
  it('reply text never appears in review text, for any reply wording', () => {
    // The post-hoc alternative — subtracting the reply's words afterwards —
    // fails on short replies, which are the most common kind. This law is what
    // makes "detach first" checkable rather than a comment.
    const wording = fc.stringMatching(/^[A-Za-z][A-Za-z !.]{0,60}$/u);

    fc.assert(
      fc.property(wording, (reply) => {
        const html = `<div role="main"><div role="feed">
          <div role="article" data-review-id="r-1">
            <span aria-label="Review by Ann"></span>
            <span role="img" aria-label="3 stars"></span>
            <span data-review-date aria-label="2 weeks ago">2 weeks ago</span>
            <div data-review-text lang="en">Body words only.</div>
            <div data-owner-reply><div data-owner-reply-text>${reply}</div></div>
          </div></div></div>`;

        const outcome = extract(html);

        if (!outcome.ok || outcome.value.reviews.length !== 1) return false;

        return outcome.value.reviews[0].text === 'Body words only.';
      }),
      { numRuns: RUNS },
    );
  });
});
