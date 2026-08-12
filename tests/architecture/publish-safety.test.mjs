import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createGit } from '../../src/infra/git.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * PUB-04 / TR-PUB-003 — no force flags, proven two ways.
 *
 * The `data` branch is the published state of every client's reviews. A force
 * push against it discards whatever another shard committed seconds earlier,
 * and the loss is **silent**: the push succeeds, the run reports success, and a
 * client's reviews quietly revert.
 *
 * The lint rule catches a literal. This catches the rest — a flag built from a
 * variable, a flag in a workflow file, a flag in a shell script — and it also
 * catches the one thing lint cannot check at all: whether the file that *names*
 * the flags in order to reject them ever passes one to git.
 */

/**
 * The git force flags — and NOT `--force-publish`.
 *
 * `--force-publish` is the Gate's own override flag, which downgrades G-03,
 * G-04, G-05 and G-12 to warnings. It has nothing to do with git and a pattern
 * that caught it would be a pattern somebody switches off.
 *
 * The negative lookahead is what separates them: a git force flag is `--force`
 * followed by nothing, or by one of two known suffixes.
 */
const FORCE_PATTERNS = [/--force(?![-\w])/u, /--force-with-lease\b/u, /--force-if-includes\b/u];

/**
 * Source with comments removed.
 *
 * These guards must scan **code, not prose**. `ports/publisher.mjs` documents
 * the ban by quoting the flags, and `git.mjs` explains why it refuses them —
 * a substring sweep reports both as violations, which is how a guard ends up
 * deleted rather than fixed.
 *
 * @param {string} source
 * @param {string} rel
 * @returns {string}
 */
function codeOnly(source, rel) {
  if (/\.(?:yml|yaml|sh)$/u.test(rel)) return source.replaceAll(/(^|\s)#.*$/gmu, '$1');

  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');
}

/** The one file permitted to name them, because it exists to refuse them. */
const DENYLIST_FILE = 'src/infra/git.mjs';

/**
 * @param {string} directory
 * @param {ReadonlyArray<string>} extensions
 * @returns {string[]}
 */
function filesUnder(directory, extensions) {
  /** @type {string[]} */
  const found = [];

  /** @param {string} current */
  const walk = (current) => {
    let entries;

    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.git')) continue;

      const path = join(current, entry);

      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(path);
    }
  };

  walk(join(ROOT, directory));

  return found;
}

const SOURCES = ['src', 'scripts', 'bin', '.github']
  .flatMap((directory) => filesUnder(directory, ['.mjs', '.yml', '.yaml', '.sh']))
  .map((path) => ({ path, rel: relative(ROOT, path).replaceAll('\\', '/') }));

describe('no force flag reaches git', () => {
  it('finds files to check, so the sweep is not vacuous', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it.each(FORCE_PATTERNS.map((pattern) => [String(pattern), pattern]))(
    '%s appears nowhere outside the denylist',
    (_label, pattern) => {
      const offenders = SOURCES.filter(({ rel }) => rel !== DENYLIST_FILE).filter(({ path, rel }) =>
        /** @type {RegExp} */ (pattern).test(codeOnly(readFileSync(path, 'utf8'), rel)),
      );

      expect(offenders.map(({ rel }) => rel)).toEqual([]);
    },
  );

  it('names them in the denylist ONLY as data, never in a git argument list', () => {
    // The exemption above lets this one file mention the flags. This is what
    // stops the exemption from becoming a hole: they may appear inside the
    // frozen array and nowhere else in the file.
    const source = codeOnly(readFileSync(join(ROOT, DENYLIST_FILE), 'utf8'), DENYLIST_FILE);
    const denylist = /FORBIDDEN_FLAGS = Object\.freeze\(\[[^\]]*\]\)/u.exec(source);

    expect(denylist, 'the denylist array was not found').not.toBeNull();

    const elsewhere = source.replace(/** @type {any} */ (denylist)[0], '');

    for (const pattern of FORCE_PATTERNS) expect(elsewhere).not.toMatch(pattern);
  });

  it('refuses at runtime, not only at lint time', async () => {
    // A flag arriving through a variable passes lint and would reach git. This
    // is the direction that matters, because the argument that reaches git is
    // the one that does the damage.
    /** @type {string[][]} */
    const calls = [];
    const git = createGit({
      cwd: ROOT,
      exec: async (/** @type {string} */ _file, /** @type {string[]} */ args) => {
        calls.push(args);

        return { stdout: '' };
      },
    });
    // Split so the lint rule cannot see the literal — which is exactly the
    // shape of the flag this guard exists to catch.
    const sneaky = ['push', 'origin', 'HEAD:data', ['--for', 'ce'].join('')];

    await expect(git.git(sneaky)).rejects.toThrow(/TR-PUB-003/u);
    expect(calls).toEqual([]);
  });

  it('allows the ordinary commands it needs', async () => {
    /** @type {string[][]} */
    const calls = [];
    const git = createGit({
      cwd: ROOT,
      exec: async (/** @type {string} */ _file, /** @type {string[]} */ args) => {
        calls.push(args);

        return { stdout: 'ok' };
      },
    });

    await git.git(['fetch', 'origin', 'data']);
    await git.git(['rebase', 'origin/data']);

    expect(calls).toHaveLength(2);
  });
});

describe('PUB-05 / TR-TEST-071 — the publisher is reachable only post-gate', () => {
  /**
   * @param {string} rel
   * @returns {string[]}
   */
  const importsOf = (rel) =>
    [...readFileSync(join(ROOT, rel), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
      (match) => /** @type {string} */ (match[1]),
    );

  it('is imported by the composition root and by nothing in core/ or app/', () => {
    // A publisher reachable from a non-gated path is a payload that can reach a
    // client's website without the Gate ever having seen it — which is the one
    // outcome the Gate exists to make impossible.
    /** @param {string} rel @returns {boolean} */
    const reachesPublisher = (rel) =>
      importsOf(rel).some((specifier) => specifier.includes('publisher/'));

    const offenders = SOURCES.filter(
      ({ rel }) => rel.startsWith('src/core/') || rel.startsWith('src/app/'),
    ).filter(({ rel }) => reachesPublisher(rel));

    expect(offenders.map(({ rel }) => rel)).toEqual([]);
  });

  it('does not reach back into the gate, the ledger, or an acquisition adapter', () => {
    // The publisher writes bytes it was handed. If it could re-read the gate it
    // could re-decide, and if it could reach acquisition it could re-harvest
    // during a publish.
    const publisher = filesUnder('src/adapters/publisher', ['.mjs']).map((path) =>
      relative(ROOT, path).replaceAll('\\', '/'),
    );

    expect(publisher.length).toBeGreaterThan(0);

    for (const rel of publisher) {
      for (const specifier of importsOf(rel)) {
        expect(specifier, rel).not.toMatch(/core\/gate|acquisition|adapters\/browser/u);
      }
    }
  });
});
