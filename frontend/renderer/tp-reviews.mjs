/**
 * The TP Reviews reference renderer (DEL-187, §50).
 *
 * ============================================================================
 * ZERO DEPENDENCIES. ZERO IMPORTS. TEXT-ONLY DOM APIS.
 * ============================================================================
 *
 * This file executes on websites TradyPerch does not control, which changes
 * what "careful" means here relative to the rest of the engine.
 *
 * ## FE-01 — no dependencies, and no imports at all
 *
 * A dependency in this file is a supply-chain risk multiplied by client count:
 * one compromised transitive package would execute on every client site
 * simultaneously, with no deploy of ours involved and no way for us to notice
 * from the outside. `no-restricted-syntax` bans `ImportDeclaration` in
 * `frontend/**` so this cannot drift, and the dependency-graph test asserts it
 * at the graph level.
 *
 * ## FE-02 — no HTML-injection API, ever
 *
 * Every node here is built with `createElement` and filled with `textContent`.
 * `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML` and `document.write`
 * are banned by lint AND scanned for by `tests/security/renderer-api.test.mjs`,
 * because the two mechanisms fail differently: lint is literal and fast, the
 * scan is authoritative and catches the computed forms lint cannot see.
 *
 * The normalizer already strips markup from review text upstream. That is not
 * a reason to relax here — it is the reason this holds. Two independent
 * defences against a review body containing `<script>` is the design; if this
 * file used `innerHTML` "because the text is already clean", the whole of
 * INV-05 would rest on one normalizer with no second opinion.
 *
 * ## INV-01 — the visitor's browser never contacts a review source
 *
 * This renderer makes exactly ONE request, to a URL the caller supplies, which
 * is the client's own payload origin. It has no knowledge of Google and no
 * ability to reach it. That property is what the entire engine exists to
 * provide, and the consumer side is the only place it is directly observable —
 * which is why every shipped recipe carries a network assertion (FE-03).
 *
 * ## Layout stability, and why it is done in CSS
 *
 * The container is sized before the fetch resolves so the page does not reflow
 * when reviews arrive. That reservation lives entirely in `tp-reviews.css`, as
 * `calc(var(--tp-rows) * var(--tp-row-height) + var(--tp-chrome-height))`.
 *
 * It used to be an inline `style.minHeight` set from `pageSize`, which was
 * simpler and wrong: a `style-src 'self'` policy blocks inline style —
 * including CSSOM writes — so on exactly the security-conscious sites most
 * likely to deploy this, the reservation silently did nothing and the page
 * shifted. A layout guarantee that fails quietly under a strict CSP is worse
 * than none, because it is believed.
 *
 * Nothing in this file writes a style attribute. If you change `pageSize`, set
 * `--tp-rows` to match — every recipe documents it next to `pageSize`.
 *
 * @module frontend/renderer/tp-reviews
 */

/** Rating scale. Fixed by the payload contract, not a display choice. */
const MAX_RATING = 5;

/** Reviews per page when the caller does not choose. */
const DEFAULT_PAGE_SIZE = 10;

/**
 * Renders reviews from a payload URL into an element.
 *
 * @param {Element} target
 * @param {{
 *   src: string,
 *   pageSize?: number,
 *   emptyText?: string,
 *   onError?: (error: unknown) => void,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {{ destroy: () => void, ready: Promise<void> }}
 */
export function mount(target, options) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const root = element('div', 'tp-reviews');

  // The box is at its final size the moment this class lands, before the
  // request is issued — the reservation is a CSS rule on `.tp-reviews`, not
  // something measured here.
  clear(target);
  target.append(root);

  const state = { destroyed: false };
  const ready = load(root, options, pageSize, state);

  return {
    ready,
    destroy() {
      state.destroyed = true;
      clear(target);
    },
  };
}

/**
 * @param {Element} root
 * @param {any} options
 * @param {number} pageSize
 * @param {{ destroyed: boolean }} state
 * @returns {Promise<void>}
 */
