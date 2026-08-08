import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T-127's acceptance: an architecture test asserts the ports have **zero
 * executable behaviour**, and its verification is a reviewer confirming each
 * file only declares.
 *
 * ## Why a port with one helper stops being a boundary
 *
 * A default implementation, a convenience wrapper, or "just one shared
 * constant" turns a port into a base class. A base class is inherited from, and
 * the moment an adapter inherits behaviour from the interface it implements,
 * the interface stops describing a contract and starts describing an
 * implementation — at which point swapping a review source is no longer a
 * change to one adapter.
 *
 * The rule is mechanically checkable, so it is checked mechanically rather than
 * by remembering.
 */

const PORTS_DIR = new URL('../../src/ports/', import.meta.url);

/** @returns {string[]} */
function portFiles() {
  return readdirSync(PORTS_DIR).filter((name) => name.endsWith('.mjs'));
}

/**
 * @param {string} name
 * @returns {string}
 */
function sourceOf(name) {
  return readFileSync(new URL(name, PORTS_DIR), 'utf8');
}

/**
 * Source with comments and string literals removed.
 *
 * A port's whole value is in its documentation, so a check that searched the
 * raw text would fire on the prose explaining the very rule it enforces.
 *
 * @param {string} source
 * @returns {string}
 */
function codeOnly(source) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '')
    .replaceAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/gu, "''");
}

describe('T-127: ports declare, and do nothing', () => {
  it('finds the eight ports, so the sweep is not vacuous', () => {
    expect(portFiles().sort()).toEqual([
      'acquisition.mjs',
      'browser.mjs',
      'clock.mjs',
      'logger.mjs',
      'notifier.mjs',
      'publisher.mjs',
      'random.mjs',
      'state.mjs',
    ]);
  });

  it('declares no function anywhere', () => {
    for (const name of portFiles()) {
      const code = codeOnly(sourceOf(name));

      expect(code, `${name} declares a function`).not.toMatch(/\bfunction\b/u);
      expect(code, `${name} declares an arrow function`).not.toMatch(/=>/u);
      expect(code, `${name} declares a class`).not.toMatch(/\bclass\b/u);
    }
  });

  it('imports nothing', () => {
    // A port that imports has a dependency, and a dependency is behaviour it
    // did not declare.
    for (const name of portFiles()) {
      expect(codeOnly(sourceOf(name)), `${name} imports`).not.toMatch(/^\s*import\s/mu);
    }
  });

  it('exports only frozen vocabulary, never a value with behaviour', () => {
    // `LOG_LEVELS` and `READ_OUTCOMES` are permitted: they are the vocabulary
    // the interface is written in, and duplicating them into each adapter is
    // how two adapters end up disagreeing about what `unreadable` means.
    for (const name of portFiles()) {
      const code = codeOnly(sourceOf(name));

      for (const match of code.matchAll(/export const (\w+)\s*=\s*(.*)/gu)) {
        expect(match[2], `${name} exports non-frozen ${match[1]}`).toContain('Object.freeze');
      }
    }
  });

  it('has no runtime side effect at module scope', () => {
    for (const name of portFiles()) {
      const code = codeOnly(sourceOf(name));

      expect(code, `${name} has a top-level statement`).not.toMatch(/^\s*(?:if|for|while)\s*\(/mu);
    }
  });
});

describe('TR-LOG-024: console is confined to infra/logger/ and cli/', () => {
  /**
   * Returns filesystem paths, via `fileURLToPath`.
   *
   * `URL.pathname` is not a filesystem path: on Windows it yields a leading
   * slash before the drive letter and percent-encodes spaces, so a repository
   * checked out under "TRADY PERCH REVIWS ENGINE" produced `C:\C:\...%20...`
   * and every read failed.
   *
   * @param {URL} dir
   * @param {string[]} [found]
   * @returns {string[]}
   */
  function walk(dir, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);

      if (entry.isDirectory()) walk(child, found);
      else if (entry.name.endsWith('.mjs')) found.push(fileURLToPath(child));
    }

    return found;
  }

  it('finds no console call outside the two permitted directories', () => {
    // `console.*` bypasses redaction entirely, and it is one keystroke away at
    // every call site. That is exactly why it is checked rather than trusted.
    const offenders = [];

    for (const path of walk(new URL('../../src/', import.meta.url))) {
      // Separators normalised before matching. A forward-slash-only check
      // silently stops excluding anything on Windows, which would make this
      // test fire on a legitimate `console.log` in `cli/` — and the fix a
      // frustrated developer reaches for is to delete the test.
      if (/\/(?:infra\/logger|cli)\//u.test(path.replaceAll('\\', '/'))) continue;

      const code = readFileSync(path, 'utf8').replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');

      if (/\bconsole\s*\./u.test(code)) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });

  it('would catch a console call if one were added', () => {
    // Proves the detector works rather than that the codebase happens to be
    // clean: the same regex, against a deliberate violation.
    const violation = 'export function f() { console.log("secret"); }';

    expect(/\bconsole\s*\./u.test(violation)).toBe(true);
  });
});
