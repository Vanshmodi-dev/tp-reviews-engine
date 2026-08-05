import { describe, expect, it } from 'vitest';

import { MAX_TEXT_LENGTH, normalize } from '../../../src/core/normalize/index.mjs';
import {
  decodeEntities,
  hasSurvivingMarkup,
  stripMarkup,
} from '../../../src/core/normalize/markup.mjs';
import { countGraphemes } from '../../../src/core/normalize/unicode.mjs';

/**
 * The adversarial corpus (T-063) — the eight case classes of IMPL PLAN §37.3.
 *
 * "This phase's real deliverable is not the eight steps; it is the corpus that
 * proves they work."
 *
 * Every character that cannot be typed safely is built with
 * `String.fromCodePoint`. A test file full of invisible literals is a test file
 * nobody can review, and these characters get mangled passing through editors,
 * shells, and diffs — which would silently turn a hostile case into a benign
 * one and leave the suite green for the wrong reason.
 */

const cp = (/** @type {number} */ n) => String.fromCodePoint(n);

const ZWSP = cp(0x200b);
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);
const BOM = cp(0xfeff);
const SOFT_HYPHEN = cp(0x00ad);
const LRM = cp(0x200e);
const RLM = cp(0x200f);
const RLO = cp(0x202e);
const LRO = cp(0x202d);
const RLI = cp(0x2067);
const NUL = cp(0x00);
const DEL = cp(0x7f);

/** @param {string} s */
const clean = (s) => normalize(s).text;

// ---------------------------------------------------------- 1. Nested entities

