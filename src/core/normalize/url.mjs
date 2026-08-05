/**
 * URL validation — host allowlist and size-parameter normalisation.
 *
 * **This module never fetches anything.** It is pure string work in `core/`,
 * and the URLs it returns are *referenced* by a client website, never
 * re-hosted. That is a deliberate product decision: re-hosting a reviewer's
 * avatar would make TradyPerch the processor of that image.
 *
 * The rule is fail-closed. A URL that is not provably safe becomes `null`, and
 * `null` renders as initials — which is why `author.initials` exists at all.
 * There is no "pass it through and hope" path, because the alternative to a
 * missing avatar is a `javascript:` URI on a client's page.
 *
 * @module core/normalize/url
 */

/**
 * Hosts whose images and profile links may appear in a payload.
 *
 * Deliberately narrow, and deliberately not configurable per client: a
 * per-client allowlist is a per-client way to get this wrong. Adding a host is
 * a reviewed code change.
 */
export const ALLOWED_HOSTS = Object.freeze([
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'maps.google.com',
  'www.google.com',
  'maps.gstatic.com',
]);

/** Google image URLs carry a size directive; this is the one we request. */
const SIZE_PARAM = /=s\d+(-c)?(-[a-z]+)*$/u;
const NORMALISED_SIZE = '=s128-c';

/**
 * @param {string} host
 * @returns {boolean}
 */
function isAllowedHost(host) {
  return ALLOWED_HOSTS.includes(host.toLowerCase());
}

/**
 * Validates a URL against the allowlist, returning `null` when it fails.
 *
 * Rejects, in order: unparseable input, any scheme other than HTTPS, any host
 * not on the allowlist, and any URL carrying credentials.
 *
 * HTTP is rejected rather than upgraded. An upgrade would silently change what
 * the source actually served, and a mixed-content warning on a client's site is
 * a better outcome than a quietly rewritten URL.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    // An unparseable URL is not an error to report - a source emitting junk is
    // ordinary. It is simply not publishable.
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!isAllowedHost(parsed.hostname)) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  return parsed.toString();
}

/**
 * Validates an avatar URL and normalises its size directive.
 *
 * Normalising the size is what stops the same avatar producing a different
 * `content_hash` every harvest because the source varied `=s96` and `=s128`
 * between page loads — churn that looks like the reviewer changed their photo.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normaliseAvatarUrl(raw) {
  const validated = validateUrl(raw);
  if (validated === null) return null;

  return SIZE_PARAM.test(validated) ? validated.replace(SIZE_PARAM, NORMALISED_SIZE) : validated;
}
