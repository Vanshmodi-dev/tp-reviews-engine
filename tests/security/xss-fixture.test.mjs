import { describe, expect, it } from 'vitest';

import { parseHtml } from '../../src/core/extract/html.mjs';
import { extractReviews } from '../../src/core/extract/index.mjs';
import { normalize } from '../../src/core/normalize/index.mjs';
import { parseFragment } from 'parse5';
import { sanitizeHtml } from '../../scripts/sanitize-html.mjs';

/**
 * Every element name in a parse5 fragment.
 *
 * @param {any} node
 * @returns {string[]}
 */
function descendants(node) {
  const children = node.childNodes ?? [];

  return children.flatMap((/** @type {any} */ child) => [child.nodeName, ...descendants(child)]);
}
import { loadFixture } from '../helpers/fixtures.mjs';

const fixture = loadFixture('019-markup-in-review-text');

const result = extractReviews(fixture.html, fixture.pack, {
  locale: fixture.meta.locale,
  parse: parseHtml,
});

if (!result.ok) throw new Error(`fixture 019 must extract: ${JSON.stringify(result.error)}`);

const outcome = { value: { reviews: /** @type {any[]} */ (result.value.reviews) } };

/**
 * @param {string | null} value
 * @returns {string}
 */
function cleaned(value) {
  const result = normalize(value ?? '');

  // `markup_survived` is the self-check: if it is ever true the boundary itself
  // failed, which is `ERR-CLEAN-MARKUP-SURVIVED` and `critical`. Surfacing it as
  // a visible sentinel means a test can never pass by accident on a value the
  // engine already knows is unsafe.
  expect(result.markup_survived).toBe(false);

  return String(result.text);
}

