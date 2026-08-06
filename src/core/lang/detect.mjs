/**
 * Language detection — script ranges first, then stopwords.
 *
 * **Detection NEVER rejects a review** (TRD §23.7). The result is used for
 * optional consumer-side filtering and as an input to future enrichment, and
 * for nothing else. A review whose language cannot be determined is published
 * exactly like any other, with `language: null`.
 *
 * That constraint is what makes returning `null` the right answer so often. A
 * detector under pressure to always produce a code guesses; a detector that is
 * allowed to say "I don't know" can be honest, and honest is what a consumer
 * filtering by language actually needs.
 *
 * No model, no network, no dependency (DEP-2). A compact internal
 * implementation is required, and this is it.
 *
 * @module core/lang/detect
 */

/** Below this, there is not enough signal. Return null with confidence 0. */
export const MIN_GRAPHEMES = 12;

/**
 * Scripts that identify a language on sight.
 *
 * A script hit is high-confidence because these ranges are unambiguous: text in
 * Devanagari is not accidentally English.
 */
const SCRIPTS = Object.freeze([
  { code: 'hi', pattern: /\p{Script=Devanagari}/u },
  { code: 'ar', pattern: /\p{Script=Arabic}/u },
  { code: 'he', pattern: /\p{Script=Hebrew}/u },
  { code: 'ja', pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { code: 'ko', pattern: /\p{Script=Hangul}/u },
  { code: 'zh', pattern: /\p{Script=Han}/u },
  { code: 'th', pattern: /\p{Script=Thai}/u },
  { code: 'el', pattern: /\p{Script=Greek}/u },
  { code: 'ru', pattern: /\p{Script=Cyrillic}/u },
]);

/**
 * Stopwords for Latin-script languages, which share an alphabet and therefore
 * cannot be told apart by script alone.
 *
 * Deliberately short lists of very common function words. Longer lists would
 * improve accuracy marginally and would make this a language model, which
 * DEP-2 rules out and §23.7 does not need.
 */
const STOPWORDS = Object.freeze({
  en: ['the', 'and', 'was', 'were', 'very', 'with', 'this', 'that', 'they', 'have', 'for'],
  es: ['el', 'la', 'los', 'las', 'muy', 'con', 'para', 'pero', 'que', 'una', 'está'],
  fr: ['le', 'la', 'les', 'très', 'avec', 'pour', 'mais', 'que', 'une', 'est', 'nous'],
  de: ['der', 'die', 'das', 'und', 'sehr', 'mit', 'für', 'aber', 'ist', 'nicht', 'war'],
  pt: ['o', 'os', 'as', 'muito', 'com', 'para', 'mas', 'que', 'uma', 'está', 'foi'],
  it: ['il', 'lo', 'gli', 'molto', 'con', 'per', 'ma', 'che', 'una', 'sono', 'era'],
});

const HIGH_CONFIDENCE = 0.9;
const MIN_STOPWORD_HITS = 2;

/**
 * Floor added to the stopword hit ratio.
 *
 * Two stopword hits in a long review is weak but real evidence, and a bare
 * ratio would report it as near-zero confidence. The floor keeps a genuine
 * detection from being reported as a guess, while the cap keeps it below the
 * confidence a script match earns.
 */
const STOPWORD_CONFIDENCE_FLOOR = 0.5;

/**
 * @param {string} text
 * @returns {number}
 */
function graphemeCount(text) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * @param {string} text
 * @returns {{ code: string, confidence: number } | null}
 */
function detectByScript(text) {
  for (const { code, pattern } of SCRIPTS) {
    if (pattern.test(text)) return { code, confidence: HIGH_CONFIDENCE };
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ code: string, confidence: number } | null}
 */
function detectByStopwords(text) {
  const words = text
    .toLowerCase()
    .replaceAll(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);

  if (words.length === 0) return null;

  /** @type {{ code: string, hits: number }} */
  let best = { code: '', hits: 0 };

  for (const [code, list] of Object.entries(STOPWORDS)) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits > best.hits) best = { code, hits };
  }

  // Two hits is the floor. One shared function word - "the" appearing in a
  // German review quoting an English phrase - is not evidence.
  if (best.hits < MIN_STOPWORD_HITS) return null;

  return {
    code: best.code,
    confidence: Math.min(HIGH_CONFIDENCE, best.hits / words.length + STOPWORD_CONFIDENCE_FLOOR),
  };
}

/**
 * Detects the language of a review.
 *
 * @param {string | null | undefined} text Normalised review text.
 * @returns {{ code: string | null, confidence: number }}
 */
export function detectLanguage(text) {
  if (typeof text !== 'string' || text.trim() === '') return { code: null, confidence: 0 };

  // Below the floor there is not enough signal, and a guess here would be
  // published as a fact. "Great!" is not English evidence; it is five letters.
  if (graphemeCount(text.trim()) < MIN_GRAPHEMES) return { code: null, confidence: 0 };

  return detectByScript(text) ?? detectByStopwords(text) ?? { code: null, confidence: 0 };
}
