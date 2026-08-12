import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/**
 * DEL-179 — CI-05 / CI-06 asserted mechanically, across every workflow.
 *
 * `ci.yml` carried an inline bash version of these checks from PH-00, which
 * could only ever check the workflows as a whole and could not be run locally.
 * This replaces it: the same rules, in the blocking suite, where a developer
 * sees them before pushing.
 *
 * Parsed by line rather than with a YAML library. DEP-2 forbids a dependency
 * for anything achievable in under a hundred readable lines, and every property
 * here is a property of the file's *text* — "is there a permissions block",
 * "is every `uses:` pinned" — rather than of its parsed shape.
 */

const files = readdirSync(WORKFLOWS)
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .map((entry) => ({ name: entry, source: readFileSync(join(WORKFLOWS, entry), 'utf8') }));

/**
 * @param {string} source
 * @returns {string[]}
 */
function usesLines(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('uses:'));
}

describe('the workflow set is non-empty', () => {
  it('finds workflows to check, so the suite is not vacuous', () => {
    // A rename of the directory would otherwise turn every assertion below into
    // a pass over an empty list.
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.map((file) => file.name)).toContain('harvest.yml');
  });
});

describe('TR-CI-001 / IR-20 — every workflow declares its permissions', () => {
  it.each(files.map((file) => [file.name, file.source]))(
    '%s has a top-level block',
    (_n, source) => {
      // A workflow without one inherits whatever the repository default happens
      // to be — a setting nobody re-reads after the day it was configured, and
      // one that a repository-wide change can widen silently.
      expect(source).toMatch(/^permissions:/mu);
    },
  );

  it.each(files.map((file) => [file.name, file.source]))(
    '%s starts from contents: read or narrower',
    (_n, source) => {
      const block = /^permissions:\s*\n((?:\s+.+\n)+)/mu.exec(source);

      expect(block, 'no top-level permissions block').not.toBeNull();

      const declared = /** @type {any} */ (block)[1];

      // `write-all` is the shape that makes every other control decorative.
      expect(declared).not.toMatch(/write-all/u);
      expect(source).not.toMatch(/^permissions:\s*write-all/mu);
    },
  );
});

