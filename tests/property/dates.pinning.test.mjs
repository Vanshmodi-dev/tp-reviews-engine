import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import * as pinModule from '../../src/core/dates/pin.mjs';
import { keepPinnedDate, pinDate, resolveOrKeep } from '../../src/core/dates/pin.mjs';

/**
 * PT-06 — a pinned date is never recomputed (FR-036, TR-EXT-050).
 *
 * On the first harvest a review reads "2 months ago"; a year later the same
 * review reads "1 year ago". Recomputing on each harvest would push the
 * review's date forward in time on every run — the review drifts later forever
 * while never actually changing — permanently scrambling sort order and making
 * "newest first" meaningless.
 *
 * The law is stated as an absence, which is the hard kind to test: it is not
 * "the function returns the right thing" but "there is no path that returns
 * anything else".
 */

const RUNS = 1000;

/** The phrasings a source cycles through as a review ages. */
const phrase = () =>
  fc.constantFrom(
    'a day ago',
    'yesterday',
    '2 days ago',
    'a week ago',
    '3 weeks ago',
    'a month ago',
    '2 months ago',
    '6 months ago',
    'a year ago',
    '2 years ago',
    'vor 2 Wochen',
    'il y a 3 mois',
    'hace 4 días',
    'कल',
    'منذ يومين',
    'unparseable nonsense',
  );

const instant = () => fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });

const locale = () => fc.constantFrom('en', 'de', 'fr', 'es', 'pt', 'hi', 'ar');

describe('PT-06 — pinning', () => {
  it('keeps the original date however the phrase later re-renders', () => {
    fc.assert(
      // Bundled into a record rather than five positional arguments: the
      // max-params limit of 4 applies here too, and five loose values in a
      // callback is genuinely harder to read than a named shape.
      fc.property(
        fc.record({
          first: phrase(),
          later: phrase(),
          t0: instant(),
          t1: instant(),
          loc: locale(),
        }),
        ({ first, later, t0, t1, loc }) => {
          const pinned = pinDate(first, t0, loc);
          const afterSecondHarvest = resolveOrKeep(pinned, later, t1, loc);

          return (
            afterSecondHarvest.date_estimated === pinned.date_estimated &&
            afterSecondHarvest.date_precision === pinned.date_precision &&
            afterSecondHarvest.date_confidence === pinned.date_confidence
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('survives an unbounded number of later harvests', () => {
    fc.assert(
      fc.property(
        phrase(),
        fc.array(fc.tuple(phrase(), instant()), { minLength: 1, maxLength: 30 }),
        instant(),
        locale(),
        (first, harvests, t0, loc) => {
          const pinned = pinDate(first, t0, loc);

          let current = pinned;
          for (const [p, t] of harvests) current = resolveOrKeep(current, p, t, loc);

          return current.date_estimated === pinned.date_estimated;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('keepPinnedDate ignores whatever it is handed', () => {
    fc.assert(
      fc.property(phrase(), instant(), phrase(), locale(), (first, t0, later, loc) => {
        const pinned = pinDate(first, t0, loc);
        return keepPinnedDate(pinned, later) === pinned;
      }),
      { numRuns: RUNS },
    );
  });

  it('pins deterministically: same phrase and instant, same result', () => {
    fc.assert(
      fc.property(phrase(), instant(), locale(), (p, t, loc) => {
        const a = pinDate(p, t, loc);
        const b = pinDate(p, t, loc);
        return a.date_estimated === b.date_estimated && a.date_precision === b.date_precision;
      }),
      { numRuns: RUNS },
    );
  });

  it('pins a null date for an unparseable phrase, and keeps that null pinned', () => {
    // TR-EXT-051. The record stays valid; a review is never discarded because
    // its date could not be read. And "we could not read it" is itself pinned -
    // a later harvest does not get a second guess.
    fc.assert(
      fc.property(instant(), instant(), (t0, t1) => {
        const pinned = pinDate('total nonsense', t0, 'en');
        const later = resolveOrKeep(pinned, '2 days ago', t1, 'en');

        return pinned.date_estimated === null && later.date_estimated === null;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('PT-06 — the absence of a recompute path', () => {
  it('exports no function whose name suggests recomputation', () => {
    // T-078's stated verification is that a reviewer looks for a recompute path
    // and finds none. This mechanises the look, so it stays true after every
    // future change rather than only on the day it was reviewed.
    const forbidden = ['recompute', 'refresh', 'update', 'recalculate', 'reresolve', 'force'];

    for (const name of Object.keys(pinModule)) {
      for (const word of forbidden) {
        expect(name.toLowerCase(), `pin.mjs exports "${name}"`).not.toContain(word);
      }
    }
  });

  it('accepts no option that would re-resolve an existing date', () => {
    // resolveOrKeep takes (existing, phrase, observedAt, locale). There is no
    // fifth parameter, and adding one is the change this asserts against.
    expect(resolveOrKeep.length).toBeLessThanOrEqual(4);
  });

  it('resolveOrKeep branches only on whether the review is already known', () => {
    const pinned = pinDate('2 days ago', Date.UTC(2026, 0, 1), 'en');

    // Known -> unchanged, whatever else is passed.
    expect(resolveOrKeep(pinned, '9 years ago', Date.UTC(2029, 0, 1), 'en')).toBe(pinned);

    // Unknown -> resolved fresh.
    expect(resolveOrKeep(null, '2 days ago', Date.UTC(2026, 0, 1), 'en').date_estimated).toBe(
      pinned.date_estimated,
    );
  });
});
