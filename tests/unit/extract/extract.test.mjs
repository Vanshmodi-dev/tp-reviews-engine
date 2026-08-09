import { describe, expect, it } from 'vitest';

import {
  attr,
  decodeEntities,
  descendants,
  parseHtml,
  textOf,
} from '../../../src/core/extract/html.mjs';
import { compileSelector, query, queryAll } from '../../../src/core/extract/query.mjs';
import { detachReply, readReply } from '../../../src/core/extract/reply.mjs';
import { countStars, parseRating, readNumber } from '../../../src/core/extract/rating.mjs';
import { extractText } from '../../../src/core/extract/text.mjs';
import { extractMeta, readCount } from '../../../src/core/extract/meta.mjs';
import { extractAuthor } from '../../../src/core/extract/author.mjs';
import {
  classifySignals,
  detectSignals,
  hasEmptyState,
} from '../../../src/core/extract/signals.mjs';

describe('T-187 — the markup reader', () => {
  it('builds a tree with attributes, text, and nesting', () => {
    const root = parseHtml('<div class="a"><span id="s">hi</span></div>');
    const div = /** @type {any} */ (root.children[0]);

    expect(div.tag).toBe('div');
    expect(div.attrs['class']).toBe('a');
    expect(textOf(div)).toBe(' hi ');
    expect(attr(div.children[0], 'id')).toBe('s');
  });

  it('treats a bare "<" in text as text, not a tag', () => {
    // "5 < 6" is ordinary review prose. A reader that swallowed it would lose
    // the rest of the review.
    expect(textOf(parseHtml('<p>5 < 6 always</p>'))).toContain('5 < 6 always');
  });

  it('ignores a close tag with no matching open element', () => {
    // Guessing what an unmatched `</div>` closes produces a plausible-looking
    // tree that does not match the document, which is worse than a tree that is
    // visibly wrong.
    const root = parseHtml('<a><b>x</b></div></a>');

    expect(descendants(root).map((element) => element.tag)).toEqual(['a', 'b']);
  });

  it('closes unclosed elements at end of input', () => {
    expect(textOf(parseHtml('<div><span>text'))).toContain('text');
  });

  it('never treats script content as markup', () => {
    const root = parseHtml('<div><script>if (a<b) x()</script><p>after</p></div>');

    expect(textOf(root)).not.toContain('if (a');
    expect(textOf(root)).toContain('after');
  });

  it('handles void and self-closing elements without nesting the rest', () => {
    const root = parseHtml('<div><img src="a"><br/><span>tail</span></div>');
    const div = /** @type {any} */ (root.children[0]);

    expect(div.children.map((/** @type {any} */ c) => c.tag ?? '#text')).toEqual([
      'img',
      'br',
      'span',
    ]);
  });

  it('reads unquoted, single-quoted, and double-quoted attribute values', () => {
    const element = /** @type {any} */ (parseHtml('<i a=1 b=\'two\' c="three x">').children[0]);

    expect(element.attrs).toEqual({ a: '1', b: 'two', c: 'three x' });
  });

  it('skips comments and doctypes', () => {
    const root = parseHtml('<!doctype html><!-- note --><p>body</p>');

    expect(descendants(root).map((element) => element.tag)).toEqual(['p']);
  });

  it('separates block elements but not inline ones', () => {
    // `Greatfood` and `Hel lo` are both wrong, in opposite directions.
    expect(textOf(parseHtml('<p>Great</p><p>food</p>')).replace(/\s+/gu, ' ').trim()).toBe(
      'Great food',
    );
    expect(textOf(parseHtml('<span><b>Hel</b>lo</span>'))).toBe('Hello');
  });

  describe('entity decoding', () => {
    it('decodes named, decimal, and hex references', () => {
      expect(decodeEntities('a &amp; b &#39;c&#39; &#x27;d&#x27;')).toBe("a & b 'c' 'd'");
    });

    it('decodes &nbsp; to U+00A0, not to a plain space', () => {
      // It IS U+00A0, and pretending otherwise here would move a whitespace
      // decision out of the normaliser, which is the one place §23.3 puts it.
      expect(decodeEntities('a&nbsp;b')).toBe('a b');
    });

    it('leaves an unknown entity alone rather than guessing', () => {
      expect(decodeEntities('&notarealentity; &amp;')).toBe('&notarealentity; &');
    });

    it('leaves a lone surrogate as source text', () => {
      // `fromCodePoint` does NOT refuse this — it returns a lone surrogate
      // happily, and the ill-formed string survives to JSON serialisation and
      // hashing, where it becomes a replacement character and a content hash
      // that changes on a round-trip.
      expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
      expect(decodeEntities('&#xDFFF;')).toBe('&#xDFFF;');
      expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
    });

    it('is a no-op on text with no ampersand', () => {
      expect(decodeEntities('plain text')).toBe('plain text');
    });
  });
});

