/**
 * FE-03 / FE-04 — every shipped recipe carries its network assertion (§50).
 *
 * The exit criterion for §50 is "network assertion green on every shipped
 * recipe". A recipe is documentation, so the honest reading of that is: the
 * assertion must be PRESENT in every recipe, and no recipe may quietly hand a
 * client an integration that reaches a third party.
 *
 * Both halves are checkable here, and neither is checkable by reading:
 *
 * - **Presence.** A recipe added later, by someone in a hurry, is exactly the
 *   one that will omit the assertion. This fails the build instead.
 * - **Content.** Every absolute URL in every code block is checked against an
 *   allowlist of example hosts. A recipe that told a client to fetch from
 *   Google would be the single worst defect this project could ship — it would
 *   undo INV-01 on a live client site while every engine-side test stayed
 *   green, because nothing in the engine would have changed.
 *
 * What this cannot do is run React, Next.js, Astro and Vue. That is why
 * `examples/static/` exists and is executed against a real browser on every
 * browser-suite run: one recipe is proven end to end, and the rest are held to
 * the same documented shape.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** §50.3 names exactly these. Listed, not globbed, so a DELETED recipe fails too. */
const REQUIRED_RECIPES = [
  'static-html.md',
  'react.md',
  'nextjs-app-router.md',
  'astro.md',
  'vue.md',
];

/**
 * Hosts a recipe may legitimately name.
 *
 * All of them are RFC 2606 / RFC 6761 example domains or loopback — addresses
 * that cannot resolve to a real service. Anything else in a code block is a
 * host a client would actually contact.
 */
const ALLOWED_HOSTS = ['example.com', 'example.net', 'example.org', 'localhost', '127.0.0.1'];

/**
 * RFC 2606 reserves these TLDs entirely, so any host under them is guaranteed
 * not to resolve to a real service — `your-site.example`, `data.example.test`
 * and so on. Matching the TLD rather than listing hostnames means a recipe can
 * invent a readable placeholder without an allowlist edit, while a real host
 * still fails.
 */
const ALLOWED_TLDS = ['.example', '.test', '.invalid', '.localhost'];

const RECIPES = 'frontend/recipes';

/**
 * Whether a host is guaranteed not to resolve to a real service.
 *
 * @param {string} host
 * @returns {boolean}
 */
function isExampleHost(host) {
  const named = ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

  return named || ALLOWED_TLDS.some((tld) => host.endsWith(tld));
}

/**
 * Every fenced code block in a markdown file.
 *
 * Only code blocks. Prose in these files legitimately names Google — the whole
 * point of several paragraphs is to say which origins are never contacted —
 * and a scanner that matched prose would force those sentences to be deleted
 * to make the build pass, which is how a rule loses the reason it exists.
 *
 * @param {string} markdown
 * @returns {string}
 */
function codeBlocks(markdown) {
  return [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/gu)].map((match) => match[1]).join('\n');
}

describe('FE-03 — every recipe ships a network assertion', () => {
  it('ships exactly the recipes §50.3 names', () => {
    const present = readdirSync(RECIPES).filter((name) => name.endsWith('.md'));

    expect(present.sort()).toEqual([...REQUIRED_RECIPES].sort());
  });

  for (const name of REQUIRED_RECIPES) {
    const markdown = readFileSync(join(RECIPES, name), 'utf8');

    it(`${name} has a network assertion section`, () => {
      expect(markdown).toContain('## Network assertion');
    });

    it(`${name} states the claim being asserted, not just the code`, () => {
      // A snippet with no stated claim is a snippet nobody will maintain,
      // because nobody will know what it was for.
      expect(markdown).toMatch(/\*\*The claim:\*\*/u);
    });

    it(`${name} asserts against third-party origins by name`, () => {
      expect(markdown.toLowerCase()).toContain('third party');
      expect(markdown).toMatch(/google/iu);
    });
  }
});

describe('FE-04 — every recipe documents the empty state and the CSP', () => {
  for (const name of REQUIRED_RECIPES) {
    const markdown = readFileSync(join(RECIPES, name), 'utf8');

    it(`${name} documents the empty-state behaviour`, () => {
      expect(markdown).toContain('## Empty state');
      expect(markdown).toContain('No reviews to show yet.');
    });

    it(`${name} documents the CSP, including connect-src`, () => {
      expect(markdown).toContain('## CSP');
      expect(markdown).toContain('connect-src');
    });

    it(`${name} couples pageSize to --tp-rows`, () => {
      // The one coupling the renderer cannot enforce for the integrator: CSS
      // cannot read a JavaScript argument, so a recipe that omits this hands
      // over a reservation of the wrong size and a page that shifts.
      expect(markdown).toContain('--tp-rows');
    });
  }
});

describe('no recipe tells a client to contact a third party', () => {
  for (const name of REQUIRED_RECIPES) {
    it(`${name} names no host outside the example domains`, () => {
      const code = codeBlocks(readFileSync(join(RECIPES, name), 'utf8'));
      const hosts = [...code.matchAll(/https?:\/\/([^/\s'"`)]+)/gu)].map(
        // Port stripped: `example.com:3000` is the same host as `example.com`.
        (match) => (match[1] ?? '').split(':')[0] ?? '',
      );

      expect(hosts.filter((host) => !isExampleHost(host))).toEqual([]);
    });
  }

  it('scans something, so an empty scan cannot pass as a clean one', () => {
    // Guards against the regex silently matching nothing — the failure that
    // makes every assertion above vacuously true.
    const code = codeBlocks(readFileSync(join(RECIPES, 'static-html.md'), 'utf8'));

    expect(code.length).toBeGreaterThan(200);
    expect(code).toContain('mount(');
  });
});

describe('no recipe recommends weakening the policy it documents', () => {
  for (const name of REQUIRED_RECIPES) {
    it(`${name} never asks for unsafe-inline or unsafe-eval in a policy`, () => {
      const code = codeBlocks(readFileSync(join(RECIPES, name), 'utf8'));

      // The renderer evaluates nothing and writes no inline style, so neither
      // is ever needed. A recipe that asked for one would trade a client's
      // whole-site policy for a section of one page — and it is an easy thing
      // to add while debugging and forget to remove.
      expect(code).not.toContain("'unsafe-inline'");
      expect(code).not.toContain("'unsafe-eval'");
    });
  }
});
