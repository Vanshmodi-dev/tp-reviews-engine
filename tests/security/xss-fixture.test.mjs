import { describe, expect, it } from 'vitest';

import { normalize } from '../../src/core/normalize/index.mjs';
import { hasSurvivingMarkup } from '../../src/core/normalize/markup.mjs';
import { ALLOWED_HOSTS, normaliseAvatarUrl, validateUrl } from '../../src/core/normalize/url.mjs';

/**
 * T-071 — adversarial markup never survives to a payload-shaped value.
 *
 * This is the security suite's entry for INV-05. The corpus in
 * `tests/unit/normalize/` proves each step behaves; this proves the *outcome*
 * that matters, stated the way an attacker would state it: given this input,
 * does anything executable reach a client website?
 *
 * Re-verified against fixture 019 (`markup-in-review-text`) at PH-13, when real
 * captured markup exists to run it against.
 */

/** @param {string} s */
const clean = (s) => normalize(s).text;

/**
 * Payloads drawn from the shapes that actually get used, not invented ones.
 * Each is a real evasion technique against naive sanitisers.
 */
const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<ScRiPt>alert(1)</ScRiPt>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<svg/onload=alert(1)>',
  '<body onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<object data="data:text/html;base64,PHNjcmlwdD4="></object>',
  '<embed src="x.swf">',
  '<form><button formaction="javascript:alert(1)">go</button></form>',
  '<input onfocus=alert(1) autofocus>',
  '<select onfocus=alert(1) autofocus>',
  '<textarea onfocus=alert(1) autofocus>',
  '<marquee onstart=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<video><source onerror=alert(1)>',
  '<audio src=x onerror=alert(1)>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<link rel=import href="data:text/html,<script>alert(1)</script>">',
  '<style>@import"javascript:alert(1)";</style>',
  '<template><script>alert(1)</script></template>',
  '<noscript><p title="</noscript><script>alert(1)</script>">',
  '<math><mtext><script>alert(1)</script>',
  '<xmp><script>alert(1)</script></xmp>',
  // Encoded forms
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
  '&amp;amp;lt;script&amp;amp;gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',
  '&#0060;script&#0062;',
  // Malformed and split forms
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<<SCRIPT>alert(1);//<</SCRIPT>',
  '<script',
  '<script src=//evil.example/x.js',
  '"><script>alert(1)</script>',
  "'><script>alert(1)</script>",
  '</textarea><script>alert(1)</script>',
  '<!--<script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
];

describe('no XSS payload survives normalisation (INV-05)', () => {
  it.each(XSS_PAYLOADS)('neutralises %j', (payload) => {
    const output = clean(payload);

    expect(hasSurvivingMarkup(output), `survived: ${JSON.stringify(output)}`).toBe(false);
  });

  it('leaves no angle-bracket tag opener in any output', () => {
    for (const payload of XSS_PAYLOADS) {
      expect(/<[!?/a-zA-Z]/u.test(clean(payload)), payload).toBe(false);
    }
  });

  it('never reports markup_survived for any payload', () => {
    // markup_survived is the self-check. If it ever fires, the boundary failed
    // and the class is ERR-CLEAN-MARKUP-SURVIVED - critical, because it means
    // the thing protecting every client site did not work.
    for (const payload of XSS_PAYLOADS) {
      expect(normalize(payload).markup_survived, payload).toBe(false);
    }
  });

  it('survives payloads nested inside each other', () => {
    for (const outer of XSS_PAYLOADS.slice(0, 10)) {
      for (const inner of XSS_PAYLOADS.slice(0, 10)) {
        expect(hasSurvivingMarkup(clean(`${outer}${inner}`))).toBe(false);
      }
    }
  });

  it('survives a payload wrapped in ordinary review text', () => {
    for (const payload of XSS_PAYLOADS) {
      const wrapped = `The staff were lovely. ${payload} Would come again.`;

      expect(hasSurvivingMarkup(clean(wrapped)), payload).toBe(false);
    }
  });

  it('keeps the surrounding review text readable', () => {
    // Removing markup must not destroy the review. A sanitiser that returns an
    // empty string for everything is safe and useless.
    const output = clean('The staff were lovely. <script>alert(1)</script> Would come again.');

    expect(output).toContain('The staff were lovely.');
    expect(output).toContain('Would come again.');
  });

  it('is idempotent on every payload', () => {
    // A second pass must not resurrect anything. This is the property that
    // stops a re-run from producing different bytes.
    for (const payload of XSS_PAYLOADS) {
      const once = clean(payload);

      expect(clean(once), payload).toBe(once);
    }
  });
});

describe('URL allowlist (T-070)', () => {
  it('rejects javascript: URIs', () => {
    expect(validateUrl('javascript:alert(1)')).toBeNull();
    expect(validateUrl('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('rejects data: URIs', () => {
    expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects any host not on the allowlist', () => {
    expect(validateUrl('https://evil.example/avatar.png')).toBeNull();
    expect(validateUrl('https://googleusercontent.com.evil.example/x')).toBeNull();
  });

  it('rejects a lookalike subdomain of an allowed host', () => {
    // `lh3.googleusercontent.com.evil.example` contains an allowed host as a
    // substring. Matching on hostname equality rather than `includes` is what
    // stops it.
    expect(validateUrl('https://lh3.googleusercontent.com.evil.example/x.png')).toBeNull();
  });

  it('rejects http, rather than silently upgrading it', () => {
    // Upgrading would change what the source actually served. A mixed-content
    // warning is a better outcome than a quietly rewritten URL.
    expect(validateUrl('http://lh3.googleusercontent.com/x.png')).toBeNull();
  });

  it('rejects a URL carrying credentials', () => {
    expect(validateUrl('https://user:pass@lh3.googleusercontent.com/x.png')).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const junk of ['', '   ', 'not a url', '//x', null, undefined]) {
      expect(validateUrl(junk)).toBeNull();
    }
  });

  it('accepts an allowlisted HTTPS URL', () => {
    expect(validateUrl('https://lh3.googleusercontent.com/a/photo=s96-c')).toContain(
      'lh3.googleusercontent.com',
    );
  });

  it('normalises the size directive so the hash is stable', () => {
    // The source varies =s96 and =s128 between page loads; without this the
    // avatar looks changed on every harvest and churns the content hash.
    const a = normaliseAvatarUrl('https://lh3.googleusercontent.com/a/photo=s96-c');
    const b = normaliseAvatarUrl('https://lh3.googleusercontent.com/a/photo=s128-c');

    expect(a).toBe(b);
  });

  it('exposes a deliberately narrow allowlist', () => {
    expect(ALLOWED_HOSTS.length).toBeLessThan(12);
    expect(Object.isFrozen(ALLOWED_HOSTS)).toBe(true);
  });
});

describe('avatar URLs without a size directive', () => {
  it('passes through an allowlisted URL that has no size parameter', () => {
    const url = 'https://lh3.googleusercontent.com/a/plain-photo.png';

    expect(normaliseAvatarUrl(url)).toBe(url);
  });

  it('returns null for a rejected URL rather than a normalised one', () => {
    expect(normaliseAvatarUrl('https://evil.example/a=s96-c')).toBeNull();
  });
});