describe('T-187 — the selector subset', () => {
  const root = parseHtml(
    `<div role="feed">
       <article class="r one" data-id="1"><span aria-label="Review by Ann">x</span></article>
       <article class="r two" data-id="2"><b><span aria-label="Review by Bo">y</span></b></article>
     </div>`,
  );

  it('matches tag, class, id, and attribute compounds', () => {
    expect(queryAll(root, 'article').length).toBe(2);
    expect(queryAll(root, '.r.one').length).toBe(1);
    expect(queryAll(root, '[data-id="2"]').length).toBe(1);
    expect(queryAll(root, '*').length).toBeGreaterThan(4);
  });

  it('supports ^=, $= and *= on attributes', () => {
    expect(queryAll(root, "[aria-label^='Review by']").length).toBe(2);
    expect(queryAll(root, "[aria-label$='Ann']").length).toBe(1);
    expect(queryAll(root, "[aria-label*='by B']").length).toBe(1);
  });

  it('does not split a quoted attribute value containing a space', () => {
    // The defect fixture 019 exposed. A naive whitespace split turns
    // `[aria-label^='Review by']` into two nonsense tokens, the strategy
    // throws, and the field silently resolves from the next one down.
    expect(query(root, "[aria-label^='Review by']")?.attrs['aria-label']).toBe('Review by Ann');
  });

  it('distinguishes the descendant and child combinators', () => {
    expect(queryAll(root, 'article span').length).toBe(2);
    expect(queryAll(root, 'article > span').length).toBe(1);
    expect(queryAll(root, 'div > article > b > span').length).toBe(1);
  });

  it('supports comma groups', () => {
    expect(queryAll(root, '.one, .two').length).toBe(2);
  });

  it('REJECTS pseudo-classes rather than ignoring them', () => {
    // A silently-ignored `:not(.reply)` widens the match, so a strategy meant
    // to exclude owner replies would include them — and the pack author has no
    // way to discover it, because the extraction still looks plausible.
    expect(() => compileSelector('article:first-child')).toThrow(/pseudo-class/u);
    expect(() => compileSelector(':not(.reply)')).toThrow(/pseudo-class/u);
  });

  it('REJECTS sibling combinators and unsupported attribute operators', () => {
    expect(() => compileSelector('a + b')).toThrow(/sibling combinator/u);
    expect(() => compileSelector('a ~ b')).toThrow(/sibling combinator/u);
    expect(() => compileSelector('[lang|=en]')).toThrow(/outside the supported subset/u);
    expect(() => compileSelector('[class~=r]')).toThrow(/outside the supported subset/u);
  });

  it('REJECTS malformed selectors instead of matching nothing quietly', () => {
    expect(() => compileSelector('')).toThrow(/empty/u);
    expect(() => compileSelector('   ')).toThrow(/empty/u);
    expect(() => compileSelector('[unclosed')).toThrow(/unbalanced bracket/u);
    expect(() => compileSelector("[a='x]")).toThrow(/unterminated quote/u);
    expect(() => compileSelector('a,,b')).toThrow(/empty/u);
    expect(() => compileSelector('%%%')).toThrow(/not supported/u);
    expect(() => compileSelector('[]')).toThrow(/not supported/u);
  });

  it('returns nothing for a non-element root', () => {
    expect(queryAll({ type: 'text', value: 'x' }, 'div')).toEqual([]);
  });
});

