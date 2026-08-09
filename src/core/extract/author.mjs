/**
 * Author fields: name, profile URL, avatar URL, badges (§21.3 steps 2–5, T-199).
 *
 * ## An anonymous author is data, not a gap to fill
 *
 * Sources render reviews with no display name. The temptation is to substitute
 * something — "Anonymous", "Google User", the first words of the review — so
 * that the field is never empty and the payload always looks complete.
 *
 * EXT-03 forbids it: a field the adapter cannot supply MUST be `null`, never
 * fabricated. A synthesised name is indistinguishable downstream from a real
 * one, it enters `identity_hash` (§53), and it makes two genuinely anonymous
 * reviews look like two reviews by the same person — which is exactly the
 * collision fixture 011 exists to catch.
 *
 * `author.name` is *required* by §21.3, so a record with no resolvable name is
 * quarantined rather than published nameless. That is a loud, countable failure
 * that G-06 watches. "Anonymous" is a silent one.
 *
 * ## URLs are captured, never fetched
 *
 * `avatar_url` is a URL and nothing more (§21.3 step 4). Fetching it would put
 * the engine on the source's asset infrastructure for every review on every
 * harvest, and would mean the published payload depends on a request that can
 * fail. Host-allowlist validation happens later, in normalisation.
 *
 * @module core/extract/author
 */

/**
 * @typedef {object} Author
 * @property {string | null} name
 * @property {string | null} profile_url
 * @property {string | null} avatar_url
 * @property {string[]} badges
 */

/**
 * @param {import('./html.mjs').HtmlElement} node
 * @param {Record<string, any>} fields
 * @param {(name: string, node: import('./html.mjs').HtmlElement, spec: any) => string | null} read
 * @param {(node: import('./html.mjs').HtmlElement, spec: any) => string[]} readAll
 * @returns {Author}
 */
export function extractAuthor(node, fields, read, readAll) {
  return {
    name: read('author_name', node, fields['author_name']),
    profile_url: read('author_profile_url', node, fields['author_profile_url']),
    avatar_url: read('author_avatar_url', node, fields['author_avatar_url']),
    badges: readAll(node, fields['author_badges']),
  };
}