describe('fixture 019 — the path that reaches every client website', () => {
  it('extraction lifts the payload verbatim and does NOT clean it', () => {
    // This is deliberate. Cleaning here would mean text reaching the payload
    // had been cleaned by two implementations, one of which was never reviewed
    // as a security control and is covered by neither PT-10, PT-11, nor this
    // file. §23.3 is the single boundary; extraction must not blur it.
    const [first] = outcome.value.reviews;

    expect(first.text).toContain('<scr<script>ipt>');
    expect(first.author.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('the normaliser REMOVES the markup rather than escaping it', () => {
    // Escaping produces text that is safe in one context and dangerous in
    // another. TRD §23.3: markup is REMOVED, because this text is inserted into
    // client sites TradyPerch does not control and cannot audit.
    for (const review of outcome.value.reviews) {
      const text = cleaned(review.text);

      expect(text).not.toMatch(/<[a-z/!]/iu);
      expect(text).not.toContain('&lt;');
      expect(text).not.toContain('&gt;');
      expect(text).not.toContain('&amp;');
    }
  });

  it('defeats the nested-tag trick that beats a naive stripper', () => {
    // `<scr<script>ipt>` survives a single-pass tag-stripping regex: removing
    // the inner `<script>` splices the outer halves back into a live tag. This
    // is the payload the fixture exists to carry.
    const text = cleaned(outcome.value.reviews[0].text);

    expect(text).not.toContain('script');
    expect(text).toContain('Great service');
    expect(text).toContain('fair pricing');
  });

  it('removes the svg element and the anchor carrying a javascript: URL', () => {
    const text = cleaned(outcome.value.reviews[1].text);

    expect(text.toLowerCase()).not.toContain('onload');
    expect(text).not.toContain('<svg');
    expect(text).not.toContain('href');
  });

  it('does NOT censor the literal words, and that is correct', () => {
    // The residual text `javascript:alert(1)` is inert: the anchor that would
    // have made it a URL is gone, and text content cannot execute. Stripping
    // the words instead would corrupt legitimate reviews — a developer
    // reviewing a coding bootcamp writes exactly this — while adding no safety.
    //
    // The host allowlist applies to URL FIELDS (avatar_url, profile_url), which
    // is where a URL can still be a URL. Review text is text.
    expect(cleaned(outcome.value.reviews[1].text)).toContain('javascript:alert(1)');
  });

  it('cleans the author name on the same path as the text', () => {
    // An author name is displayed exactly like review text. A boundary applied
    // to one field and not the other is not a boundary.
    const name = cleaned(outcome.value.reviews[0].author.name);

    expect(name).not.toMatch(/<[a-z/!]/iu);
    expect(name).not.toContain('onerror');
  });

  it('leaves no "<" anywhere in the published projection', () => {
    // Every string that could reach a client site, asserted in one place. A
    // field added later that skips normalisation fails here rather than in
    // production.
    //
    // `<` and not `[<>]`: only `<` can open a tag. A residual `>` is inert —
    // and asserting on it would fail every review that says "5 > 3", which is
    // a correctness bug traded for no safety at all.
    for (const review of outcome.value.reviews) {
      for (const value of [review.text, review.author.name, review.owner_reply?.text]) {
        if (value === null || value === undefined) continue;

        expect(cleaned(value)).not.toContain('<');
      }
    }
  });
});

describe('scripts/sanitize-html — the capture-time boundary', () => {
  it('removes script and style subtrees entirely', () => {
    const output = sanitizeHtml(
      '<div><script>alert(1)</script><style>a{}</style><p>keep</p></div>',
    );

    expect(output).not.toContain('alert');
    expect(output).not.toContain('a{}');
    expect(output).toContain('keep');
  });

  it('removes inline event handlers while keeping the element', () => {
    const output = sanitizeHtml('<div onclick="steal()" data-review-id="1">text</div>');

    expect(output).not.toContain('onclick');
    expect(output).toContain('data-review-id');
    expect(output).toContain('text');
  });

  it('removes tracking and token-shaped attributes', () => {
    const output = sanitizeHtml(
      '<a data-ved="abc" data-session-token="s3cret" data-review-id="1" href="/x">y</a>',
    );

    expect(output).not.toContain('data-ved');
    expect(output).not.toContain('s3cret');
    expect(output).toContain('data-review-id');
  });

  it('strips query strings, which is where signed tokens hide', () => {
    // Keeping the query string would put a credential in the repository under
    // the name `page.html`.
    const output = sanitizeHtml('<img src="https://host/a/avatar?sig=deadbeef&s=64">');

    expect(output).toContain('https://host/a/avatar');
    expect(output).not.toContain('deadbeef');
  });

  it('KEEPS review text and author names', () => {
    // Stripping them would produce a corpus that tests the shape of the markup
    // and nothing about the extraction it exists to verify — a corpus that
    // passes while the parser is broken.
    const output = sanitizeHtml(
      '<div role="article"><span aria-label="Review by Ann"></span><p>Great service</p></div>',
    );

    expect(output).toContain('Review by Ann');
    expect(output).toContain('Great service');
  });

  it('defeats the nested-tag trick, asserted on the TREE not the string', () => {
    // `<scr<script>` serialises back out containing the literal characters
    // `<script`, and a string assertion fails on it — but the guarantee is
    // about the tree, not the bytes. A browser parsing this output builds the
    // same tree parse5 did, in which there is no script element. Asserting on
    // the string would have forced a "fix" that made the output prettier and
    // no safer.
    const output = sanitizeHtml('<p>a<scr<script>ipt>alert(1)</scr</script>ipt>b</p>');
    const tags = descendants(parseFragment(output));

    expect(tags).not.toContain('script');
  });

  it('is idempotent — sanitising twice changes nothing', () => {
    // A sanitiser that keeps finding something to remove is a sanitiser that
    // did not finish the first time.
    const once = sanitizeHtml(fixture.html);

    expect(sanitizeHtml(once)).toBe(once);
  });

  it('leaves the corpus unchanged, which is what proves it already ran', () => {
    for (const slug of [
      '001-standard-120-reviews',
      '004-owner-replies',
      '019-markup-in-review-text',
    ]) {
      const html = loadFixture(slug).html.trim();

      expect(sanitizeHtml(html).trim()).toBe(html);
    }
  });
});
