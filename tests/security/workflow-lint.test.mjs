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

/**
 * The catalogue of §48.2, listed rather than globbed.
 *
 * Globbing would let a DELETED workflow pass silently — every remaining file
 * would still satisfy every rule, and the suite would go green over a
 * repository that had stopped harvesting. Naming them makes removal a failure.
 */
const CATALOGUE = [
  'ci.yml',
  'harvest.yml',
  'validate-config.yml',
  'canary.yml',
  'pages.yml',
  'keepalive.yml',
  'release.yml',
  'dependency-audit.yml',
];

/**
 * @param {string} name
 * @returns {string}
 */
function sourceOf(name) {
  const found = files.find((file) => file.name === name);

  if (found === undefined) throw new Error(`workflow ${name} is missing`);

  return found.source;
}

describe('§48.2 — the eight workflows', () => {
  it('ships exactly the catalogue, no more and no fewer', () => {
    expect(files.map((file) => file.name).sort()).toEqual([...CATALOGUE].sort());
  });

  it('finds workflows to check, so the suite is not vacuous', () => {
    // A rename of the directory would otherwise turn every assertion below into
    // a pass over an empty list.
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.map((file) => file.name)).toContain('harvest.yml');
  });
});

describe('TR-CI-130 / TR-CI-131 — the two deliberate permission absences', () => {
  it('gives the harvest alert job no contents permission', () => {
    // It raises incidents. An incident reporter that could write to the
    // repository could, in the middle of an incident, make it worse.
    const alert = /alert:[\s\S]*?permissions:\s*\n((?:\s+\w[^\n]*\n)+)/u.exec(
      sourceOf('harvest.yml'),
    );

    expect(alert).not.toBeNull();
    expect(/** @type {any} */ (alert)[1]).toContain('issues: write');
    expect(/** @type {any} */ (alert)[1]).not.toContain('contents:');
  });

  it('gives the pages deploy job no contents permission', () => {
    const pages = sourceOf('pages.yml');
    const deploy = /deploy:[\s\S]*?permissions:\s*\n((?:\s+[\w#][^\n]*\n)+)/u.exec(pages);

    expect(deploy).not.toBeNull();

    const declared = /** @type {any} */ (deploy)[1];

    // The job that publishes to the public internet cannot write to the
    // repository. There is no code path from "the deploy went wrong" to "the
    // payloads are gone".
    expect(declared).toContain('pages: write');
    expect(declared).toContain('id-token: write');
    expect(declared).not.toMatch(/^\s*contents:/mu);
  });
});

describe('canary.yml — the workflow that must never publish (TR-CI-150)', () => {
  const canary = sourceOf('canary.yml');

  it('never checks out the data branch', () => {
    // The structural half of the guarantee. Without a `data` working tree the
    // publisher has nowhere to write, so "the canary published" is not a bug
    // that can happen — it does not depend on a flag staying correct.
    expect(canary).not.toMatch(/ref:\s*data/u);
  });

  it('does not claim a --dry-run flag that does not exist', () => {
    // Publication happens inside the eleven stages, and stage 1 (C-08) has no
    // implementation, so a flag to suppress publication would suppress nothing
    // while reading as a guarantee. The structural absence above is the real
    // one; this asserts we did not paper over it with a flag as well.
    expect(canary).not.toMatch(/^\s*node bin\/tpre\.mjs.*--dry-run/mu);
  });

  it('states in the file why the data checkout is absent', () => {
    // The mirror of CI-03. In harvest.yml the data checkout looks like an
    // optimisation to remove; here its ABSENCE looks like an oversight to fix.
    // Both need the reason written down next to them.
    expect(canary).toMatch(/DELIBERATELY ABSENT/u);
  });

  it('is offset from every harvest cron', () => {
    const minuteOf = (/** @type {string} */ source) =>
      [...source.matchAll(/cron:\s*'(\d+)\s/gu)].map((match) => match[1]);

    const harvestMinutes = minuteOf(sourceOf('harvest.yml'));
    const canaryMinutes = minuteOf(canary);

    expect(canaryMinutes.length).toBeGreaterThan(0);

    for (const minute of canaryMinutes) {
      expect(harvestMinutes).not.toContain(minute);
    }
  });
});

describe('keepalive.yml — both halves (§48.3, TR-CI-110)', () => {
  const keepalive = sourceOf('keepalive.yml');

  it('PREVENTS dormancy by producing activity', () => {
    expect(keepalive).toMatch(/keepalive\.txt/u);
    expect(keepalive).toMatch(/git push origin state/u);
  });

  it('DETECTS dormancy by asking whether the schedule is enabled', () => {
    // The half that catches RISK-17. Producing activity is a hope; asking the
    // API whether harvest is still active is a check. Without this, every
    // client goes stale in silence and the first symptom is a client asking
    // why their reviews stopped months ago.
    expect(keepalive).toMatch(/listRepoWorkflows/u);
    expect(keepalive).toMatch(/harvest\.yml/u);
    expect(keepalive).toMatch(/setFailed/u);
  });

  it('runs comfortably inside the 60-day disable window', () => {
    // Monthly. A single missed run must not be able to spend the whole cushion.
    expect(keepalive).toMatch(/cron:\s*'[^']*\d+ \* \*'/u);
  });
});

describe('release.yml — re-verification, not a rubber stamp', () => {
  const release = sourceOf('release.yml');

  it('re-runs the full gate at the tag', () => {
    // ci.yml ran against a PR merge commit, which is a different tree whenever
    // anything else landed in between.
    for (const step of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run test:browser']) {
      expect(release).toContain(step);
    }
  });

  it('checks the renderer size budget before the tag ships', () => {
    expect(release).toContain('npm run size');
  });

  it('refuses a tag that disagrees with ENGINE_VERSION', () => {
    // The version is stamped into every payload's provenance block. A mismatch
    // makes "which engine produced this?" unanswerable from the data.
    expect(release).toContain('ENGINE_VERSION');
  });

  it('publishes only after verification passes', () => {
    expect(release).toMatch(/release:[\s\S]*?needs:\s*verify/u);
  });
});

describe('dependency-audit.yml — the one-dependency posture', () => {
  const audit = sourceOf('dependency-audit.yml');

  it('fails if the production dependency count grows beyond one', () => {
    expect(audit).toMatch(/count.*-gt 1|DEP-1/u);
  });

  it('does not fail the run for merely-outdated packages', () => {
    // `npm outdated` exits non-zero almost always. A permanently red workflow
    // is one nobody reads, which costs more than the signal is worth.
    expect(audit).toMatch(/npm outdated \|\| true/u);
  });
});

describe('every workflow invokes the CLI with flags the CLI actually defines', () => {
  /**
   * The flags each command accepts, read from the CLI itself rather than
   * restated here — a copy would drift and then agree with the workflow while
   * both disagreed with the code.
   *
   * @returns {Promise<Map<string, Set<string>>>}
   */
  async function commandFlags() {
    const { buildCommands } = await import('../../src/cli/composition.mjs');
    // Global flags apply to every command (`GLOBAL_OPTIONS` in cli/index.mjs).
    const global = ['help', 'version', 'output', 'log-level'];
    const table = new Map();

    for (const command of buildCommands({ env: {}, redactor: { secretCount: 0 } })) {
      table.set(command.name, new Set([...global, ...Object.keys(command.options ?? {})]));
    }

    return table;
  }

  /**
   * @param {RegExpMatchArray} match
   * @param {string} file
   * @returns {{ file: string, command: string, flags: string[] }}
   */
  const toInvocation = (match, file) => ({
    file,
    command: match[1] ?? '',
    flags: [...(match[2] ?? '').matchAll(/--([a-z-]+)/gu)].map((flag) => flag[1] ?? ''),
  });

  /** Every `node bin/tpre.mjs …` line in every workflow, with its flags. */
  const invocations = files.flatMap(({ name, source }) =>
    [...source.matchAll(/node bin\/tpre\.mjs\s+([a-z-]+)((?:\s+[^\n|>]*)?)/gu)].map((match) =>
      toInvocation(match, name),
    ),
  );

  it('finds invocations to check, so the assertion is not vacuous', () => {
    expect(invocations.length).toBeGreaterThanOrEqual(4);
  });

  it.each(invocations.map((call) => [`${call.file}: tpre ${call.command}`, call]))(
    '%s',
    async (_label, call) => {
      // This is the guard that was missing. `harvest.yml` shipped in PH-19
      // calling `plan --json`; `--json` is not a defined flag, `parseArgs` runs
      // with `strict: true`, so it exited 2 — a usage error, classified as a
      // genuine failure — on every scheduled run. Nothing caught it, because
      // workflow-lint checked the TEXT of workflows and never asked whether the
      // commands inside them were real.
      const table = await commandFlags();
      const known = table.get(call.command);

      expect(known, `unknown command: ${call.command}`).toBeDefined();

      for (const flag of call.flags) {
        expect(
          /** @type {Set<string>} */ (known).has(flag),
          `tpre ${call.command} has no --${flag}`,
        ).toBe(true);
      }
    },
  );
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
      // `permissions: {}` is the STRICTEST declaration there is — no scopes at
      // all, every job forced to state its own. Reading only the block form
      // rejected it as if it were a missing declaration, which would have
      // pushed pages.yml towards a weaker top-level grant to satisfy the
      // linter. A guard that penalises the safest option is worse than none.
      const empty = /^permissions:\s*\{\s*\}\s*$/mu.test(source);
      const block = /^permissions:\s*\n((?:\s+.+\n)+)/mu.exec(source);

      expect(empty || block !== null, 'no top-level permissions declaration').toBe(true);

      const declared = empty ? '' : /** @type {any} */ (block)[1];

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
