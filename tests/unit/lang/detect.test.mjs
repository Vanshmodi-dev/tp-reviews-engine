import { describe, expect, it } from 'vitest';

import { MIN_GRAPHEMES, detectLanguage } from '../../../src/core/lang/detect.mjs';
import {
  foldForComparison,
  isSimilarEnough,
  similarity,
} from '../../../src/core/util/similarity.mjs';

describe('language detection never rejects a review (§23.7)', () => {
  it('returns null below the grapheme floor rather than guessing', () => {
    // "Great!" is not English evidence; it is five letters.
    expect(detectLanguage('Great!')).toEqual({ code: null, confidence: 0 });
    expect(detectLanguage('x'.repeat(MIN_GRAPHEMES - 1)).code).toBeNull();
  });

  it('returns null for empty, whitespace, and non-string input', () => {
    for (const value of ['', '   ', null, undefined, 42]) {
      expect(detectLanguage(/** @type {any} */ (value)).code).toBeNull();
    }
  });

  it('never throws, whatever it is given', () => {
    const probe = () => {
      detectLanguage('x'.repeat(50_000));
      detectLanguage('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
      detectLanguage(/** @type {any} */ ({}));
    };

    expect(probe).not.toThrow();
  });

  it('identifies non-Latin scripts on sight', () => {
    expect(detectLanguage('बहुत अच्छी सेवा थी और स्टाफ बहुत मददगार').code).toBe('hi');
    expect(detectLanguage('خدمة ممتازة جدا والموظفون متعاونون للغاية').code).toBe('ar');
    expect(detectLanguage('שירות מצוין והצוות היה מאוד עוזר ואדיב').code).toBe('he');
    expect(detectLanguage('とても良いサービスでした また来たいです').code).toBe('ja');
    expect(detectLanguage('매우 좋은 서비스였습니다 다시 오고 싶어요').code).toBe('ko');
    expect(detectLanguage('非常好的服务我们一定会再来的谢谢').code).toBe('zh');
  });

  it('separates Latin-script languages by stopwords', () => {
    expect(detectLanguage('The staff were very helpful and the food was excellent').code).toBe(
      'en',
    );
    expect(detectLanguage('El servicio fue muy bueno y la comida estaba deliciosa').code).toBe(
      'es',
    );
    expect(detectLanguage('Le service était très bon et la nourriture excellente').code).toBe('fr');
    expect(detectLanguage('Der Service war sehr gut und das Essen war lecker').code).toBe('de');
  });

  it('returns null when Latin text has too little signal to choose', () => {
    // Better an honest null than a coin-flip published as a language.
    expect(detectLanguage('asdf qwer zxcv hjkl uiop').code).toBeNull();
  });

  it('does not decide on a single shared function word', () => {
    // "the" appearing once inside a German review is not evidence of English.
    const result = detectLanguage('Wir waren gestern dort the Essen war lecker');

    expect(result.code === 'de' || result.code === null).toBe(true);
  });

  it('reports a confidence between 0 and 1', () => {
    for (const text of ['The staff were very helpful and the food was excellent', 'x'.repeat(20)]) {
      const { confidence } = detectLanguage(text);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and for formatting-only differences', () => {
    expect(similarity('great service', 'great service')).toBe(1);
    expect(similarity('Great Service!', 'great service')).toBe(1);
    expect(similarity('  great   service  ', 'great service')).toBe(1);
    expect(similarity('gréat sérvice', 'great service')).toBe(1);
  });

  it('is 0 when nothing is shared', () => {
    expect(similarity('abcdef', 'zyxwvu')).toBe(0);
  });

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'something')).toBe(0);
    expect(similarity('something', '')).toBe(0);
  });

  it('is high for a near-duplicate and low for a different review', () => {
    const original = 'The staff were lovely and the food was excellent';
    const nearDuplicate = 'The staff were lovely and the food was excellent!';
    const different = 'Parking was impossible and nobody helped us';

    expect(similarity(original, nearDuplicate)).toBeGreaterThan(0.92);
    expect(similarity(original, different)).toBeLessThan(0.92);
  });

  it('is symmetric', () => {
    expect(similarity('abcdef', 'abcxyz')).toBe(similarity('abcxyz', 'abcdef'));
  });

  it('stays within 0..1 for every pair tried', () => {
    const samples = ['', 'a', 'ab', 'hello world', '🎉🎉', 'ünïcödé', 'x'.repeat(200)];

    for (const a of samples) {
      for (const b of samples) {
        const s = similarity(a, b);
        expect(s, `${a} vs ${b}`).toBeGreaterThanOrEqual(0);
        expect(s, `${a} vs ${b}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('takes its threshold from the caller rather than assuming one', () => {
    // Identity verification uses 0.82; near-duplicate detection uses 0.92. The
    // two callers have different tolerances for being wrong, so neither number
    // is baked in here.
    expect(isSimilarEnough('Commerce Insight', 'Commerce Insight Ltd', 0.5)).toBe(true);
    expect(isSimilarEnough('Commerce Insight', 'Commerce Insight Ltd', 0.99)).toBe(false);
  });

  it('folds for comparison more aggressively than the normaliser does', () => {
    expect(foldForComparison('Café — "Great!"')).toBe('cafe great');
  });

  it('handles non-string input without throwing', () => {
    expect(similarity(/** @type {any} */ (null), 'x')).toBe(0);
    expect(foldForComparison(/** @type {any} */ (undefined))).toBe('');
  });
});