describe('T-197 / EDR-016 — reply detachment', () => {
  const node = /** @type {any} */ (
    parseHtml(
      `<article><p data-body>Review words</p>
       <div data-owner-reply><p data-reply>Thank you for the five star review</p></div></article>`,
    ).children[0]
  );

  it('removes the reply subtree from the review', () => {
    const { review, reply, detached } = detachReply(node, [{ selector: '[data-owner-reply]' }]);

    expect(detached).toBe(true);
    expect(textOf(review)).toContain('Review words');
    expect(textOf(review)).not.toContain('Thank you');
    expect(textOf(/** @type {any} */ (reply))).toContain('Thank you');
  });

  it('does not mutate the input', () => {
    // Extraction is pure (DR-1). A fixture that mutated under test would make
    // the golden corpus order-dependent.
    detachReply(node, [{ selector: '[data-owner-reply]' }]);

    expect(textOf(node)).toContain('Thank you');
  });

  it('falls through a strategy that throws', () => {
    const { detached } = detachReply(node, [
      { selector: 'div:first-child' },
      { selector: '[data-owner-reply]' },
    ]);

    expect(detached).toBe(true);
  });

  it('is a no-op when the source has no replies', () => {
    const { review, reply, detached } = detachReply(node, [{ selector: '[data-nothing]' }]);

    expect(detached).toBe(false);
    expect(reply).toBeNull();
    expect(review).toBe(node);
  });

  it('is a no-op when the pack declares no reply strategy', () => {
    expect(detachReply(node).detached).toBe(false);
  });

  it('reads the reply text and date from the detached subtree', () => {
    const { reply } = detachReply(node, [{ selector: '[data-owner-reply]' }]);
    const read = (/** @type {string} */ name) => (name === 'reply_text' ? 'text' : 'date');

    expect(readReply(reply, {}, (name) => read(name))).toEqual({
      text: 'text',
      relative_date_raw: 'date',
    });
    expect(readReply(null, {}, () => 'x')).toBeNull();
  });
});

