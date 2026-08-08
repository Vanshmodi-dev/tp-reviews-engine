/**
 * `BrowserPort` — a controlled page, for adapters that need a rendered DOM.
 *
 * ## Why this is a port rather than "just import the browser library"
 *
 * Three reasons, in order of how much they cost when ignored:
 *
 * 1. **Isolation is a security control (INV-09).** Each target gets its own
 *    browser context. A shared context shares cookies and storage between
 *    clients, which is a cross-client data leak in a system whose entire promise
 *    is that a client's site contacts no third-party origin.
 * 2. **Nothing above `adapters/` may know a browser exists.** `app/` orchestrates
 *    harvests; if it could reach a page object it would eventually reach into
 *    one, and the pipeline would stop being testable without a browser.
 * 3. **Storage state is a credential.** It is never persisted — not to disk, not
 *    to an artifact, not to a log.
 *
 * **This file declares. It does not implement.** See `adapters/browser/`.
 *
 * @module ports/browser
 */

/**
 * @typedef {object} PageHandle
 * @property {(url: string, options?: Record<string, unknown>) => Promise<any>} goto
 * @property {(selector: string) => Promise<any>} query
 * @property {(selector: string) => Promise<any>} queryAll
 * @property {(script: string) => Promise<any>} evaluate
 * @property {() => Promise<string>} content   Sanitised before it reaches any artifact.
 * @property {() => Promise<any>} screenshot   Diagnostics only, on failure only.
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} BrowserPort
 * @property {(options?: Record<string, unknown>) => Promise<PageHandle>} newPage
 *   Each call yields a page in its own context. Contexts are never shared
 *   between targets.
 * @property {() => Promise<void>} close
 */

export {};