describe('class 1 — nested entities', () => {
  it('decodes a single-encoded tag and removes it', () => {
    expect(clean('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
  });

  it('decodes a DOUBLE-encoded tag and removes it', () => {
    // The documented adversarial case. A single-pass decoder leaves
    // `&lt;script&gt;` as literal text, which re-encodes downstream into a live
    // tag - the payload looks clean and the client site executes it.
    expect(clean('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')).toBe('alert(1)');
  });

  it('decodes a TRIPLE-encoded tag and removes it', () => {
    expect(clean('&amp;amp;lt;script&amp;amp;gt;')).toBe('');
  });

  it('resolves decimal numeric references', () => {
    expect(clean('&#60;script&#62;x&#60;/script&#62;')).toBe('x');
  });

  it('resolves hexadecimal numeric references, either case', () => {
    expect(clean('&#x3C;b&#x3E;bold&#x3C;/b&#x3E;')).toBe('bold');
    expect(clean('&#X3c;i&#X3e;italic&#X3c;/i&#X3e;')).toBe('italic');
  });

  it('leaves an unknown entity as literal text', () => {
    // Safe: an unrecognised `&foo;` is not markup and cannot become markup,
    // because step 2 removes anything that could.
    expect(clean('cost &foo; more')).toBe('cost &foo; more');
  });

  it('decodes ordinary entities without eating the text', () => {
    expect(clean('Tom &amp; Jerry&rsquo;s caf&eacute;')).toBe('Tom & Jerry’s café');
  });

  it('does not loop forever on a self-referential encoding', () => {
    const bomb = '&amp;'.repeat(50);

    expect(() => clean(bomb)).not.toThrow();
  });
});

// ------------------------------ 2. Markup that survives naive stripping

describe('class 2 — markup that survives naive stripping', () => {
  it('removes an unclosed tag at the end of the text', () => {
    // Leaving it lets a later concatenation complete the tag.
    expect(clean('great service <div')).toBe('great service');
  });

  it('removes a tag whose attributes contain a newline', () => {
    expect(clean('a <img\nsrc=x\nonerror=alert(1)> b')).toBe('a b');
  });

  it('removes comment-wrapped markup, including unterminated comments', () => {
    expect(clean('before <!-- <script>alert(1)</script> --> after')).toBe('before after');
    expect(clean('before <!-- dangling')).toBe('before');
  });

  it('removes CDATA sections', () => {
    expect(clean('x <![CDATA[ <script>alert(1)</script> ]]> y')).toBe('x y');
  });

  it('removes a closing tag with no opener', () => {
    expect(clean('text </script> more')).toBe('text more');
  });

  it('removes a processing instruction and a declaration', () => {
    expect(clean('a <?php echo 1; ?> b')).toBe('a b');
    expect(clean('a <!DOCTYPE html> b')).toBe('a b');
  });

  it('KEEPS a bare less-than that is not a tag', () => {
    // "5 < 10" is ordinary review text. A stripper that eats it is corrupting
    // reviews to look safe.
    expect(clean('5 < 10 and 10 > 5')).toBe('5 < 10 and 10 > 5');
    expect(clean('price < $20')).toBe('price < $20');
  });

  it('removes nested and interleaved tags entirely', () => {
    expect(clean('<b><i>bold italic</i></b>')).toBe('bold italic');
    expect(clean('a<b>c</b>d')).toBe('acd');
  });

  it('removes a tag split across an entity boundary', () => {
    // Stripping joins text that was separated by a tag, and the join can form
    // an entity - which is why decode and strip alternate rather than run once.
    expect(hasSurvivingMarkup(clean('&a<x>mp;lt;script&a<x>mp;gt;'))).toBe(false);
  });

  it('leaves nothing that the self-check would flag, for every case above', () => {
    const cases = [
      '&amp;lt;script&amp;gt;',
      '<div',
      '<!-- <script> -->',
      '</script>',
      '<img src=x onerror=alert(1)>',
      '&#60;script&#62;',
    ];

    for (const input of cases) {
      expect(hasSurvivingMarkup(clean(input)), input).toBe(false);
    }
  });
});

// -------------------------------------------------- 3. Bidi and zero-width

describe('class 3 — bidi and zero-width', () => {
  it('strips an RLO override', () => {
    // RLO makes text render as its own reverse: a review can be made to read
    // as the opposite of what it says.
    expect(clean(`good ${RLO}service`)).toBe('good service');
  });

  it('strips an LRO override and a bidi isolate', () => {
    expect(clean(`a${LRO}b${RLI}c`)).toBe('abc');
  });

  it('KEEPS bidi marks, which mixed-direction text needs (TR-NORM-012)', () => {
    // Marks and overrides are different characters with different purposes.
    // Stripping marks corrupts legitimate Arabic and Hebrew reviews.
    expect(clean(`مرحبا ${LRM}world`)).toContain(LRM);
    expect(clean(`shalom ${RLM}שלום`)).toContain(RLM);
  });

  it('strips zero-width space, non-joiner, BOM, and soft hyphen', () => {
    expect(clean(`a${ZWSP}b${ZWNJ}c${BOM}d${SOFT_HYPHEN}e`)).toBe('abcde');
  });

  it('strips a BOM appearing mid-string', () => {
    expect(clean(`text${BOM}more`)).toBe('textmore');
  });

  it('strips a stray ZWJ that is not joining emoji', () => {
    expect(clean(`zero${ZWJ}width`)).toBe('zerowidth');
  });

  it('stops zero-width characters propping a whitespace run apart', () => {
    // Step 4 runs before step 5 precisely so this collapses.
    expect(clean(`a ${ZWSP} b`)).toBe('a b');
  });
});

// ------------------------------------------------------------- 4. Emoji

describe('class 4 — emoji', () => {
  const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
  const THUMBS_UP_TONE = '\u{1F44D}\u{1F3FD}';
  const FLAG_GB = '\u{1F1EC}\u{1F1E7}';

  it('KEEPS a ZWJ family sequence intact', () => {
    // Four ZWJs glue five code points into one glyph. Stripping them turns one
    // family into four separate people.
    expect(clean(`we loved it ${FAMILY}`)).toContain(FAMILY);
  });

  it('keeps a skin-tone modifier attached', () => {
    expect(clean(`nice ${THUMBS_UP_TONE}`)).toContain(THUMBS_UP_TONE);
  });

  it('keeps a regional-indicator flag sequence intact', () => {
    expect(clean(`from ${FLAG_GB}`)).toContain(FLAG_GB);
  });

  it('counts a family emoji as ONE grapheme, not five', () => {
    expect(countGraphemes(FAMILY)).toBe(1);
  });

  it('does not split a ZWJ sequence at the exact length boundary', () => {
    // TR-NORM-020. Cutting by code units here produces mojibake on the
    // client's website - visible garbage where a person used an emoji.
    const filler = 'a'.repeat(MAX_TEXT_LENGTH - 1);
    const result = normalize(`${filler}${FAMILY}${FAMILY}`);

    expect(result.text_clipped).toBe(true);
    expect(countGraphemes(result.text)).toBe(MAX_TEXT_LENGTH);
    expect(result.text.endsWith(FAMILY)).toBe(true);
  });

  it('never emits a lone surrogate', () => {
    const result = normalize(`${'b'.repeat(MAX_TEXT_LENGTH - 1)}${THUMBS_UP_TONE}x`);

    expect(
      /[\uD800-\uDFFF]/u.test(result.text.replaceAll(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, '')),
    ).toBe(false);
  });
});

// ----------------------------------------------------------- 5. Scripts

describe('class 5 — scripts', () => {
  it('preserves CJK', () => {
    expect(clean('とても良いサービスでした')).toBe('とても良いサービスでした');
    expect(clean('非常好的服务')).toBe('非常好的服务');
  });

  it('preserves Arabic', () => {
    expect(clean('خدمة ممتازة جدا')).toBe('خدمة ممتازة جدا');
  });

  it('preserves Hebrew', () => {
    expect(clean('שירות מצוין')).toBe('שירות מצוין');
  });

  it('preserves Devanagari', () => {
    expect(clean('बहुत अच्छी सेवा')).toBe('बहुत अच्छी सेवा');
  });

  it('preserves a mixed-direction string', () => {
    expect(clean('Great café مرحبا 良い')).toBe('Great café مرحبا 良い');
  });

  it('composes to NFC so equal-looking text is equal text', () => {
    const decomposed = 'café';
    const composed = 'café';

    expect(clean(decomposed)).toBe(clean(composed));
    expect(clean(decomposed)).toBe('café');
  });

  it('counts a Devanagari cluster as one grapheme', () => {
    expect(countGraphemes('क्षि')).toBe(1);
  });
});

// ------------------------------------------------------------ 6. Length

describe('class 6 — length', () => {
  it('leaves text exactly at the bound alone', () => {
    const result = normalize('x'.repeat(MAX_TEXT_LENGTH));

    expect(result.text_clipped).toBe(false);
    expect(countGraphemes(result.text)).toBe(MAX_TEXT_LENGTH);
  });

  it('leaves text one under the bound alone', () => {
    const result = normalize('x'.repeat(MAX_TEXT_LENGTH - 1));

    expect(result.text_clipped).toBe(false);
    expect(countGraphemes(result.text)).toBe(MAX_TEXT_LENGTH - 1);
  });

  it('clips text one over the bound', () => {
    const result = normalize('x'.repeat(MAX_TEXT_LENGTH + 1));

    expect(result.text_clipped).toBe(true);
    expect(countGraphemes(result.text)).toBe(MAX_TEXT_LENGTH);
  });

  it('clips 10,000 graphemes to the bound', () => {
    const result = normalize('y'.repeat(10_000));

    expect(result.text_clipped).toBe(true);
    expect(countGraphemes(result.text)).toBe(MAX_TEXT_LENGTH);
  });

  it('bounds AFTER cleaning, not before (EDR-020)', () => {
    // A review padded with 10,000 characters of markup would, if bounded first,
    // be cut before the markup was removed - discarding the real text and
    // keeping the padding.
    const padding = '<span>'.repeat(2000);
    const result = normalize(`${padding}the actual review text`);

    expect(result.text).toBe('the actual review text');
    expect(result.text_clipped).toBe(false);
  });
});

// ----------------------------------------------------------- 7. Control

describe('class 7 — control characters', () => {
  it('strips every C0 control except TAB and LF', () => {
    for (let code = 0x00; code <= 0x1f; code += 1) {
      if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
      expect(clean(`a${cp(code)}b`), `U+${code.toString(16)}`).toBe('ab');
    }
  });

  it('strips DEL and the whole C1 range', () => {
    expect(clean(`a${DEL}b`)).toBe('ab');
    for (let code = 0x80; code <= 0x9f; code += 1) {
      expect(clean(`a${cp(code)}b`), `U+${code.toString(16)}`).toBe('ab');
    }
  });

  it('strips NUL', () => {
    expect(clean(`a${NUL}b`)).toBe('ab');
  });

  it('converts TAB into a single space rather than deleting it', () => {
    // TAB is whitespace, not a control to strip: it separates words.
    expect(clean('a\tb')).toBe('a b');
  });

  it('canonicalises CRLF and lone CR to LF', () => {
    expect(clean('a\r\nb')).toBe('a\nb');
    expect(clean('a\rb')).toBe('a\nb');
    expect(clean('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('collapses three or more newlines to a paragraph break', () => {
    expect(clean('a\n\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('collapses horizontal runs and trims', () => {
    expect(clean('   a     b   ')).toBe('a b');
  });
});

// -------------------------------------------------------- 8. Degenerate

describe('class 8 — degenerate input', () => {
  it('handles the empty string', () => {
    const result = normalize('');

    expect(result.text).toBe('');
    expect(result.text_clipped).toBe(false);
    expect(result.text_truncated).toBe(false);
    expect(result.markup_survived).toBe(false);
  });

  it('reduces whitespace-only input to empty', () => {
    expect(clean('   \t \n \r\n  ')).toBe('');
  });

  it('reduces invisible-only input to empty', () => {
    expect(clean(`${ZWSP}${BOM}${SOFT_HYPHEN}${RLO}`)).toBe('');
  });

  it('reduces markup-only input to empty', () => {
    expect(clean('<div><span></span></div>')).toBe('');
  });

  it('handles a single combining mark with no base', () => {
    const result = normalize('́');

    expect(result.markup_survived).toBe(false);
    expect(countGraphemes(result.text)).toBeLessThanOrEqual(1);
  });

  it('handles a single character', () => {
    expect(clean('x')).toBe('x');
  });
});

// ------------------------------------------------- truncation markers (step 6)

describe('truncation markers', () => {
  it('removes a trailing ellipsis-More marker and records it', () => {
    const result = normalize('The service was great … More');

    expect(result.text).toBe('The service was great');
    expect(result.text_truncated).toBe(true);
  });

  it('removes an ellipsis-anchored "Read more"', () => {
    expect(normalize('Loved it. ... Read more').text).toBe('Loved it.');
  });

  it('does NOT strip a bare trailing "Read more" with no ellipsis', () => {
    // Deliberately conservative. A missed marker leaves a cosmetic tail; a
    // false positive deletes the last words of a real review.
    expect(normalize('I would definitely read more').text).toBe('I would definitely read more');
    expect(normalize('cost and more').text).toBe('cost and more');
  });

  it('does NOT strip "more" from the middle of a sentence', () => {
    // "read more about our returns policy" is prose, not a marker.
    const result = normalize('I would read more about this place before going');

    expect(result.text_truncated).toBe(false);
    expect(result.text).toBe('I would read more about this place before going');
  });

  it('keeps text_truncated and text_clipped as separate flags (TR-NORM-022)', () => {
    const result = normalize(`${'z'.repeat(MAX_TEXT_LENGTH + 10)} … More`);

    expect(result.text_truncated).toBe(true);
    expect(result.text_clipped).toBe(true);
  });
});

// ------------------------------------------------ the unit steps in isolation

describe('step primitives', () => {
  it('decodeEntities repeats until stable', () => {
    expect(decodeEntities('&amp;amp;lt;')).toBe('<');
  });

  it('stripMarkup removes tags without decoding', () => {
    expect(stripMarkup('&lt;b&gt;<i>x</i>')).toBe('&lt;b&gt;x');
  });

  it('hasSurvivingMarkup detects what the pipeline must never emit', () => {
    expect(hasSurvivingMarkup('<script')).toBe(true);
    expect(hasSurvivingMarkup('&lt;script&gt;')).toBe(true);
    expect(hasSurvivingMarkup('5 < 10')).toBe(false);
    expect(hasSurvivingMarkup('perfectly ordinary text')).toBe(false);
  });
});

describe('branches coverage found untested', () => {
  it('strips a ZWJ at the very start of the text', () => {
    // Reaches the "no preceding character" arm of the emoji-glue check.
    expect(clean(`${ZWJ}hello`)).toBe('hello');
  });

  it('strips a ZWJ at the very end of the text', () => {
    // Reaches the "no following character" arm.
    expect(clean(`hello${ZWJ}`)).toBe('hello');
  });

  it('strips a ZWJ that joins a pictograph to ordinary text', () => {
    expect(clean(`\u{1F44D}${ZWJ}text`)).toBe('\u{1F44D}text');
    expect(clean(`text${ZWJ}\u{1F44D}`)).toBe('text\u{1F44D}');
  });

  it('gives up after the decode-pass bound rather than looping forever', () => {
    // Six layers of encoding exceeds MAX_DECODE_PASSES. The remainder is left
    // as literal text and the self-check is what catches it - deliberately, so
    // a crafted input cannot spin the loop.
    const sixLayers = `${'&amp;'.repeat(6)}lt;script${'&amp;'.repeat(6)}gt;`;
    const result = normalize(sixLayers);

    expect(() => normalize(sixLayers)).not.toThrow();
    expect(typeof result.text).toBe('string');
  });

  it('decodes exactly at the pass bound', () => {
    expect(decodeEntities('&amp;amp;amp;amp;lt;')).toBe('<');
  });
});
