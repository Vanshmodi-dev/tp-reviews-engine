#!/usr/bin/env node
/**
 * Validates every JSON artifact in the repository against its schema.
 *
 * ## Why this exists as a script rather than only as a test
 *
 * The CI "Schemas" step ran a stub that printed "not yet implemented" and
 * exited 0 for several phases. A gate that passes without checking anything is
 * worse than no gate: the badge is green, the step is named, and everybody
 * reasonably assumes the schemas are being enforced.
 *
 * It is a script rather than a test because it validates *repository content*
 * — packs, profiles, client configs — which are authored by operators in pull
 * requests, not by engineers in the test suite. An operator whose config is
 * rejected needs the error at `validate-config` time, not buried in a test run.
 *
 * ## No JSON Schema library
 *
 * Full JSON Schema validation would be a dependency, and DEP-1 requires a
 * documented gap first. What this repository actually needs is: does every JSON
 * file parse, does every pack satisfy the selector rules, and does every profile
 * pin a pack that exists. The selector rules are the ones with teeth, and they
 * are already implemented in `core/selectors/loader.mjs` — which is where the
 * checks JSON Schema *cannot* express live anyway.
 *
 * When a payload needs full schema validation at the gate (G-01), that is the
 * point at which a validator earns its dependency.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { checkAssertionFile } from '../src/core/selectors/assertions.mjs';
import { checkPack } from '../src/core/selectors/loader.mjs';

const ENGINE_VERSION = '1.0.0';

/** @type {string[]} */
const problems = [];

/**
 * @param {string} directory
 * @returns {string[]}
 */
function jsonFilesIn(directory) {
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
      const path = join(current, entry);

      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.json')) found.push(path);
    }
  };

  walk(directory);

  return found;
}

/**
 * @param {string} path
 * @returns {any}
 */
function parseOrReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${path}: not valid JSON — ${error instanceof Error ? error.message : error}`);

    return null;
  }
}

// --- Every JSON file must parse. -------------------------------------------
for (const directory of ['schemas', 'selectors', 'profiles', 'clients']) {
  for (const path of jsonFilesIn(directory)) parseOrReport(path);
}

// --- Selector packs must satisfy the rules the schema cannot express. -------
const packPaths = jsonFilesIn('selectors').filter((path) => /[/\\]v\d+\.json$/u.test(path));

if (packPaths.length === 0) problems.push('selectors/: no versioned pack found');

/** @type {Map<string, Set<string>>} */
const packVersions = new Map();

for (const path of packPaths) {
  const pack = parseOrReport(path);

  if (pack === null) continue;

  for (const problem of checkPack(pack, { engineVersion: ENGINE_VERSION })) {
    problems.push(`${path}: ${problem}`);
  }

  const source = pack?.meta?.source;

  if (typeof source === 'string') {
    const versions = packVersions.get(source) ?? new Set();

    versions.add(pack.meta.version);
    packVersions.set(source, versions);
  }
}

// --- An assertion file must be able to fail (DEL-92). ----------------------
// An assertion with no bound, or a file with no assertions, passes every canary
// run — which is the worst possible outcome for a mechanism whose entire job is
// to notice that something changed.
for (const path of jsonFilesIn('selectors').filter((entry) => entry.endsWith('assertions.json'))) {
  const file = parseOrReport(path);

  if (file === null) continue;

  for (const problem of checkAssertionFile(file)) problems.push(`${path}: ${problem}`);
}

// --- A profile may only pin a pack that exists (TR-SEL-004). ---------------
// A pin to a missing version fails at load, mid-run, for every client on that
// profile. Catching it here makes it a rejected pull request instead.
for (const path of jsonFilesIn('profiles')) {
  const profile = parseOrReport(path);

  for (const [source, version] of Object.entries(profile?.selector_packs ?? {})) {
    if (packVersions.get(source)?.has(/** @type {string} */ (version))) continue;

    problems.push(`${path}: pins ${source} pack "${version}", which does not exist`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.length} schema problem(s):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);

  // `process.exitCode`, not `process.exit()`. TR-CLI-003 confines the latter to
  // `cli/`, and the reason applies here too: a forced exit can truncate pending
  // stdout, so a long problem list would be reported to CI incompletely — which
  // is the worst possible failure for a diagnostic.
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Validated ${packPaths.length} selector pack(s) and every JSON file in ` +
      `schemas/, selectors/, profiles/, clients/.\n`,
  );
}