async function load(root, options, pageSize, state) {
  const request = options.fetchImpl ?? globalThis.fetch;

  try {
    const response = await request(options.src, { credentials: 'omit' });

    if (response.ok === false) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();

    if (state.destroyed) return;

    render(root, payload, { pageSize, emptyText: options.emptyText });
  } catch (error) {
    if (state.destroyed) return;

    // A visitor is not the audience for our outage. They see the empty state —
    // the same one a client with no reviews yet sees — and the host page is
    // told through a callback it opted into.
    renderEmpty(root, options.emptyText);
    options.onError?.(error);
  }
}

/**
 * Renders an already-fetched payload.
 *
 * Exported separately so a framework that fetches on the server (Next.js, Astro)
 * can render without this file issuing a request at all — which is how those
 * recipes reach zero client-side requests rather than one.
 *
 * @param {Element} root
 * @param {any} payload
 * @param {{ pageSize?: number, emptyText?: string }} [options]
 * @returns {void}
 */
export function render(root, payload, options = {}) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const reviews = Array.isArray(payload?.reviews) ? payload.reviews : [];

  if (reviews.length === 0) {
    renderEmpty(root, options.emptyText);

    return;
  }

  clear(root);
  root.classList.remove('tp-reviews--empty');

  const summary = payload.stats ? buildSummary(payload.stats) : null;
  const list = element('ol', 'tp-reviews__list');

  list.setAttribute('aria-label', 'Customer reviews');

  const status = element('p', 'tp-reviews__status');

  // Pagination replaces list content in place, so a screen reader needs to be
  // told the page changed. `role="status"` carries an implicit
  // `aria-live="polite"`, which is the right politeness — it is a navigation
  // result the visitor asked for, not an alert — so setting `aria-live` as
  // well would be two declarations of the same thing that can disagree later.
  status.setAttribute('role', 'status');

  if (summary) root.append(summary);

  root.append(list, status);

  const pages = Math.ceil(reviews.length / pageSize);
  const show = (/** @type {number} */ page) => {
    clear(list);

    for (const review of reviews.slice(page * pageSize, (page + 1) * pageSize)) {
      list.append(buildReview(review));
    }

    status.textContent = `Page ${page + 1} of ${pages}`;
  };

  show(0);

  if (pages > 1) root.append(buildPagination(pages, show));
}

/**
 * The empty state (§50.2 step 3).
 *
 * Deliberately indistinguishable from "this client has no reviews yet". A
 * visitor who sees "couldn't load reviews" learns something true but useless,
 * on a page they did not come to debug, in a widget that is not the point of
 * the page.
 *
 * @param {Element} root
 * @param {string} [text]
 * @returns {void}
 */
function renderEmpty(root, text) {
  clear(root);
  root.classList.add('tp-reviews--empty');

  const message = element('p', 'tp-reviews__empty');

  message.textContent = text ?? 'No reviews to show yet.';
  root.append(message);
}

/**
 * @param {any} stats
 * @returns {Element}
 */
function buildSummary(stats) {
  const box = element('div', 'tp-reviews__summary');
  const mean = typeof stats.mean_rating === 'number' ? stats.mean_rating : null;

  if (mean !== null) {
    box.append(buildStars(mean));

    const score = element('span', 'tp-reviews__mean');

    score.textContent = mean.toFixed(1);
    box.append(score);
  }

  const count = element('span', 'tp-reviews__count');
  const total = typeof stats.total_count === 'number' ? stats.total_count : 0;

  count.textContent = total === 1 ? '1 review' : `${total} reviews`;
  box.append(count);

  return box;
}

/**
 * A star rating with a text equivalent (§50.2 step 5).
 *
 * `role="img"` with an `aria-label` rather than five star characters: read
 * literally, the characters announce as "black star black star black star" and
 * the rating is left for the listener to count.
 *
 * @param {number} rating
 * @returns {Element}
 */
function buildStars(rating) {
  const wrap = element('span', 'tp-reviews__stars');
  const rounded = Math.round(rating);

  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `Rated ${rating.toFixed(1)} out of ${MAX_RATING}`);

  for (let index = 0; index < MAX_RATING; index += 1) {
    const star = element('span', 'tp-reviews__star');

    if (index < rounded) star.classList.add('tp-reviews__star--filled');

    // Presentational: the label above already carries the meaning, and leaving
    // these exposed would repeat it five times.
    star.setAttribute('aria-hidden', 'true');
    wrap.append(star);
  }

  return wrap;
}

