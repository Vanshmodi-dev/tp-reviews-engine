/**
 * Per-node extraction orchestration in the §21.3 order (T-202).
 *
 * ## The order is normative, and step 1 is why
 *
 * §21.3 numbers thirteen steps. Twelve of them could be reordered without
 * changing any output. Step 1 — reply detachment — cannot, and EDR-016 exists
 * because getting it wrong ingests owner replies as five-star reviews.
 *
 * So detachment happens here, once, before any field extractor is called, and
 * every subsequent extractor receives the review-only subtree. No extractor is
 * given the original node, which is what makes the ordering a structural
 * property rather than a convention.
 *
 * ## Failing softly per field, loudly per structure (§21.9)
 *
 * | Situation | Result |
 * | --- | --- |
 * | Review container not found | `ERR-PARSE-STRUCTURE`, abort the target |
 * | Zero nodes, empty-state signal present | not an error — `total_count: 0` is real |
 * | Zero nodes, no empty-state signal | `ERR-PARSE-EMPTY-UNEXPECTED`, abort |
 * | Required field missing on one record | quarantine **that record only** |
 * | Optional field missing | `null` |
 *
 * The middle two rows are the interesting ones. A listing with genuinely zero
 * reviews and a listing whose markup changed both produce an empty node list,
 * and the difference between them is the difference between a correct publish
 * of nothing and a silent wipe of a client's reviews. Only the empty-state
 * signal separates them, which is why it is a declared pack signal rather than
 * an inference.
 *
 * ## Ordinals are diagnostics (TR-EXT-031)
 *
 * The node's position is recorded and MUST NOT contribute to identity. Rendered
 * ordering is personalised and unstable; a review that moves from position 3 to
 * position 7 between harvests is the same review, and an identity that included
 * the ordinal would report it as a deletion and an insertion.
 *
 * @module core/extract
 */

import { err, ok } from '../util/result.mjs';

import { textOf } from './html.mjs';
import { extractAuthor } from './author.mjs';
import { extractMeta } from './meta.mjs';
import { extractText } from './text.mjs';
import { countStars, parseRating, readNumber } from './rating.mjs';
import { detachReply, readReply } from './reply.mjs';
import { queryAll } from './query.mjs';
import { classifySignals, detectSignals, hasEmptyState } from './signals.mjs';
import { resolveField } from '../selectors/resolver.mjs';

/**
 * @typedef {object} ExtractedReview
 * @property {number} ordinal
 * @property {number | null} rating
 * @property {string | null} relative_date_raw
 * @property {string | null} text
 * @property {boolean} text_truncated
 * @property {import('./author.mjs').Author} author
 * @property {import('./meta.mjs').ReviewMeta} meta
 * @property {{ text: string | null, relative_date_raw: string | null } | null} owner_reply
 * @property {Record<string, number>} strategy_indices
 */

/**
 * @typedef {object} QuarantinedRecord
 * @property {number} ordinal
 * @property {string} code
 * @property {string} field
 * @property {string | null} raw
 */

/**
 * Builds the probe `resolveField` needs, bound to one node.
 *
 * A strategy is a selector plus two optional modifiers: `attribute` reads an
 * attribute rather than the text, and `pattern` takes the first capture group.
 * That uniformity is what lets every strategy kind share one probe — the kind
 * records *stability*, not a different query language.
 *
 * @param {import('./html.mjs').HtmlElement} node
 * @returns {(strategy: any) => string | null}
 */
function probeFor(node) {
  return (strategy) => {
    const element = queryAll(node, strategy.selector)[0];

    if (element === undefined) return null;

    const raw =
      typeof strategy.attribute === 'string'
        ? (element.attrs[strategy.attribute] ?? null)
        : textOf(element);

    if (raw === null) return null;
    if (typeof strategy.pattern !== 'string') return raw.replace(/\s+/gu, ' ').trim();

    const match = new RegExp(strategy.pattern, 'u').exec(raw);

    return match === null ? null : (match[1] ?? match[0]);
  };
}

/**
 * Extracts every review node from a serialised subtree.
 *
 * @param {string} html  The serialised container subtree (TR-EXT-010).
 * @param {any} pack
 * @param {object} [options]
 * @param {string} [options.locale]
 * @param {boolean} [options.emptyStateSignal]  True when the pack's empty-state signal matched.
 * @param {(source: string) => import('./html.mjs').HtmlElement} [options.parse]
 * @returns {import('../util/result.mjs').Result<{ reviews: ExtractedReview[], quarantined: QuarantinedRecord[] }, any>}
 */