describe('T-198 / EDR-017 — the rating cascade', () => {
  /** @param {any} over */
  const run = (over) =>
    parseRating({
      accessibleLabel: () => null,
      starCount: () => null,
      numericText: () => null,
      ...over,
    });

  it('takes P1 when it succeeds and records which parser won', () => {
    expect(run({ accessibleLabel: () => '4 out of 5' })).toMatchObject({
      value: 4,
      parser: 'accessible-label',
      error: null,
    });
  });

  it('falls to P2 then P3 in order', () => {
    expect(run({ starCount: () => 3 }).parser).toBe('star-count');
    expect(run({ numericText: () => '2' }).parser).toBe('numeric-text');
  });

  it('treats a throwing parser as one that did not work', () => {
    const outcome = run({
      accessibleLabel: () => {
        throw new Error('bad selector');
      },
      starCount: () => 5,
    });

    expect(outcome.value).toBe(5);
  });

  it('quarantines when nothing resolves', () => {
    expect(run({})).toMatchObject({ value: null, error: 'ERR-PARSE-FIELD-REQUIRED' });
  });

  describe('TR-EXT-040 — the integer post-check is the point', () => {
    it('REJECTS a fractional rating as ERR-PARSE-RATING-INVALID', () => {
      // 4.3 nearly always means the parser matched one level too high and
      // captured the AGGREGATE BUSINESS RATING. Without this check the
      // business's own average is ingested as a review on every harvest,
      // inflating the published mean, and every value looks plausible.
      expect(run({ accessibleLabel: () => 'Rated 4.3 out of 5' })).toMatchObject({
        value: null,
        error: 'ERR-PARSE-RATING-INVALID',
        raw: 'Rated 4.3 out of 5',
      });
    });

    it('rejects a fractional value written with a comma separator', () => {
      // "4,3 von 5" must be read as 4.3 and rejected — not read as 43, and not
      // read as 4. A locale with comma decimals is exactly where a naive parser
      // slips past the check designed to catch this.
      expect(run({ accessibleLabel: () => '4,3 von 5 Sternen' }).error).toBe(
        'ERR-PARSE-RATING-INVALID',
      );
    });

    it('rejects out-of-range integers', () => {
      expect(run({ numericText: () => '0' }).error).toBe('ERR-PARSE-RATING-INVALID');
      expect(run({ numericText: () => '6' }).error).toBe('ERR-PARSE-RATING-INVALID');
      expect(run({ numericText: () => '-2' }).error).toBe('ERR-PARSE-RATING-INVALID');
    });

    it('accepts every legitimate rating', () => {
      for (const value of [1, 2, 3, 4, 5]) {
        expect(run({ starCount: () => value }).value).toBe(value);
      }
    });
  });

  describe('readNumber', () => {
    it('reads the first number and normalises the decimal separator', () => {
      expect(readNumber('vor 4,5 Sternen')).toBe(4.5);
      expect(readNumber('4.5 stars')).toBe(4.5);
      expect(readNumber('5 stars')).toBe(5);
    });

    it('returns null when there is no number', () => {
      expect(readNumber('no digits here')).toBeNull();
    });
  });

  describe('countStars', () => {
    it('counts filled indicators in a five-indicator widget', () => {
      expect(countStars(3, 5)).toBe(3);
      expect(countStars(5, 5)).toBe(5);
    });

    it('refuses a widget that does not have five indicators', () => {
      // Any other count means the selector matched something that is not the
      // rating widget, and counting inside it produces a number between 1 and 5
      // often enough to look correct.
      expect(countStars(3, 7)).toBeNull();
      expect(countStars(6, 5)).toBeNull();
    });

    it('refuses a zero or non-integer count', () => {
      expect(countStars(0, 5)).toBeNull();
      expect(countStars(2.5, 5)).toBeNull();
    });

    it('accepts a count when the pack cannot supply a total', () => {
      expect(countStars(4, 0)).toBe(4);
    });
  });
});

describe('T-200 — text lifting and truncation', () => {
  it('removes the marker AND sets the flag (TR-EXT-061)', () => {
    // Removing without flagging loses the fact that the review is incomplete;
    // flagging without removing publishes the word "More".
    expect(extractText('Great service More', ['More'])).toEqual({
      value: 'Great service',
      truncated: true,
    });
  });

  it('matches a marker split across whitespace (TR-EXT-062)', () => {
    expect(extractText('Great service\n\n   More', ['More']).truncated).toBe(true);
  });

  it('uses locale markers from the pack, not hard-coded English', () => {
    // A hard-coded English marker fails on every other locale by KEEPING the
    // marker, so the published review ends with a foreign word.
    expect(extractText('काम अच्छा था और देखें', ['और देखें'])).toEqual({
      value: 'काम अच्छा था',
      truncated: true,
    });
    expect(extractText('Gute Arbeit Mehr', ['More', 'Mehr']).truncated).toBe(true);
  });

  it('only matches a marker at the end', () => {
    expect(extractText('More work than expected', ['More']).truncated).toBe(false);
  });

  it('treats an absent or empty body as null, not an empty string', () => {
    expect(extractText(null)).toEqual({ value: null, truncated: false });
    expect(extractText('   ')).toEqual({ value: null, truncated: false });
    expect(extractText('More', ['More'])).toEqual({ value: null, truncated: true });
  });

  it('ignores blank markers in the pack', () => {
    expect(extractText('Great service', ['', '   ']).truncated).toBe(false);
  });

  it('does NOT remove markup — that is the normaliser', () => {
    // §23.3 step 2 is the security boundary for every client website at once.
    // Cleaning here would mean text reaching the payload had been cleaned by an
    // implementation never reviewed as a security control.
    expect(extractText('<b>bold</b> text').value).toBe('<b>bold</b> text');
  });
});