/**
 * @param {any} review
 * @returns {Element}
 */
function buildReview(review) {
  const item = element('li', 'tp-reviews__review');
  const head = element('div', 'tp-reviews__head');
  const author = element('span', 'tp-reviews__author');

  // Initials are the fallback the projection leaves when a source gives no
  // usable name; "Anonymous" is the last resort and is display-only — it never
  // enters an identity hash, where it would collapse every unnamed review into
  // one record.
  author.textContent = review.author_name ?? review.author_initials ?? 'Anonymous';
  head.append(author);

  if (typeof review.rating === 'number') head.append(buildStars(review.rating));

  item.append(head);

  if (review.date) item.append(buildDate(review.date));

  if (review.text) {
    const body = element('p', 'tp-reviews__text');

    // textContent, always. A review body is visitor-supplied text that has
    // travelled through a scraper; it is the exact input TR-STD-002 exists for.
    body.textContent = review.text_truncated ? `${review.text}…` : review.text;
    item.append(body);
  }

  if (review.owner_reply) item.append(buildReply(review.owner_reply));

  return item;
}

/**
 * @param {string} iso
 * @returns {Element}
 */
function buildDate(iso) {
  const time = element('time', 'tp-reviews__date');
  const parsed = new Date(iso);

  time.setAttribute('datetime', iso);
  // Falls back to the raw value rather than rendering "Invalid Date": the
  // payload's date is an ESTIMATE with a stated precision, and a malformed one
  // should look like data to report, not like a rendering bug.
  time.textContent = Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString();

  return time;
}

/**
 * @param {any} reply
 * @returns {Element}
 */
function buildReply(reply) {
  const box = element('div', 'tp-reviews__reply');
  const label = element('span', 'tp-reviews__reply-label');

  label.textContent = 'Response from the owner';
  box.append(label);

  if (reply.text) {
    const body = element('p', 'tp-reviews__reply-text');

    body.textContent = reply.text;
    box.append(body);
  }

  return box;
}

/**
 * Pagination as real buttons (§50.2 step 5).
 *
 * `<button>` rather than a styled `<div>` or an `<a href="#">`: buttons are
 * focusable, Enter- and Space-operable, and announced as buttons, all without
 * a keydown handler that would have to reimplement each of those and would be
 * the thing that quietly breaks.
 *
 * @param {number} pages
 * @param {(page: number) => void} show
 * @returns {Element}
 */
function buildPagination(pages, show) {
  const nav = element('nav', 'tp-reviews__pages');

  nav.setAttribute('aria-label', 'Review pages');

  /** @type {Element[]} */
  const buttons = [];

  for (let page = 0; page < pages; page += 1) {
    const button = element('button', 'tp-reviews__page');

    button.setAttribute('type', 'button');
    button.textContent = String(page + 1);
    button.setAttribute('aria-label', `Page ${page + 1}`);

    button.addEventListener('click', () => {
      show(page);

      for (const [index, other] of buttons.entries()) {
        // `aria-current` and not `disabled`: disabling the active page removes
        // it from the tab order, so a keyboard user tabbing through loses
        // their place at the one control that says where they are.
        if (index === page) other.setAttribute('aria-current', 'true');
        else other.removeAttribute('aria-current');
      }
    });

    buttons.push(button);
    nav.append(button);
  }

  buttons[0]?.setAttribute('aria-current', 'true');

  return nav;
}

/**
 * @param {string} tag
 * @param {string} className
 * @returns {Element}
 */
function element(tag, className) {
  const node = document.createElement(tag);

  node.className = className;

  return node;
}

/**
 * Empties a node without touching markup.
 *
 * `replaceChildren()` and not `innerHTML = ''`: the latter is an HTML-injection
 * API being used for its side effect, which is exactly the habit TR-STD-002
 * exists to prevent — and it is the form that survives review because it looks
 * harmless.
 *
 * @param {Element} node
 * @returns {void}
 */
function clear(node) {
  node.replaceChildren();
}