export function extractReviews(html, pack, options = {}) {
  const { locale = 'en' } = options;
  const parse = options.parse;

  if (typeof parse !== 'function') {
    return err({ code: 'ERR-PARSE-STRUCTURE', message: 'no parser was supplied to extraction' });
  }

  // Before anything is parsed (TR-NAV-040). A challenge page reported as a
  // parse failure sends an engineer to the selector-repair runbook for markup
  // that is not broken, and triggers the retry that turns a soft block hard.
  const hits = detectSignals(html, pack);
  const blocked = classifySignals(hits);

  if (blocked !== null) return err({ code: blocked.code, message: blocked.reason });

  const nodes = locateNodes(parse(html), pack);
  const structural = checkStructure(nodes, options.emptyStateSignal ?? hasEmptyState(hits));

  if (structural !== null) return err(structural);

  /** @type {ExtractedReview[]} */
  const reviews = [];
  /** @type {QuarantinedRecord[]} */
  const quarantined = [];

  for (const [ordinal, node] of /** @type {import('./html.mjs').HtmlElement[]} */ (
    nodes
  ).entries()) {
    const outcome = extractOne(node, pack, { locale, ordinal });

    if (outcome.quarantine === null) reviews.push(/** @type {ExtractedReview} */ (outcome.review));
    else quarantined.push(outcome.quarantine);
  }

  return ok({ reviews, quarantined });
}

/**
 * The two structural failures of §21.9, which are opposites.
 *
 * A missing container is a bug report. An empty container with no empty-state
 * signal is a *possible* bug report — and an empty container WITH the signal is
 * a correct publish of nothing. Getting the last two confused is the difference
 * between publishing zero reviews correctly and wiping a client's site.
 *
 * @param {import('./html.mjs').HtmlElement[] | null} nodes
 * @param {boolean} emptyStateSignal
 * @returns {{ code: string, message: string } | null}
 */
function checkStructure(nodes, emptyStateSignal) {
  if (nodes === null) {
    return {
      code: 'ERR-PARSE-STRUCTURE',
      message: 'the review container did not match any strategy in the pack',
    };
  }

  if (nodes.length === 0 && !emptyStateSignal) {
    return {
      code: 'ERR-PARSE-EMPTY-UNEXPECTED',
      message: 'the container matched but held no review nodes, and no empty-state signal was seen',
    };
  }

  return null;
}

/**
 * Locates review nodes inside the container (TR-EXT-030).
 *
 * Returns null — distinct from an empty array — when the container itself did
 * not resolve. "The container is missing" and "the container is empty" are
 * different failures with opposite correct responses.
 *
 * @param {import('./html.mjs').HtmlElement} root
 * @param {any} pack
 * @returns {import('./html.mjs').HtmlElement[] | null}
 */
function locateNodes(root, pack) {
  const containers = pack?.containers ?? {};
  const surface = containers.surface;
  const scope = surface === undefined ? root : firstMatch(root, surface.strategies ?? []);

  if (scope === null) return null;
  if (containers.review_node === undefined) return null;

  const matches = firstNonEmptyMatch(scope, containers.review_node.strategies ?? []);

  // A pack with no surface declared cannot distinguish "the container is
  // missing" from "the container is empty", so it reports the former. A pack
  // that resolved its surface has already answered that question, and an empty
  // result there is genuinely an empty container.
  if (matches !== null) return matches;

  return surface === undefined ? null : [];
}

/**
 * @param {import('./html.mjs').HtmlElement} scope
 * @param {ReadonlyArray<any>} strategies
 * @returns {import('./html.mjs').HtmlElement[] | null}
 */