describe('T-201 — meta counts', () => {
  it('reads locale-grouped thousands correctly', () => {
    // 1.234 is 1234 in German and 1.234 in English. A parser that strips
    // separators unconditionally is wrong by three orders of magnitude in one
    // of the two, and the payload looks entirely plausible either way.
    expect(readCount('1.234', 'de')).toBe(1234);
    expect(readCount('1,234', 'en')).toBe(1234);
  });

  it('refuses a value that is a decimal in the given locale', () => {
    expect(readCount('1.234', 'en')).toBeNull();
    expect(readCount('1,234', 'de')).toBeNull();
  });

  it('returns null rather than zero when the field is absent', () => {
    // 0 says "this review has no likes"; null says "we could not read it".
    // Publishing the first when the second is true hides a broken strategy
    // behind a plausible number on every review at once.
    expect(readCount(null)).toBeNull();
    expect(readCount('no digits')).toBeNull();
  });

  it('reads plain and space-grouped integers', () => {
    expect(readCount('42')).toBe(42);
    expect(readCount('12 345', 'fr')).toBe(12345);
    expect(readCount('0')).toBe(0);
  });

  it('refuses a negative count', () => {
    expect(readCount('-5')).toBeNull();
  });

  it('extracts all three meta fields through the reader', () => {
    const node = /** @type {any} */ (parseHtml('<div></div>').children[0]);
    const read = (/** @type {string} */ name) =>
      ({ likes: '7', photo_count: '2', visited: 'Visited in June' })[name] ?? null;

    expect(
      extractMeta(node, { likes: {}, photo_count: {}, visited: {} }, (name) => read(name)),
    ).toEqual({ likes: 7, photo_count: 2, visited: 'Visited in June' });
  });
});

describe('T-199 / EXT-03 — author fields are never fabricated', () => {
  it('returns null for every field the source does not supply', () => {
    const node = /** @type {any} */ (parseHtml('<div></div>').children[0]);

    expect(
      extractAuthor(
        node,
        {},
        () => null,
        () => [],
      ),
    ).toEqual({
      name: null,
      profile_url: null,
      avatar_url: null,
      badges: [],
    });
  });
});

describe('§21.8 — signal detection', () => {
  const pack = {
    signals: {
      challenge: { patterns: ['unusual traffic'], confidence: 'high' },
      empty_state: { patterns: ['No reviews yet'], confidence: 'high' },
      consent: { patterns: ['Before you continue'], confidence: 'medium' },
    },
  };

  it('matches declared patterns case-insensitively', () => {
    expect(detectSignals('<p>UNUSUAL TRAFFIC detected</p>', pack)).toEqual([
      { name: 'challenge', confidence: 'high', pattern: 'unusual traffic' },
    ]);
  });

  it('reads the deprecated `detectors` key so v1 packs still classify', () => {
    const legacy = { detectors: pack.signals };

    expect(detectSignals('unusual traffic', legacy)).toHaveLength(1);
  });

  it('reports the empty state separately from a block', () => {
    const hits = detectSignals('<p>No reviews yet</p>', pack);

    expect(hasEmptyState(hits)).toBe(true);
    // The empty state is a HIGH-confidence signal, and treating it as challenge
    // evidence would turn every genuinely empty listing into a terminal block.
    expect(classifySignals(hits)).toBeNull();
  });

  it('defaults an undeclared confidence to low', () => {
    const hits = detectSignals('x', { signals: { odd: { patterns: ['x'] } } });

    expect(/** @type {any} */ (hits[0]).confidence).toBe('low');
    expect(classifySignals(hits)).toBeNull();
  });

  it('finds nothing in a pack with no signals', () => {
    expect(detectSignals('anything', {})).toEqual([]);
    expect(detectSignals('anything', null)).toEqual([]);
  });
});
