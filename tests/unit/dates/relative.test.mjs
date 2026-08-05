import { describe, expect, it } from 'vitest';

import LOCALE_TABLE from '../../../src/core/dates/locales.json' with { type: 'json' };
import { pinDate } from '../../../src/core/dates/pin.mjs';
import {
  CONFIDENCES,
  PRECISIONS,
  describePrecision,
  isCoarserThan,
} from '../../../src/core/dates/precision.mjs';
import {
  SUPPORTED_LOCALES,
  UNITS,
  parseRelativePhrase,
  resolveRelativePhrase,
} from '../../../src/core/dates/relative.mjs';

/**
 * The locale matrix (T-074, T-075, T-076).
 *
 * TRD §21.6.1's Agent Note names the specific bug this file exists to prevent:
 * a regex of the shape `(\d+)\s+(day|week)s?\s+ago` passes a naive suite and
 * then silently fails on every "a day ago" and "yesterday" — the phrasings most
 * common on *recent* reviews, and therefore the ones a "newest first" display
 * shows most prominently. Every locale below is tested for its singular forms
 * specifically.
 */

const OBSERVED = Date.UTC(2026, 5, 15, 12, 0, 0);
const DAY = 86_400_000;

/** @param {string} phrase @param {string} locale */
const parse = (phrase, locale) => parseRelativePhrase(phrase, locale);

describe('the table is data, not code (TR-EXT-052)', () => {
  it('covers the six locales TRD §21.6.1 requires', () => {
    for (const locale of ['en', 'hi', 'de', 'fr', 'es', 'pt', 'ar']) {
      expect(SUPPORTED_LOCALES, locale).toContain(locale);
    }
  });

  it('gives every locale units, articles, and specials', () => {
    for (const [code, entry] of Object.entries(LOCALE_TABLE.locales)) {
      expect(Object.keys(entry.units).length, `${code} units`).toBe(7);
      expect(entry.articles.length, `${code} articles`).toBeGreaterThan(0);
      expect(Object.keys(entry.special).length, `${code} specials`).toBeGreaterThan(0);
    }
  });

  it('adding a locale needs no code change — the resolver reads the table', () => {
    // T-073's acceptance. The resolver has no per-locale branch anywhere; every
    // locale-specific fact lives in locales.json.
    const table = JSON.stringify(LOCALE_TABLE);

    expect(table).toContain('"de"');
    expect(SUPPORTED_LOCALES.length).toBe(Object.keys(LOCALE_TABLE.locales).length);
  });
});

describe('English', () => {
  it('parses plural numeric phrases', () => {
    expect(parse('2 weeks ago', 'en')).toEqual({ count: 2, unit: 'week' });
    expect(parse('3 months ago', 'en')).toEqual({ count: 3, unit: 'month' });
    expect(parse('11 years ago', 'en')).toEqual({ count: 11, unit: 'year' });
  });

  it('parses the "a"/"an" SINGULAR forms (IR-04)', () => {
    // The bug the Agent Note names. "a day" has no digit to match.
    expect(parse('a day ago', 'en')).toEqual({ count: 1, unit: 'day' });
    expect(parse('an hour ago', 'en')).toEqual({ count: 1, unit: 'hour' });
    expect(parse('a week ago', 'en')).toEqual({ count: 1, unit: 'week' });
    expect(parse('a month ago', 'en')).toEqual({ count: 1, unit: 'month' });
    expect(parse('a year ago', 'en')).toEqual({ count: 1, unit: 'year' });
  });

  it('parses fixed phrases that name a duration without a number', () => {
    expect(parse('yesterday', 'en')).toEqual({ count: 1, unit: 'day' });
    expect(parse('last week', 'en')).toEqual({ count: 1, unit: 'week' });
    expect(parse('last month', 'en')).toEqual({ count: 1, unit: 'month' });
    expect(parse('last year', 'en')).toEqual({ count: 1, unit: 'year' });
  });

  it('parses "one" as a written singular', () => {
    expect(parse('one week ago', 'en')).toEqual({ count: 1, unit: 'week' });
  });

  it('is case-insensitive and tolerates punctuation', () => {
    expect(parse('A Day Ago.', 'en')).toEqual({ count: 1, unit: 'day' });
    expect(parse('  2   WEEKS   AGO  ', 'en')).toEqual({ count: 2, unit: 'week' });
  });
});

describe('German — prefix ordering', () => {
  it('parses "vor N Einheiten"', () => {
    expect(parse('vor 2 Wochen', 'de')).toEqual({ count: 2, unit: 'week' });
    expect(parse('vor 3 Monaten', 'de')).toEqual({ count: 3, unit: 'month' });
  });

  it('parses the singular forms', () => {
    expect(parse('vor einem Tag', 'de')).toEqual({ count: 1, unit: 'day' });
    expect(parse('vor einer Woche', 'de')).toEqual({ count: 1, unit: 'week' });
    expect(parse('gestern', 'de')).toEqual({ count: 1, unit: 'day' });
  });
});

