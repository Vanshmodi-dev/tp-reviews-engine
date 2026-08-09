/**
 * The fixture server (DEL-83) — deterministic acquisition dynamics, no network.
 *
 * ## Why this is built before the navigator, in the same phase
 *
 * §31.1. Scroll loops, stall detection, and expansion budgets all need a page
 * that *behaves*: one that yields reviews in batches, that can be made to stop
 * yielding, that can be made slow. Testing those against the live source makes
 * the suite flaky, and a flaky acquisition suite gets disabled — at which point
 * the most consequential logic in the system has no tests at all.
 *
 * **This one file is what makes every acquisition test deterministic.** It is
 * the cheapest item in the phase and it removes the largest single source of
 * flakiness in the project.
 *
 * ## It serves the same markup the regression suite uses
 *
 * Not a hand-written approximation of a review page. The corpus in
 * `fixtures/dom/google/` is what extraction is tested against, so it is what
 * navigation is driven against too — otherwise the two suites can both pass
 * while disagreeing about what a page looks like.
 *
 * ## The six capabilities (§31.1)
 *
 * | Capability | Exercises |
 * | --- | --- |
 * | Serve a full corpus page | Happy-path pagination |
 * | Stop yielding after batch N | Stall → `partial` → gate rejection (CH-04) |
 * | Delay responses | Timeout paths |
 * | Serve a challenge page | Terminal challenge detection (CH-03) |
 * | Serve a consent interstitial | Dismissal path |
 * | Log every request | Interception measurement (§29.3) |
 *
 * @module fixtures/server/serve
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', 'dom', 'google');

/** Reviews revealed per scroll batch, so pagination has something to do. */
const DEFAULT_BATCH = 12;

/**
 * @typedef {object} RequestRecord
 * @property {string} method
 * @property {string} url
 * @property {number} bytes
 * @property {number} at
 */

/**
 * Reads a fixture's markup and splits it into a shell and its review nodes.
 *
 * The split is what makes lazy loading possible: the page ships with the first
 * batch inline and asks for the rest, exactly as a virtualised feed does.
 *
 * @param {string} slug
 * @returns {{ head: string, nodes: string[], tail: string }}
 */
function splitFixture(slug) {
  const html = readFileSync(join(CORPUS, slug, 'page.html'), 'utf8');
  const open = html.indexOf('<div role="article"');

  if (open === -1) return { head: html, nodes: [], tail: '' };

  const close = html.lastIndexOf('</div>');
  const body = html.slice(open, close);
  const nodes = body
    .split(/(?=<div role="article")/u)
    .map((node) => node.trim())
    .filter((node) => node !== '');

  return { head: html.slice(0, open), nodes, tail: html.slice(close) };
}

/**
 * The page shell, which reveals its own reviews in batches.
 *
 * The script is inline and tiny on purpose: the navigator must exercise a real
 * scroll container with real lazy loading, and anything larger would make the
 * fixture the thing under test.
 *
 * @param {{
 *   slug: string,
 *   batch: number,
 *   stopAfter: number | null,
 *   advertised: number | null,
 *   hideSurface: boolean,
 * }} options
 * @returns {string}
 */
