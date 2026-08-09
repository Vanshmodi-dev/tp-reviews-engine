import { describe, expect, it } from 'vitest';

import { ALLOWED_HOSTS, normaliseAvatarUrl, validateUrl } from '../../src/core/normalize/url.mjs';
import { projectReview } from '../../src/core/project/payload.mjs';

const GOOD = 'https://lh3.googleusercontent.com/a/avatar';

describe('the host allowlist — fail closed, never pass through', () => {
  it('accepts an HTTPS URL on an allowlisted host', () => {
    expect(validateUrl(GOOD)).toBe(GOOD);

    for (const host of ALLOWED_HOSTS) {
      expect(validateUrl(`https://${host}/x`)).toBe(`https://${host}/x`);
    }
  });

  it('REJECTS a javascript: URI', () => {
    // The specific outcome the module exists to prevent. `avatar_url` becomes
    // an `<img src>` and `profile_url` an `<a href>` on a client's website.
    expect(validateUrl('javascript:alert(1)')).toBeNull();
    expect(validateUrl('JavaScript:alert(1)')).toBeNull();
  });

  it('REJECTS data: and other non-HTTPS schemes', () => {
    expect(validateUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(validateUrl('file:///etc/passwd')).toBeNull();
    expect(validateUrl('ftp://lh3.googleusercontent.com/a')).toBeNull();
  });

  it('REJECTS http rather than upgrading it', () => {
    // An upgrade would silently change what the source actually served. A
    // mixed-content warning on a client's site is a better outcome than a
    // quietly rewritten URL.
    expect(validateUrl('http://lh3.googleusercontent.com/a/avatar')).toBeNull();
  });

  it('REJECTS a host that is not on the list', () => {
    expect(validateUrl('https://evil.example/a/avatar')).toBeNull();
  });

  it('REJECTS a lookalike host that merely contains an allowed one', () => {
    // `lh3.googleusercontent.com.evil.example` passes a `.includes()` check and
    // is an entirely attacker-controlled host. So does a subdomain prefix.
    expect(validateUrl('https://lh3.googleusercontent.com.evil.example/a')).toBeNull();
    expect(validateUrl('https://evil-lh3.googleusercontent.com/a')).toBeNull();
    expect(validateUrl('https://notlh3.googleusercontent.com/a')).toBeNull();
  });

  it('REJECTS a URL carrying credentials', () => {
    expect(validateUrl('https://user:pass@lh3.googleusercontent.com/a')).toBeNull();
    expect(validateUrl('https://user@lh3.googleusercontent.com/a')).toBeNull();
  });

  it('REJECTS an allowed host reached via a userinfo trick', () => {
    // `https://lh3.googleusercontent.com@evil.example/` parses with hostname
    // `evil.example` — the allowed host is the *username*. A substring check on
    // the raw string would accept it.
    expect(validateUrl('https://lh3.googleusercontent.com@evil.example/a')).toBeNull();
  });

  it('REJECTS unparseable, empty, and non-string input', () => {
    expect(validateUrl('not a url')).toBeNull();
    expect(validateUrl('')).toBeNull();
    expect(validateUrl('   ')).toBeNull();
    expect(validateUrl(null)).toBeNull();
    expect(validateUrl(undefined)).toBeNull();
    expect(validateUrl(/** @type {any} */ (42))).toBeNull();
  });

  it('matches the host case-insensitively, as DNS does', () => {
    expect(validateUrl('https://LH3.GoogleUserContent.com/a')).not.toBeNull();
  });
});

describe('avatar size normalisation', () => {
  it('pins the size directive so the content hash stops churning', () => {
    // The same avatar served as =s96 on one harvest and =s128 on the next would
    // change `content_hash` every run, which looks exactly like the reviewer
    // changing their photo — and republishes the payload for no reason.
    expect(normaliseAvatarUrl(`${GOOD}=s96-c`)).toBe(`${GOOD}=s128-c`);
    expect(normaliseAvatarUrl(`${GOOD}=s400`)).toBe(`${GOOD}=s128-c`);
  });

  it('leaves a URL with no size directive alone', () => {
    expect(normaliseAvatarUrl(GOOD)).toBe(GOOD);
  });

  it('rejects before it normalises', () => {
    expect(normaliseAvatarUrl('https://evil.example/a=s96-c')).toBeNull();
    expect(normaliseAvatarUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('the payload boundary applies the allowlist', () => {
  /**
   * @param {Record<string, any>} author
   * @returns {Record<string, any>}
   */
  const publish = (author) => projectReview({ review: { rating: 5, author } });

  it('nulls a hostile avatar and profile URL on the way out', () => {
    // The end-to-end assertion that matters: whatever an adapter supplies, the
    // published payload carries only allowlisted URLs. Asserted on the
    // projection because that is the last point before the payload is written,
    // and everything a client website renders comes from here.
    const review = publish({
      name: 'Mallory',
      avatar_url: 'javascript:alert(1)',
      profile_url: 'https://evil.example/steal',
    });

    expect(review['author_avatar_url']).toBeNull();
    expect(review['author_profile_url']).toBeNull();
    expect(review['author_name']).toBe('Mallory');
  });

  it('keeps a legitimate URL, so the control is not simply deleting data', () => {
    const review = publish({
      name: 'Priya Sharma',
      avatar_url: `${GOOD}=s96-c`,
      profile_url: 'https://www.google.com/maps/contrib/100200300',
    });

    expect(review['author_avatar_url']).toBe(`${GOOD}=s128-c`);
    expect(review['author_profile_url']).toBe('https://www.google.com/maps/contrib/100200300');
  });

  it('survives an author object that is absent entirely', () => {
    expect(projectReview({ review: { rating: 5 } })['author_avatar_url']).toBeNull();
  });
});