function firstNonEmptyMatch(scope, strategies) {
  for (const strategy of strategies) {
    try {
      const matches = queryAll(scope, strategy.selector);

      if (matches.length > 0) return matches;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * @param {import('./html.mjs').HtmlElement} root
 * @param {ReadonlyArray<any>} strategies
 * @returns {import('./html.mjs').HtmlElement | null}
 */
function firstMatch(root, strategies) {
  for (const strategy of strategies) {
    try {
      const found = queryAll(root, strategy.selector)[0];

      if (found !== undefined) return found;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Extracts one review node, in the §21.3 order.
 *
 * @param {import('./html.mjs').HtmlElement} node
 * @param {any} pack
 * @param {{ locale: string, ordinal: number }} context
 * @returns {{ review: ExtractedReview | null, quarantine: QuarantinedRecord | null }}
 */
function extractOne(node, pack, context) {
  const { fields, replyStrategies, ratingStars, markers } = packView(pack);

  // Step 1. Before anything else reads a field (EDR-016).
  const { review: subtree, reply } = detachReply(node, replyStrategies);

  const { read, readField, indices } = makeReaders(subtree);
  const rating = extractRating(subtree, fields, readField, ratingStars);

  if (rating.error !== null) {
    return quarantine(context.ordinal, rating.error, 'rating', rating.raw);
  }

  const author = extractAuthor(subtree, fields, read, (target, spec) => readAll(target, spec));

  if (author.name === null) {
    // §21.3 makes the author name required, so a record without one is
    // quarantined rather than published nameless. Substituting "Anonymous"
    // would be indistinguishable downstream from a real name and would enter
    // `identity_hash`, collapsing every anonymous review into one.
    return quarantine(context.ordinal, 'ERR-PARSE-FIELD-REQUIRED', 'author.name', null);
  }

  const body = extractText(readField('text', fields['text']), markers);

  return {
    review: {
      ordinal: context.ordinal,
      rating: rating.value,
      relative_date_raw: readField('relative_date', fields['relative_date']),
      text: body.value,
      text_truncated: body.truncated,
      author,
      meta: extractMeta(subtree, fields, read, context.locale),
      owner_reply: readReply(reply, fields, read),
      strategy_indices: indices,
    },
    quarantine: null,
  };
}

/**
 * The parts of a pack per-record extraction reads, resolved once.
 *
 * A pack arrives as untyped JSON, so every access is an optional chain with a
 * default. Doing that inline scatters eight of them through the one function
 * whose *ordering* is the thing worth reading.
 *
 * @param {any} pack
 * @returns {{
 *   fields: Record<string, any>,
 *   replyStrategies: ReadonlyArray<any>,
 *   ratingStars: any,
 *   markers: ReadonlyArray<string>,
 * }}
 */
function packView(pack) {
  return {
    fields: pack?.fields ?? {},
    replyStrategies: pack?.containers?.reply_node?.strategies ?? [],
    ratingStars: pack?.rating_stars,
    markers: pack?.truncation_markers ?? [],
  };
}

/**
 * Builds the two readers, both of which record which strategy won.
 *
 * Every field goes through here, including the optional ones. A histogram that
 * covered only the required fields would miss the case it exists to catch: an
 * optional field quietly falling back to `css` is the earliest visible sign
 * that a source changed, and it is invisible in the payload because the value
 * is still correct.
 *
 * @param {import('./html.mjs').HtmlElement} subtree
 * @returns {{
 *   read: (name: string, target: import('./html.mjs').HtmlElement, spec: any) => string | null,
 *   readField: (name: string, spec: any) => string | null,
 *   indices: Record<string, number>,
 * }}
 */
function makeReaders(subtree) {
  /** @type {Record<string, number>} */
  const indices = {};
  const probe = probeFor(subtree);

  /**
   * @param {string} name
   * @param {import('./html.mjs').HtmlElement} target
   * @param {any} spec
   * @returns {string | null}
   */
  const read = (name, target, spec) => {
    if (spec === undefined) return null;

    const resolution = resolveField(name, spec, target === subtree ? probe : probeFor(target));

    indices[name] = resolution.strategyIndex;

    return resolution.ok ? String(resolution.value) : null;
  };

  return { read, readField: (name, spec) => read(name, subtree, spec), indices };
}

/**
 * @param {number} ordinal
 * @param {string} code
 * @param {string} field
 * @param {string | null} raw
 * @returns {{ review: null, quarantine: QuarantinedRecord }}
 */
function quarantine(ordinal, code, field, raw) {
  return { review: null, quarantine: { ordinal, code, field, raw } };
}

/**
 * @param {import('./html.mjs').HtmlElement} target
 * @param {any} spec
 * @returns {string[]}
 */
function readAll(target, spec) {
  const strategy = spec?.strategies?.[0];

  if (strategy === undefined) return [];

  try {
    return queryAll(target, strategy.selector)
      .map((element) => textOf(element).replace(/\s+/gu, ' ').trim())
      .filter((value) => value !== '');
  } catch {
    return [];
  }
}

/**
 * Binds the three parsers to the pack and runs the cascade (EDR-017).
 *
 * `rating_stars` lives outside `fields` because it is not a strategy list: it
 * is a pair of selectors whose *counts* are compared. Forcing it into the field
 * shape would exempt it from TR-SEL-010, or make TR-SEL-010 meaningless for
 * everything else.
 *
 * @param {import('./html.mjs').HtmlElement} subtree
 * @param {Record<string, any>} fields
 * @param {(name: string, spec: any) => string | null} readField
 * @param {any} stars
 * @returns {import('./rating.mjs').RatingResult}
 */
function extractRating(subtree, fields, readField, stars) {
  return parseRating({
    accessibleLabel: () => readField('rating', fields['rating']),
    starCount: () => {
      if (stars?.filled_selector === undefined) return null;

      const filled = queryAll(subtree, stars.filled_selector).length;
      const total = stars.total_selector ? queryAll(subtree, stars.total_selector).length : 0;

      return countStars(filled, total);
    },
    numericText: () => {
      const raw = readField('rating_numeric', fields['rating_numeric']);

      return raw === null ? null : String(readNumber(raw) ?? '');
    },
  });
}
