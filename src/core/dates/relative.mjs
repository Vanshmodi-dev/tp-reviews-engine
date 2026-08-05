import LOCALE_TABLE from './locales.json' with { type: 'json' };

/**
 * Relative-date phrase resolution.
 *
 * A relative date is lossy, locale-dependent, and re-renders differently on
 * every harvest. The raw phrase is kept verbatim as the audit trail; this
 * module turns it into a duration so an estimate can be pinned once and never
 * recomputed.
 *
 * **The phrase table is data** (`locales.json`, TR-EXT-052). Adding a locale is
 * an edit to that file and nothing here.
 *
 * TR-EXT-051: an unparseable phrase yields `null` and the record stays valid. A
 * review is never discarded because its date could not be read — the date is
 * the least important thing about it.
 *
 * @module core/dates/relative
 */

export const UNITS = Object.freeze(['second', 'minute', 'hour', 'day', 'week', 'month', 'year']);

/**
 * Milliseconds per unit.
 *
 * Month and year are averages, and deliberately so: the phrase "3 months ago"
 * carries no information about which months, so a calendar-exact subtraction
 * would be false precision. `precision.mjs` records that the estimate is coarse
 * rather than pretending otherwise.
 */
const MS = Object.freeze({
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_746_000,
  year: 31_556_952_000,
});

/** @typedef {{ count: number, unit: string }} Quantity */

/**
 * The locale entries, typed for lookup by an arbitrary string. The JSON
 * module's inferred type is a literal object with no index signature, which is
 * accurate but useless for a runtime locale tag.
 *
 * @type {Record<string, any>}
 */
const LOCALES = LOCALE_TABLE.locales;

export const SUPPORTED_LOCALES = Object.freeze(Object.keys(LOCALES));

/**
 * @param {string} locale A BCP 47 tag; only the primary subtag is used.
 * @returns {any} The locale entry, or the English entry as the fallback.
 */
function entryFor(locale) {
  // split with a limit and rejoin: no indexing, so no `string | undefined`
  // and no unreachable fallback branch.
  const primary = String(locale ?? '')
    .toLowerCase()
    .split('-', 1)
    .join('');

  return LOCALES[primary] ?? LOCALES.en;
}

/**
 * Normalises a phrase for matching: casefold, strip punctuation that varies by
 * source, and collapse whitespace.
 *
 * Digits are preserved in every script they may arrive in — Arabic-Indic and
 * Devanagari numerals are folded to ASCII, because a source rendering "٣" and
 * one rendering "3" mean the same thing.
 *
 * @param {string} phrase
 * @returns {string}
 */
function foldPhrase(phrase) {
  const ARABIC_INDIC = 0x0660;
  const EXT_ARABIC_INDIC = 0x06f0;
  const DEVANAGARI = 0x0966;
  const DIGIT_SPAN = 10;

  let out = '';
  for (const ch of phrase.toLowerCase()) {
    // A character from a for...of always has a code point; the cast removes a
    // branch that cannot be reached and therefore cannot be tested.
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp >= ARABIC_INDIC && cp < ARABIC_INDIC + DIGIT_SPAN) out += String(cp - ARABIC_INDIC);
    else if (cp >= EXT_ARABIC_INDIC && cp < EXT_ARABIC_INDIC + DIGIT_SPAN)
      out += String(cp - EXT_ARABIC_INDIC);
    else if (cp >= DEVANAGARI && cp < DEVANAGARI + DIGIT_SPAN) out += String(cp - DEVANAGARI);
    else out += ch;
  }

  return out
    .replaceAll(/[.,!?;:()[\]]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/**
 * Finds a fixed phrase that carries its own quantity — "yesterday", "gestern",
 * "أمس", and the Arabic duals.
 *
 * @param {string} folded
 * @param {any} entry
 * @returns {Quantity | null}
 */
function matchSpecial(folded, entry) {
  // `special` is present for every locale (asserted by test); `duals` is
  // Arabic-only, so that fallback is real.
  for (const table of [entry.special, entry.duals ?? {}]) {
    for (const [phrase, quantity] of Object.entries(table)) {
      if (folded === phrase || folded.includes(phrase)) {
        return /** @type {Quantity} */ (quantity);
      }
    }
  }
  return null;
}

/**
 * Finds the unit word in a phrase.
 *
 * Longest match wins, so "sekunden" is not matched as "sekunde" with a stray
 * "n", and Hindi "महीने" is not shadowed by a shorter entry.
 *
 * @param {string} folded
 * @param {any} entry
 * @returns {string | null}
 */
function matchUnit(folded, entry) {
  /** @type {{ unit: string, length: number } | null} */
  let best = null;

  for (const [unit, words] of Object.entries(entry.units)) {
    for (const word of /** @type {string[]} */ (words)) {
      if (folded.includes(word) && (best === null || word.length > best.length)) {
        best = { unit, length: word.length };
      }
    }
  }

  return best?.unit ?? null;
}

/**
 * Finds the quantity: a digit run, or an article meaning exactly one.
 *
 * **The article branch is the one that matters.** A regex of the shape
 * `(\d+)\s+(day|week)s?\s+ago` passes a naive suite and then silently fails on
 * every "a day ago" and "an hour ago" — the phrasings most common on recent
 * reviews, and therefore the ones a "newest first" display shows first
 * (TRD §21.6.1, IR-04).
 *
 * @param {string} folded
 * @param {any} entry
 * @returns {number | null}
 */
function matchCount(folded, entry) {
  const digits = /\d+/u.exec(folded);
  if (digits) return Number.parseInt(digits[0], 10);

  for (const article of /** @type {string[]} */ (entry.articles)) {
    if (new RegExp(`(?:^|\\s)${article}(?:\\s|$)`, 'u').test(folded)) return 1;
  }

  return null;
}

/**
 * Resolves a relative phrase into a quantity, or `null` when it cannot be read.
 *
 * @param {string} phrase The source's verbatim phrasing.
 * @param {string} [locale] BCP 47.
 * @returns {Quantity | null}
 */
export function parseRelativePhrase(phrase, locale = 'en') {
  if (typeof phrase !== 'string' || phrase.trim() === '') return null;

  const entry = entryFor(locale);
  const folded = foldPhrase(phrase);

  const special = matchSpecial(folded, entry);
  if (special !== null) return special;

  const unit = matchUnit(folded, entry);
  if (unit === null) return null;

  const count = matchCount(folded, entry);
  if (count === null) return null;

  return { count, unit };
}

/**
 * Resolves a phrase to an absolute instant by subtracting from `observedAt`.
 *
 * `observedAt` is a required parameter and there is no default. `core/` may not
 * read a clock (DR-2), and a default here would be the exact
 * `Date.now()`-as-default-parameter that voids the property laws without
 * failing anything.
 *
 * @param {string} phrase
 * @param {number} observedAtMs Epoch milliseconds when the phrase was observed.
 * @param {string} [locale]
 * @returns {{ resolvedMs: number, quantity: Quantity } | null}
 */
export function resolveRelativePhrase(phrase, observedAtMs, locale = 'en') {
  const quantity = parseRelativePhrase(phrase, locale);
  if (quantity === null) return null;

  const perUnit = MS[/** @type {keyof typeof MS} */ (quantity.unit)];
  if (perUnit === undefined) return null;

  return { resolvedMs: observedAtMs - quantity.count * perUnit, quantity };
}