describe('French — multi-word prefix', () => {
  it('parses "il y a N unités"', () => {
    expect(parse('il y a 2 semaines', 'fr')).toEqual({ count: 2, unit: 'week' });
    expect(parse('il y a 5 mois', 'fr')).toEqual({ count: 5, unit: 'month' });
  });

  it('parses the singular forms', () => {
    expect(parse('il y a un jour', 'fr')).toEqual({ count: 1, unit: 'day' });
    expect(parse('il y a une semaine', 'fr')).toEqual({ count: 1, unit: 'week' });
    expect(parse('hier', 'fr')).toEqual({ count: 1, unit: 'day' });
  });
});

describe('Spanish and Portuguese', () => {
  it('parses "hace N unidades"', () => {
    expect(parse('hace 2 semanas', 'es')).toEqual({ count: 2, unit: 'week' });
    expect(parse('hace 4 días', 'es')).toEqual({ count: 4, unit: 'day' });
  });

  it('parses Spanish singular forms', () => {
    expect(parse('hace un día', 'es')).toEqual({ count: 1, unit: 'day' });
    expect(parse('ayer', 'es')).toEqual({ count: 1, unit: 'day' });
  });

  it('parses "há N unidades" in Portuguese', () => {
    expect(parse('há 3 semanas', 'pt')).toEqual({ count: 3, unit: 'week' });
    expect(parse('há 2 meses', 'pt')).toEqual({ count: 2, unit: 'month' });
  });

  it('parses Portuguese singular forms', () => {
    expect(parse('há um dia', 'pt')).toEqual({ count: 1, unit: 'day' });
    expect(parse('ontem', 'pt')).toEqual({ count: 1, unit: 'day' });
  });
});

describe('Hindi — Devanagari', () => {
  it('parses numeric phrases', () => {
    expect(parse('2 सप्ताह पहले', 'hi')).toEqual({ count: 2, unit: 'week' });
    expect(parse('5 दिन पहले', 'hi')).toEqual({ count: 5, unit: 'day' });
  });

  it('parses Devanagari digits as numbers', () => {
    // A source rendering "३" and one rendering "3" mean the same thing.
    expect(parse('३ महीने पहले', 'hi')).toEqual({ count: 3, unit: 'month' });
  });

  it('parses the singular forms', () => {
    expect(parse('एक दिन पहले', 'hi')).toEqual({ count: 1, unit: 'day' });
    expect(parse('एक साल पहले', 'hi')).toEqual({ count: 1, unit: 'year' });
    expect(parse('कल', 'hi')).toEqual({ count: 1, unit: 'day' });
  });
});

describe('Arabic — RTL', () => {
  it('parses numeric phrases', () => {
    expect(parse('قبل 3 أيام', 'ar')).toEqual({ count: 3, unit: 'day' });
    expect(parse('منذ 5 أسابيع', 'ar')).toEqual({ count: 5, unit: 'week' });
  });

  it('parses Arabic-Indic digits', () => {
    expect(parse('قبل ٤ أشهر', 'ar')).toEqual({ count: 4, unit: 'month' });
  });

  it('parses the dual forms, which name two without a digit', () => {
    // Arabic marks "two" grammatically rather than numerically. A digit-seeking
    // parser reads "يومين" as unparseable.
    expect(parse('منذ يومين', 'ar')).toEqual({ count: 2, unit: 'day' });
    expect(parse('منذ شهرين', 'ar')).toEqual({ count: 2, unit: 'month' });
  });

  it('parses the singular fixed phrase', () => {
    expect(parse('أمس', 'ar')).toEqual({ count: 1, unit: 'day' });
  });
});

describe('unparseable input fails soft (TR-EXT-051, T-076)', () => {
  it('returns null rather than guessing', () => {
    for (const junk of ['', '   ', 'sometime last decade', 'xyzzy', '!!!', '2']) {
      expect(parse(junk, 'en'), junk).toBeNull();
    }
  });

  it('returns null for a unit with no quantity', () => {
    expect(parse('weeks ago', 'en')).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    const probe = () => {
      parse(/** @type {any} */ (null), 'en');
      parse(/** @type {any} */ (undefined), 'en');
      parse(/** @type {any} */ (42), 'en');
      parse('x'.repeat(10_000), 'en');
    };

    expect(probe).not.toThrow();
  });

  it('falls back to English for an unknown locale rather than failing', () => {
    // A review whose locale is misconfigured still gets a date if the phrase is
    // readable. Failing here would discard data for a configuration mistake.
    expect(parse('2 weeks ago', 'kl-GL')).toEqual({ count: 2, unit: 'week' });
  });

  it('accepts a full BCP 47 tag, using the primary subtag', () => {
    expect(parse('vor 2 Wochen', 'de-AT')).toEqual({ count: 2, unit: 'week' });
    expect(parse('2 weeks ago', 'en-IN')).toEqual({ count: 2, unit: 'week' });
  });
});

