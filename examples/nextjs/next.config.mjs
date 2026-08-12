/**
 * The CSP for the Next.js example (DEL-191, FE-04).
 *
 * No `'unsafe-inline'` for scripts or styles. The renderer evaluates nothing
 * and writes no inline style, so it does not need either — and a policy that
 * grants them to make a reviews widget work has been weakened for the whole
 * site in exchange for a section of one page.
 *
 * `connect-src 'self'` only. The payload is fetched on the SERVER in this
 * recipe, so the browser makes no review request at all; the directive is here
 * so that switching to client-side `mount` fails loudly rather than silently
 * acquiring a new origin.
 *
 * Note: Next.js needs `'unsafe-inline'` for styles in some configurations of
 * styled-jsx. If yours does, that is a decision about your framework setup, not
 * about this renderer — do not attribute it here.
 */

const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CSP }],
      },
    ];
  },
};

export default nextConfig;
