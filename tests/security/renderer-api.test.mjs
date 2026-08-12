/**
 * DEL-192 — the renderer API scan (FE-02, TR-STD-002).
 *
 * The renderer executes on websites TradyPerch does not control, on text that
 * travelled from a stranger's keyboard through a scraper. If any HTML-injection
 * API appears in `frontend/`, a review body containing markup becomes markup on
 * a client's page, and the client finds out before we do.
 *
 * ## Why this exists when lint already bans these
 *
 * Two mechanisms, because they fail differently (the pattern used throughout
 * this project for rules that must not break). `no-restricted-properties` is
 * literal and fast and runs on every save; it sees `node.innerHTML` and misses
 * `node[prop]` where `prop` is computed, and it stops applying the moment
 * someone adds a file outside the configured glob. This scan reads the shipped
 * bytes and does not care how the property was reached.
 *
 * ## Comments are stripped before matching
 *
 * Twice already in this project a guard has fired on its own documentation
 * (PH-16, PH-18). A scanner that matches prose is a scanner that gets an
 * exemption added the first time it is inconvenient, and the exemption is what
 * actually breaks the rule. The file's own header explains why `innerHTML` is
 * forbidden and must be able to keep saying so.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripForMeasurement } from '../../scripts/size-report.mjs';

/**
 * Every API that can turn a string into markup, or a string into code.
 *
 * `eval` and `Function` are here alongside the DOM APIs because they are the
 * same defect wearing different clothes: a payload field reaching either one is
 * arbitrary execution on a client's site.
 */
const FORBIDDEN = [
  { pattern: /\binnerHTML\b/u, why: 'parses its value as HTML' },
  { pattern: /\bouterHTML\b/u, why: 'parses its value as HTML' },
  { pattern: /\binsertAdjacentHTML\b/u, why: 'parses its argument as HTML' },
  { pattern: /\bsetHTML\b/u, why: 'parses its argument as HTML' },
  { pattern: /\bdocument\s*\.\s*write\b/u, why: 'parses its argument as HTML' },
  { pattern: /\bcreateContextualFragment\b/u, why: 'parses a string into nodes' },
  { pattern: /\bDOMParser\b/u, why: 'exists to turn strings into documents' },
  { pattern: /\bsrcdoc\b/u, why: 'is an HTML document in an attribute' },
  { pattern: /\beval\s*\(/u, why: 'executes its argument' },
  { pattern: /\bnew\s+Function\b/u, why: 'executes its argument' },
  { pattern: /\bjavascript:/u, why: 'is executable in an href or src' },
];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function sourcesUnder(dir) {
  /** @type {string[]} */
  const found = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (entry.name.endsWith('.mjs')) found.push(path);
  }

  return found;
}

const FILES = sourcesUnder('frontend');

describe('FE-02 — the renderer contains no HTML-injection API', () => {
  it('finds the renderer, so an empty scan cannot pass as a clean one', () => {
    // The failure this prevents: `frontend/` is moved or renamed, the glob
    // matches nothing, and a scan over zero files reports green forever.
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES.some((path) => path.includes('tp-reviews'))).toBe(true);
  });

  for (const path of FILES) {
    const code = stripForMeasurement(readFileSync(path, 'utf8'));

    for (const { pattern, why } of FORBIDDEN) {
      it(`${path} does not use ${String(pattern)} — it ${why}`, () => {
        expect(pattern.test(code)).toBe(false);
      });
    }
  }

  it('still allows the header to explain what is forbidden and why', () => {
    // The scan strips comments, so the documentation naming these APIs is not
    // a violation. Asserted directly, because the alternative — discovering it
    // when someone deletes the explanation to make the build pass — is how the
    // rule loses the reason it exists.
    const raw = readFileSync('frontend/renderer/tp-reviews.mjs', 'utf8');

    expect(raw).toContain('innerHTML');
    expect(stripForMeasurement(raw)).not.toContain('innerHTML');
  });
});

describe('FE-01 — the renderer has no dependencies', () => {
  for (const path of FILES) {
    it(`${path} imports nothing at all`, () => {
      const code = stripForMeasurement(readFileSync(path, 'utf8'));

      // Not "no third-party imports" — nothing. A relative import would grow a
      // second file, and the budget and this scan are both stated per shipped
      // file. Zero imports keeps "what ships" answerable by reading one path.
      expect(/^\s*import[\s{*'"]/mu.test(code)).toBe(false);
      expect(/\bfrom\s*['"]/u.test(code)).toBe(false);
      expect(/\bimport\s*\(/u.test(code)).toBe(false);
      expect(/\brequire\s*\(/u.test(code)).toBe(false);
    });
  }
});

describe('the renderer reaches exactly one origin — the one it is given', () => {
  const code = stripForMeasurement(readFileSync('frontend/renderer/tp-reviews.mjs', 'utf8'));

  it('contains no absolute URL of any kind', () => {
    // INV-01 is the property the whole engine exists to provide: the visitor's
    // browser never contacts a review source. A hard-coded host here — even a
    // CDN for a font or an icon — would be a second request from the visitor's
    // browser that the client never agreed to and cannot see.
    expect(/https?:\/\//u.test(code)).toBe(false);
  });

  it('has no network call other than the caller-supplied fetch', () => {
    expect(/\bXMLHttpRequest\b/u.test(code)).toBe(false);
    expect(/\bWebSocket\b/u.test(code)).toBe(false);
    expect(/\bsendBeacon\b/u.test(code)).toBe(false);
    expect(/\bEventSource\b/u.test(code)).toBe(false);
  });

  it('sends no credentials with the payload request', () => {
    // A client's payload is public data on their own origin. Sending cookies
    // would make the request non-cacheable, and would attach the visitor's
    // session to a static asset fetch for no reason.
    expect(code).toContain("credentials:'omit'");
  });
});