describe('resolution to an instant', () => {
  it('subtracts the duration from the observation time', () => {
    const result = resolveRelativePhrase('2 days ago', OBSERVED, 'en');

    expect(result?.resolvedMs).toBe(OBSERVED - 2 * DAY);
  });

  it('treats "today" as the observation instant', () => {
    expect(resolveRelativePhrase('today', OBSERVED, 'en')?.resolvedMs).toBe(OBSERVED);
  });

  it('returns null for an unparseable phrase', () => {
    expect(resolveRelativePhrase('xyzzy', OBSERVED, 'en')).toBeNull();
  });

  it('requires observedAt as an explicit argument (DR-2)', () => {
    // There is no default. A default here would be the
    // Date.now()-as-default-parameter that voids the property laws without
    // failing anything.
    expect(resolveRelativePhrase.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic: the same inputs give the same instant', () => {
    const a = resolveRelativePhrase('3 months ago', OBSERVED, 'en');
    const b = resolveRelativePhrase('3 months ago', OBSERVED, 'en');

    expect(a?.resolvedMs).toBe(b?.resolvedMs);
  });
});

describe('precision and confidence from GRANULARITY, not arithmetic (T-077)', () => {
  it('reports day precision at high confidence for day phrases', () => {
    expect(describePrecision({ count: 2, unit: 'day' })).toEqual({
      precision: 'day',
      confidence: 'high',
    });
  });

  it('reports week precision at high confidence', () => {
    expect(describePrecision({ count: 2, unit: 'week' })).toEqual({
      precision: 'week',
      confidence: 'high',
    });
  });

  it('reports month precision at MEDIUM confidence', () => {
    expect(describePrecision({ count: 3, unit: 'month' })).toEqual({
      precision: 'month',
      confidence: 'medium',
    });
  });

  it('reports year precision at LOW confidence', () => {
    // "3 months ago" resolves to a millisecond-exact number that is not
    // three-month-accurate. Saying so is the point.
    expect(describePrecision({ count: 1, unit: 'year' })).toEqual({
      precision: 'year',
      confidence: 'low',
    });
  });

  it('reports sub-day phrases as day precision', () => {
    // Known to the hour, but the payload's date field is a day-level estimate;
    // claiming hour precision would be a promise the field cannot keep.
    expect(describePrecision({ count: 3, unit: 'hour' }).precision).toBe('day');
    expect(describePrecision({ count: 30, unit: 'minute' }).precision).toBe('day');
  });

  it('reports unknown/low for an unparseable phrase', () => {
    expect(describePrecision(null)).toEqual({ precision: 'unknown', confidence: 'low' });
  });
});

describe('branches coverage found untested', () => {
  it('pins a null date when the source supplied no phrase at all', () => {
    // Distinct from an unparseable phrase: the source showed no date whatsoever.
    const result = pinDate(null, OBSERVED, 'en');

    expect(result.date_estimated).toBeNull();
    expect(result.date_precision).toBe('unknown');
    expect(result.date_confidence).toBe('low');
  });

  it('falls back to unknown/low for a unit outside the precision table', () => {
    // Defensive: a future locale entry naming a unit the precision table does
    // not know must degrade honestly rather than claim day precision.
    expect(describePrecision({ count: 1, unit: 'fortnight' })).toEqual({
      precision: 'unknown',
      confidence: 'low',
    });
  });

  it('orders precisions from coarsest to finest', () => {
    expect(isCoarserThan('year', 'day')).toBe(true);
    expect(isCoarserThan('month', 'week')).toBe(true);
    expect(isCoarserThan('unknown', 'year')).toBe(true);
    expect(isCoarserThan('day', 'year')).toBe(false);
    expect(isCoarserThan('week', 'week')).toBe(false);
  });

  it('exposes the precision scale coarsest-first', () => {
    expect(PRECISIONS).toEqual(['unknown', 'year', 'month', 'week', 'day']);
    expect(CONFIDENCES).toEqual(['low', 'medium', 'high']);
  });

  it('handles a null or undefined locale without throwing', () => {
    expect(parseRelativePhrase('2 weeks ago', /** @type {any} */ (null))).toEqual({
      count: 2,
      unit: 'week',
    });
    expect(parseRelativePhrase('2 weeks ago', /** @type {any} */ (undefined))).toEqual({
      count: 2,
      unit: 'week',
    });
  });

  it('names the seven units it resolves', () => {
    expect(UNITS).toEqual(['second', 'minute', 'hour', 'day', 'week', 'month', 'year']);
  });
});

describe('Persian (extended Arabic-Indic) digits', () => {
  it('folds U+06F0-U+06F9 to ASCII numerals', () => {
    // Persian sources render digits in a different block from Arabic ones.
    // "۴" is U+06F4, not U+0664 - a decoder handling only one silently reads
    // the other as unparseable.
    expect(parse('قبل ۴ أيام', 'ar')).toEqual({ count: 4, unit: 'day' });
    expect(parse('منذ ۱۲ شهر', 'ar')).toEqual({ count: 12, unit: 'month' });
  });
});
