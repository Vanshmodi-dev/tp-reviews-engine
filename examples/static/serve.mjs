/**
 * A static server for the example (DEL-191).
 *
 * ## Why the renderer is not copied in here
 *
 * `index.html` asks for `./tp-reviews.mjs` and `./tp-reviews.css`, and this
 * server maps both to the real files in `frontend/renderer/`.
 *
 * Copying them into this directory would be simpler to read and wrong: the
 * copy would drift from the file the size budget and the security scan
 * actually measure, and the example would then demonstrate a renderer nobody
 * ships. An example that can diverge from the thing it exemplifies is worse
 * than no example, because it is believed.
 *
 * Run it with `node examples/static/serve.mjs`, then open the printed URL.
 *
 * @module examples/static/serve
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

/** Where each requested path is actually read from. */
const ROUTES = {
  '/': ['examples/static/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['examples/static/index.html', 'text/html; charset=utf-8'],
  '/reviews.json': ['examples/static/reviews.json', 'application/json; charset=utf-8'],
  '/example.mjs': ['examples/static/example.mjs', 'text/javascript; charset=utf-8'],
  '/example.css': ['examples/static/example.css', 'text/css; charset=utf-8'],
  '/tp-reviews.mjs': ['frontend/renderer/tp-reviews.mjs', 'text/javascript; charset=utf-8'],
  '/tp-reviews.css': ['frontend/renderer/tp-reviews.css', 'text/css; charset=utf-8'],
};

const NOT_FOUND = 404;
const OK = 200;
const DEFAULT_PORT = 8787;

/**
 * @param {{ port?: number, onRequest?: (path: string) => void }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startExampleServer(options = {}) {
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';

    options.onRequest?.(path);

    const route = ROUTES[/** @type {keyof typeof ROUTES} */ (path)];

    if (route === undefined) {
      response.writeHead(NOT_FOUND).end('not found');

      return;
    }

    const [file, type] = route;

    if (file === undefined || type === undefined) {
      response.writeHead(NOT_FOUND).end('not found');

      return;
    }

    response.writeHead(OK, {
      'content-type': type,
      // The same policy the recipe documents, served as a real header rather
      // than only as a meta tag, because a header is what a client's CDN will
      // actually apply — and because a policy that is only ever asserted in
      // prose is one nobody has run the integration against.
      //
      // No `'unsafe-inline'`. If a future edit reintroduces an inline script or
      // an inline style, the browser refuses it and the example visibly breaks,
      // which is the only reliable way this stays true.
      'content-security-policy':
        "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'",
    });
    response.end(readFileSync(file));
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = /** @type {any} */ (server.address());

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

if (process.argv[1]?.endsWith('serve.mjs')) {
  const started = await startExampleServer({ port: DEFAULT_PORT });

  process.stdout.write(`example running at ${started.url}\n`);
}
