/**
 * Owner-reply detachment (EDR-016, FR-033, T-197).
 *
 * ## This runs first, and the ordering is the mitigation
 *
 * An owner reply is nested inside — or immediately adjacent to — the review it
 * answers. Its text sits inside the review node's subtree, and so, sometimes,
 * do elements that look like a rating.
 *
 * Step 1 of §21.3 detaches that subtree. Everything after operates on the
 * review-only remainder. This is not stylistic ordering:
 *
 * **FR-033 exists because ingesting an owner reply as a five-star review is a
 * real, observed failure** that silently inflates a business's displayed
 * rating. A reply that is still attached becomes text, rating, and author data
 * for a review that does not exist.
 *
 * ## Why not filter the reply out afterwards
 *
 * The obvious alternative is to extract everything and subtract the reply's
 * words from the text at the end. By then `text` already contains the reply's
 * words concatenated with the review's, and separating them post hoc needs
 * string heuristics that fail on exactly the short replies ("Thank you!") that
 * are most common. Matching the reply by a text prefix is worse still —
 * locale-dependent and fragile.
 *
 * ## Detachment is structural, and it is a copy
 *
 * The reply subtree is removed by rebuilding the node without it, not by
 * mutating the input. Extraction is pure (DR-1), and a fixture that mutated
 * under test would make the golden corpus order-dependent.
 *
 * @module core/extract/reply
 */

import { queryAll } from './query.mjs';

/**
 * @typedef {object} Detachment
 * @property {import('./html.mjs').HtmlElement} review   The review-only subtree.
 * @property {import('./html.mjs').HtmlElement | null} reply  The detached subtree.
 * @property {boolean} detached
 */

/**
 * Splits a review node into the review and its owner reply.
 *
 * Returns the node unchanged with `reply: null` when the pack declares no
 * reply strategy or none matches. A source without owner replies is the
 * ordinary case, not a failure.
 *
 * @param {import('./html.mjs').HtmlElement} node
 * @param {ReadonlyArray<{ selector: string }>} strategies  `containers.reply_node`.
 * @returns {Detachment}
 */
export function detachReply(node, strategies = []) {
  for (const strategy of strategies) {
    /** @type {import('./html.mjs').HtmlElement[]} */
    let matches;

    try {
      matches = queryAll(node, strategy.selector);
    } catch {
      // An unsupported or malformed selector is a strategy that did not work.
      // The next one still gets its turn, exactly as in `resolveField`.
      continue;
    }

    const reply = matches[0];

    if (reply === undefined) continue;

    return { review: withoutSubtree(node, reply), reply, detached: true };
  }

  return { review: node, reply: null, detached: false };
}

/**
 * Rebuilds `node` with `target`'s subtree removed.
 *
 * Identity comparison, not structural: two replies with identical markup are
 * two replies, and removing both because they compare equal would delete a
 * second reply that a source is entitled to render.
 *
 * @param {import('./html.mjs').HtmlElement} node
 * @param {import('./html.mjs').HtmlElement} target
 * @returns {import('./html.mjs').HtmlElement}
 */
function withoutSubtree(node, target) {
  /** @type {import('./html.mjs').HtmlNode[]} */
  const children = [];

  for (const child of node.children) {
    if (child === target) continue;

    children.push(child.type === 'element' ? withoutSubtree(child, target) : child);
  }

  return { type: 'element', tag: node.tag, attrs: node.attrs, children };
}

/**
 * Reads the reply's text and relative date (§21.3 step 12).
 *
 * The reply carries its own relative date, and it is captured verbatim for the
 * same reason the review's is (TR-EXT-050): the resolved date is pinned once
 * and the raw phrase remains the audit trail.
 *
 * @param {import('./html.mjs').HtmlElement | null} reply
 * @param {Record<string, any>} fields  Pack `fields`, for `reply_text`/`reply_date`.
 * @param {(name: string, node: import('./html.mjs').HtmlElement, spec: any) => string | null} read
 * @returns {{ text: string | null, relative_date_raw: string | null } | null}
 */
export function readReply(reply, fields, read) {
  if (reply === null) return null;

  return {
    text: read('reply_text', reply, fields['reply_text']),
    relative_date_raw: read('reply_date', reply, fields['reply_date']),
  };
}
