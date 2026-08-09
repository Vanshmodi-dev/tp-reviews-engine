import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The single file permitted to import the browser library (TR-BRW-001). */
const PERMITTED = 'src/adapters/browser/playwright-chromium.mjs';

/** This file, which necessarily contains the patterns it searches for. */
const SELF = 'tests/architecture/browser-confinement.test.mjs';

/**
 * @param {string} directory
 * @returns {string[]}
 */
function sourceFiles(directory) {
  /** @type {string[]} */
  const found = [];

  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;

      const path = join(current, entry);

      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.mjs')) found.push(path);
    }
  };

  walk(join(ROOT, directory));

  return found;
}

/**
 * Source with comments and string bodies blanked out.
 *
 * These guards must scan **code, not prose**. `playwright-chromium.mjs`
 * documents in its own header exactly which capabilities it must never use —
 * naming `storageState` and `page.pause()` in order to forbid them — and a
 * naive substring scan flags that documentation as the violation.
 *
 * Excluding the file instead would be worse: it is the one file where such a
 * call could actually appear. So the comments are removed and the code is
 * scanned.
 *
 * @param {string} source
 * @returns {string}
 */
function codeOnly(source) {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const two = source.slice(index, index + 2);

    if (two === '/*') {
      const end = source.indexOf('*/', index + 2);

      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (two === '//') {
      const end = source.indexOf('\n', index);

      index = end === -1 ? source.length : end;
      continue;
    }

    const character = /** @type {string} */ (source[index]);

    if (character === '"' || character === "'" || character === '`') {
      // String bodies are blanked but the quotes are kept, so an import
      // specifier still reads as `from ''` and the specifier tests below use
      // the raw source instead.
      const end = source.indexOf(character, index + 1);

      out += character;
      index = end === -1 ? source.length : end;
      continue;
    }

    out += character;
    index += 1;
  }

  return out;
}

const ALL = ['src', 'tests', 'scripts', 'bin', 'frontend']
  .flatMap((directory) => {
    try {
      return sourceFiles(directory);
    } catch {
      return [];
    }
  })
  .map((path) => ({ path, rel: relative(ROOT, path).replaceAll('\\', '/') }));

describe('DR-3 / TR-BRW-001 — exactly one file imports playwright', () => {
  it('finds the importers by resolving specifiers, not by grepping', () => {
    // PW-01 requires two mechanisms, and they must be genuinely different in
    // strength. Lint matches import specifiers per file; this resolves the
    // whole tree and counts. A rule with one mechanism is a rule that a single
    // eslint-disable retires.
    const importers = ALL.filter(({ path }) =>
      /^\s*import[^;]*from\s+['"]playwright(-core)?['"]/mu.test(readFileSync(path, 'utf8')),
    ).map(({ rel }) => rel);

    expect(importers).toEqual([PERMITTED]);
  });

  it('finds no dynamic import of the browser library either', () => {
    // `await import('playwright')` inside a function body is invisible to the
    // static import rule above and to the lint rule, and it is exactly how the
    // navigator would reach for a type helper without anyone noticing.
    const offenders = ALL.filter(({ rel }) => rel !== PERMITTED && rel !== SELF).filter(
      ({ path }) =>
        /import\s*\(\s*['"]playwright(-core)?['"]\s*\)/u.test(readFileSync(path, 'utf8')),
    );

    expect(offenders.map(({ rel }) => rel)).toEqual([]);
  });

  it('keeps `app/` and `core/` free of any browser vocabulary', () => {
    // Not a style preference. If `app/` could name a page object it would
    // eventually reach into one, and the whole pipeline would stop being
    // testable without Chromium — which is the property the fixture corpus and
    // the property laws are both built on.
    const offenders = ALL.filter(
      ({ rel }) => rel.startsWith('src/app/') || rel.startsWith('src/core/'),
    ).filter(({ path }) =>
      /\b(chromium|BrowserContext|playwright)\b/u.test(readFileSync(path, 'utf8')),
    );

    expect(offenders.map(({ rel }) => rel)).toEqual([]);
  });
});

describe('TR-BRW-014 / §15.4 — the absent capabilities stay absent', () => {
  // §15.4 is a security-review artifact: it records what the codebase must not
  // contain so an auditor can verify absence rather than infer it. Each of
  // these is a capability Playwright offers and this engine has decided against
  // — ADR-010, the engine never disguises itself.
  const FORBIDDEN = [
    ['storageState', 'a session is a credential and is never persisted'],
    ['launchPersistentContext', 'contexts are always fresh; no session is cultivated'],
    ['ignoreHTTPSErrors: true', 'TR-BRW-023 — certificate validation is never bypassed'],
    ['--no-sandbox', 'removes the process boundary around untrusted page content'],
    ['--ignore-certificate-errors', 'TR-BRW-023 — never, under any environment variable'],
    ['page.pause(', 'debug-only tooling; must not appear in committed code'],
    ['recordVideo', 'storage cost and personal-data exposure, no gain over screenshots'],
  ];

  it.each(FORBIDDEN)('contains no %s — %s', (needle) => {
    const offenders = ALL.filter(
      ({ rel }) => rel.startsWith('src/') || rel.startsWith('bin/'),
    ).filter(({ path }) => codeOnly(readFileSync(path, 'utf8')).includes(needle));

    expect(offenders.map(({ rel }) => rel)).toEqual([]);
  });

  it('declares no proxy configuration anywhere in the config surface', () => {
    // ADR-010 and TR-BRW-014. A proxy key existing at all is the beginning of
    // the argument for using one.
    const offenders = ALL.filter(({ rel }) => rel.startsWith('src/')).filter(({ path }) =>
      /\bproxy\s*:/u.test(readFileSync(path, 'utf8')),
    );

    expect(offenders.map(({ rel }) => rel)).toEqual([]);
  });
});

describe('the browser suite is the only cover the wiring has', () => {
  // `playwright-chromium.mjs` is excluded from the default coverage report
  // because its tests run in a separate vitest project. That exclusion is safe
  // only while the other project actually exists — otherwise the file silently
  // becomes untested code that no threshold complains about.
  const SUITES = [
    'tests/integration/browser-lifecycle.test.mjs',
    'tests/integration/browser-interception.test.mjs',
    'tests/integration/browser-navigation.test.mjs',
  ];

  it.each(SUITES)('%s exists and exercises the real adapter', (suite) => {
    const found = ALL.find(({ rel }) => rel === suite);

    expect(found, `${suite} is missing`).toBeDefined();
    const source = readFileSync(/** @type {any} */ (found).path, 'utf8');

    expect(source).toContain('launchBrowser');
  });
});