describe('TR-CI-002 — third-party actions are pinned to a full commit SHA', () => {
  it.each(files.map((file) => [file.name, file.source]))('%s pins every action', (_n, source) => {
    // A tag is mutable. A compromised upstream can move `v4` under us without a
    // single byte changing in this repository, and the next scheduled run
    // executes whatever it now points at.
    const external = usesLines(source).filter((line) => !line.includes('./.github/'));
    const unpinned = external.filter((line) => !/@[0-9a-f]{40}\b/u.test(line));

    expect(unpinned).toEqual([]);
  });

  it('carries a version comment beside each SHA, because a SHA is unreadable', () => {
    // The pin is the control; the comment is what lets a human review the
    // upgrade. Without it, a bump from v4 to v7 looks like forty random
    // characters changing.
    /** @param {{ name: string, source: string }} file @returns {any[]} */
    const externalIn = (file) =>
      usesLines(file.source)
        .filter((line) => !line.includes('./.github/'))
        .map((line) => ({ file: file.name, line }));

    const external = files.flatMap(externalIn);

    expect(external.length).toBeGreaterThan(0);

    for (const { file, line } of external) {
      expect(line, `${file}: ${line}`).toMatch(/#\s*v[\d.]+/u);
    }
  });
});

describe('TR-CI-003 / CI-06 — pull_request_target appears nowhere', () => {
  it.each(files.map((file) => [file.name, file.source]))('%s does not use it', (_n, source) => {
    // It runs with the base repository's token against a fork's code, which is
    // how a public repository hands a write token to an untrusted pull request.
    //
    // Anchored on the YAML key rather than the bare word: the phrase appears in
    // the comments explaining the ban, and a check that flags its own rationale
    // gets deleted rather than fixed.
    expect(source).not.toMatch(/^\s*pull_request_target:/mu);
  });
});

describe('INV-09 — a matrix never cancels its siblings', () => {
  it('sets fail-fast: false wherever a matrix exists', () => {
    // One shard failing must not cancel the others: they are separate clients,
    // and cancelling them turns one source's bad morning into every client
    // going stale.
    const matrixed = files.filter((file) => /^\s+matrix:/mu.test(file.source));

    expect(matrixed.length).toBeGreaterThan(0);

    for (const file of matrixed) {
      expect(file.source, file.name).toMatch(/fail-fast:\s*false/u);
    }
  });
});

describe('harvest.yml — the requirements that are specific to it', () => {
  const harvest = /** @type {any} */ (files.find((file) => file.name === 'harvest.yml')).source;

  it('checks out BOTH the data and state branches (CI-03, IR-10)', () => {
    // Rated CRITICAL, and it looks exactly like an optimisation opportunity.
    // The `data` checkout is what the Gate compares against; without it G-03,
    // G-04, G-05 and G-12 have nothing to compare TO — and they do not fail,
    // they PASS vacuously. Four gate rules silently disabled and a green run.
    expect(harvest).toMatch(/ref:\s*data/u);
    expect(harvest).toMatch(/ref:\s*state/u);
  });

  it('states in the file WHY the data checkout must not be removed', () => {
    // CI-03 requires the comment, because the next person to read this looking
    // for a speed-up needs the reason in front of them.
    expect(harvest).toMatch(/IR-10/u);
    expect(harvest).toMatch(/vacuous/iu);
  });

  it('treats exit codes 5, 6 and 7 as successes (CI-04, EDR-030)', () => {
    // A red badge that means "working as designed" is worse than no badge: the
    // next genuinely broken build looks identical, and the maintainer has
    // already learned to ignore it.
    const classify = /Classify the exit code[\s\S]*?(?=\n {6}- name:|\n {2}\w)/u.exec(harvest);

    expect(classify, 'no classification step found').not.toBeNull();

    const step = /** @type {any} */ (classify)[0];

    for (const code of ['0', '4', '5', '6', '7']) {
      expect(step, `code ${code} is not classified`).toMatch(new RegExp(`\\n\\s*${code}\\)`, 'u'));
    }

    // Only the default arm exits non-zero.
    expect(step).toMatch(/\*\)[\s\S]*exit 1/u);
  });

  it('emits the shard matrix from a JOB, never a literal (EDR-029, SCHED-05)', () => {
    // A hard-coded matrix goes stale the moment a client is added, and the
    // failure is silent: the new client simply never appears in a shard.
    expect(harvest).toMatch(/matrix:\s*\$\{\{\s*fromJson\(needs\.plan\.outputs\.matrix\)/u);
    expect(harvest).toMatch(/outputs:\s*\n\s+matrix:/u);
  });

  it('gives the alert job NO contents permission (TR-CI-130)', () => {
    // A deliberate absence. This job runs when something has already gone
    // wrong; granting `contents` would mean the code path reacting to a broken
    // run can also write to `data`. Without the permission that is not
    // unlikely, it is impossible.
    const alert = /\n {2}alert:\n([\s\S]*)$/u.exec(harvest);

    expect(alert, 'no alert job found').not.toBeNull();

    const job = /** @type {any} */ (alert)[1];

    expect(job).toMatch(/permissions:/u);
    expect(job).not.toMatch(/contents:/u);
    expect(job).toMatch(/issues:\s*write/u);
  });

  it('offsets its cron schedules so no two tiers start together (§28.3)', () => {
    // A source observing our request rate cannot otherwise distinguish a tier
    // boundary from a canary — which makes our own pacing unreadable to us as
    // well as to them.
    const minutes = [...harvest.matchAll(/cron:\s*'(\d+)\s/gu)].map((match) => match[1]);

    expect(minutes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(minutes).size).toBe(minutes.length);
  });
});

describe('CI-01 / TR-CI-004 — setup logic exists exactly once', () => {
  it('is in the composite action, and no workflow repeats it', () => {
    // A Node or browser version change must be a one-file edit, not a hunt
    // across eight workflows. PH-14 inlined the browser steps in ci.yml; the
    // moment harvest.yml also needed a browser that became two copies of a
    // version-sensitive step.
    const action = readFileSync(
      join(ROOT, '.github', 'actions', 'setup-engine', 'action.yml'),
      'utf8',
    );

    expect(action).toMatch(/playwright install/u);
    expect(action).toMatch(/node-version-file:\s*\.nvmrc/u);

    for (const file of files) {
      expect(file.source, `${file.name} installs a browser itself`).not.toMatch(
        /run:.*playwright install/u,
      );
      expect(file.source, `${file.name} runs npm ci itself`).not.toMatch(/run:\s*npm ci\b/u);
    }
  });

  it('prints a versions banner, so the log answers "which browser" (CI-02)', () => {
    const action = readFileSync(
      join(ROOT, '.github', 'actions', 'setup-engine', 'action.yml'),
      'utf8',
    );

    expect(action).toMatch(/GITHUB_STEP_SUMMARY/u);
    expect(action).toMatch(/playwright/iu);
  });
});
