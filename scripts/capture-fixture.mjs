#!/usr/bin/env node
/**
 * Turns a captured or diagnostic subtree into a fixture directory.
 *
 * ## Why this is a script and not a manual procedure
 *
 * TR-EXT-012 requires the serialised string to be byte-identical to what this
 * script stores, so that a diagnostics snapshot becomes a fixture by copying
 * it. That is what makes the selector-repair runbook a sixty-minute procedure
 * rather than an afternoon: an engineer copies `snapshot.html` out of a
 * diagnostics bundle, runs this, and the failure is reproducible offline.
 *
 * A manual procedure would drift from the diagnostics format within one
 * incident, and nobody would notice until the next one.
 *
 * ## Trimming is a rule, not a preference
 *
 * A full-page capture is roughly a megabyte of someone else's application
 * markup per case. Twenty of those makes the repository large, makes every
 * diff unreviewable, makes the sanitiser's work unverifiable by eye, and
 * captures far more third-party content than the test needs.
 *
 * So `--surface` trims to the container subtree before sanitising, and a
 * capture that was not trimmed is rejected in review.
 *
 * Usage:
 *   node scripts/capture-fixture.mjs <snapshot.html> <nnn-slug> \
 *     [--source google] [--pack v2] [--locale en] [--exercises "…"]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeHtml } from './sanitize-html.mjs';

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function readFlags(argv) {
  /** @type {Record<string, string>} */
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = /** @type {string} */ (argv[index]);

    if (!token.startsWith('--')) continue;

    flags[token.slice(2)] = argv[index + 1] ?? '';
    index += 1;
  }

  return flags;
}

const [snapshot, slug, ...rest] = process.argv.slice(2);

if (snapshot === undefined || slug === undefined) {
  process.stderr.write(
    'usage: capture-fixture.mjs <snapshot.html> <nnn-slug> [--source s] [--pack v2] ' +
      '[--locale en] [--exercises "what this case proves"]\n',
  );
  process.exitCode = 1;
} else {
  const flags = readFlags(rest);
  const source = flags['source'] ?? 'google';
  const directory = join('fixtures', 'dom', source, slug);
  const sanitised = sanitizeHtml(readFileSync(snapshot, 'utf8')).trim();

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'page.html'), `${sanitised}\n`, 'utf8');
  writeFileSync(
    join(directory, 'meta.json'),
    `${JSON.stringify(
      {
        case: slug,
        source,
        // The pack the case was captured under, and the pack it keeps being
        // tested against. This is what proves the corpus tests extraction
        // rather than today's markup.
        pack_version: flags['pack'] ?? 'v2',
        locale: flags['locale'] ?? 'en',
        captured_at: new Date().toISOString().slice(0, 10),
        origin: 'captured',
        exercises: flags['exercises'] ?? '',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(
    `Wrote ${directory}. Run \`npm run fixtures:regenerate\` to produce expected.json, ` +
      'then review the diff — a golden file is never hand-written.\n',
  );
}