function lazyPage({ slug, batch, stopAfter, advertised, hideSurface }) {
  const { head, nodes, tail } = splitFixture(slug);
  const total = advertised ?? nodes.length;
  const payload = JSON.stringify(nodes);

  // Removing the surface is a capability, not a hack: "the container itself is
  // gone" and "the container is there and empty" are different failures with
  // opposite correct responses, and the navigator has to tell them apart.
  //
  // EVERY marker has to go. The first version renamed `role="feed"` only, and
  // the pack's second surface strategy (`[data-review-list]`) still matched the
  // same element — so the fixture reported a healthy surface while claiming to
  // have removed it, which would have made the test assert nothing.
  const shell = hideSurface
    ? head.replaceAll('role="feed"', 'role="banner"').replaceAll('data-review-list', 'data-nothing')
    : head;

  return `${shell}
<style>
  /* A real scroll container. Without a bounded height the feed never overflows,
     nothing scrolls, and the pagination loop is never actually exercised - the
     fixture would pass while testing nothing. */
  [role="feed"] { height: 400px; overflow-y: auto; display: block; }
  [role="article"] { min-height: 120px; }
</style>
<script id="feed-data" type="application/json">${payload.replaceAll('<', '\\u003c')}</script>
<script>
(() => {
  const all = JSON.parse(document.getElementById('feed-data').textContent);
  const feed = document.querySelector('[role="feed"]') || document.body;
  const batch = ${batch};
  const stopAfter = ${stopAfter === null ? 'null' : stopAfter};
  let shown = 0;

  const reveal = () => {
    // "Stop yielding after batch N" is the whole point of the stall fixture:
    // the container keeps scrolling and the count keeps not changing.
    if (stopAfter !== null && shown >= stopAfter) return;

    const next = all.slice(shown, shown + batch);
    if (next.length === 0) return;
    feed.insertAdjacentHTML('beforeend', next.join(''));
    shown += next.length;
  };

  reveal();
  // ON SCROLL ONLY. An earlier version also revealed on a timer "to keep the
  // fixture honest", and it did the opposite: everything materialised before
  // the navigator scrolled once, so the growth curve had a single entry and the
  // pagination loop was never exercised at all.
  feed.addEventListener('scroll', reveal, { passive: true });
  window.addEventListener('scroll', reveal, { passive: true });
  window.__advertisedTotal = ${total};
})();
</script>
${tail}`;
}

/**
 * Starts the fixture server.
 *
 * @param {object} [options]
 * @param {number} [options.port]  0 picks a free port, which is what tests want.
 * @returns {Promise<{
 *   url: string,
 *   requests: RequestRecord[],
 *   close: () => Promise<void>,
 * }>}
 */
export function startFixtureServer(options = {}) {
  /** @type {RequestRecord[]} */
  const requests = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const body = render(url);

    requests.push({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      bytes: Buffer.byteLength(body.content),
      at: Date.now(),
    });

    const delayMs = Number(url.searchParams.get('delay') ?? 0);

    const send = () => {
      response.writeHead(body.status, {
        'content-type': body.contentType,
        'content-length': String(Buffer.byteLength(body.content)),
        // No caching: a second navigation in the same test must see the same
        // dynamics rather than a browser-cached copy of the first.
        'cache-control': 'no-store',
      });
      response.end(body.content);
    };

    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = /** @type {any} */ (server.address());

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Routes one request.
 *
 * @param {URL} url
 * @returns {{ status: number, contentType: string, content: string }}
 */
function render(url) {
  const path = url.pathname;

  if (path === '/health') return json({ ok: true, cases: listCases() });

  if (path.startsWith('/raw/')) {
    return html(readFileSync(join(CORPUS, path.slice('/raw/'.length), 'page.html'), 'utf8'));
  }

  if (path.startsWith('/listing/')) {
    const slug = path.slice('/listing/'.length);

    if (!listCases().includes(slug)) return notFound(slug);

    return html(
      lazyPage({
        slug,
        batch: Number(url.searchParams.get('batch') ?? DEFAULT_BATCH),
        stopAfter: url.searchParams.has('stopAfter')
          ? Number(url.searchParams.get('stopAfter'))
          : null,
        advertised: url.searchParams.has('advertised')
          ? Number(url.searchParams.get('advertised'))
          : null,
        hideSurface: url.searchParams.has('hideSurface'),
      }),
    );
  }

  return notFound(path);
}

/**
 * @returns {string[]}
 */
export function listCases() {
  return readdirSync(CORPUS)
    .filter((entry) => /^\d{3}-/u.test(entry))
    .sort();
}

/**
 * @param {string} content
 * @returns {{ status: number, contentType: string, content: string }}
 */
function html(content) {
  return { status: 200, contentType: 'text/html; charset=utf-8', content };
}

/**
 * @param {unknown} value
 * @returns {{ status: number, contentType: string, content: string }}
 */
function json(value) {
  return { status: 200, contentType: 'application/json', content: JSON.stringify(value) };
}

/**
 * @param {string} what
 * @returns {{ status: number, contentType: string, content: string }}
 */
function notFound(what) {
  // A 404 with the available cases listed, because the alternative is a test
  // that fails with "surface not found" when the real problem is a typo.
  return {
    status: 404,
    contentType: 'application/json',
    content: JSON.stringify({ error: `no fixture for ${what}`, available: listCases() }),
  };
}
