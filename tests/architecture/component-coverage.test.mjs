/**
 * Every component in the TRD's table has an owning file.
 *
 * ## Why this test exists
 *
 * PH-16 was marked complete with three of its four named deliverables. Its own
 * title reads "google-dom adapter: **resolver**, consent, challenge, serialise"
 * and the resolver was never written. Nine phases passed before the SP-8 audit
 * found it, during which the harvest could not run end to end and the stated
 * reason drifted out of date.
 *
 * Nothing caught it, and the reason generalises: **every gate this project has
 * measures the code that exists.** Lint, types, coverage, the architecture
 * tests, the property laws — all of them read the tree and check properties of
 * what they find. None of them asks whether the code that was SPECIFIED is
 * there. A component that is entirely absent is invisible to all of them,
 * because absence has nothing to lint.
 *
 * This test asks the other question. It is deliberately dumb — existence, not
 * behaviour — because the failure it catches is not subtle and was not caught
 * by anything subtle.
 *
 * ## Deviations are listed, not hidden
 *
 * Two components live somewhere other than the TRD says. Both are recorded
 * below with the actual path, so the list stays honest rather than being
 * quietly relaxed to whatever the tree happens to contain.
 */

import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The TRD §1.3 component table, transcribed.
 *
 * `path` is where the file actually is. Where that differs from the TRD, `trd`
 * records what the document says and `why` records the reason — an entry with a
 * `trd` field is a deviation under review, not a settled convention.
 */
const COMPONENTS = [
  { id: 'C-01', name: 'CLI', paths: ['src/cli/index.mjs', 'src/cli/composition.mjs'] },
  { id: 'C-02', name: 'Orchestrator', paths: ['src/app/orchestrator.mjs'] },
  {
    id: 'C-03',
    name: 'Config Loader',
    paths: ['src/app/config/index.mjs'],
    trd: 'app/config/loader.mjs',
    why: 'the loader is the config package entry point; `loadConfig` is exported from index',
  },
  { id: 'C-04', name: 'Client Registry', paths: ['src/app/registry.mjs'] },
  { id: 'C-05', name: 'Shard Planner', paths: ['src/app/shard-planner.mjs'] },
  { id: 'C-06', name: 'Policy Preflight', paths: ['src/app/preflight.mjs'] },
  { id: 'C-07', name: 'Rate Limiter', paths: ['src/infra/limiter/token-bucket.mjs'] },
  {
    id: 'C-08',
    name: 'Listing Resolver',
    paths: ['src/adapters/acquisition/google-dom/resolver.mjs'],
  },
  { id: 'C-09', name: 'Browser Session', paths: ['src/adapters/browser/playwright-chromium.mjs'] },
  { id: 'C-10', name: 'Navigator', paths: ['src/adapters/acquisition/google-dom/navigator.mjs'] },
  { id: 'C-12', name: 'Extractor', paths: ['src/core/extract/index.mjs'] },
  { id: 'C-13', name: 'Normalizer', paths: ['src/core/normalize/index.mjs'] },
  { id: 'C-14', name: 'Date Resolver', paths: ['src/core/dates/relative.mjs'] },
  { id: 'C-15', name: 'Language Detector', paths: ['src/core/lang/detect.mjs'] },
  { id: 'C-18', name: 'Reconciler', paths: ['src/core/reconcile/index.mjs'] },
  { id: 'C-19', name: 'Ledger Store', paths: ['src/adapters/state/git-state.mjs'] },
  { id: 'C-20', name: 'Enricher', paths: ['src/app/enrich/index.mjs', 'src/app/enrich/noop.mjs'] },
  { id: 'C-21', name: 'Projector', paths: ['src/core/project/payload.mjs'] },
  { id: 'C-22', name: 'Publish Gate', paths: ['src/core/gate/index.mjs'] },
  { id: 'C-23', name: 'Publisher', paths: ['src/adapters/publisher/git-data.mjs'] },
  { id: 'C-24', name: 'Logger', paths: ['src/infra/logger/jsonl.mjs'] },
  {
    id: 'C-25',
    name: 'Health Recorder',
    paths: ['src/core/health/record.mjs', 'src/core/health/metrics.mjs'],
    trd: 'infra/health/recorder.mjs',
    why: 'record construction is pure and lives in core; the impure append is the state adapter',
  },
  { id: 'C-26', name: 'Notifier', paths: ['src/adapters/notifier/github-issues.mjs'] },
  {
    id: 'C-27',
    name: 'Retry Manager',
    paths: ['src/infra/retry/policy.mjs', 'src/infra/retry/execute.mjs'],
  },
  { id: 'C-28', name: 'Circuit Breaker', paths: ['src/infra/breaker/circuit.mjs'] },
  { id: 'C-30', name: 'Clock & Random', paths: ['src/infra/clock.mjs', 'src/infra/random.mjs'] },
];

describe('every specified component has an owning file', () => {
  it('checks a meaningful number of components', () => {
    // The failure mode of this test is a shortened list. Twenty-six is what the
    // TRD table holds minus the four whose owning file is a directory glob.
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(26);
  });

  it.each(COMPONENTS.map((component) => [`${component.id} ${component.name}`, component]))(
    '%s exists',
    (_label, component) => {
      for (const path of component.paths) {
        expect(existsSync(path), `${component.id} is specified but ${path} does not exist`).toBe(
          true,
        );
      }
    },
  );
});

describe('components whose location differs from the TRD', () => {
  const deviations = COMPONENTS.filter((component) => component.trd !== undefined);

  it('records a reason for each one', () => {
    // A deviation without a stated reason is indistinguishable from a mistake,
    // and this list is the only place the difference is written down.
    for (const component of deviations) {
      expect(
        component.why,
        `${component.id} deviates from the TRD with no reason given`,
      ).toBeTruthy();
    }
  });

  it('has not grown silently', () => {
    // Two are known and accepted. A third appearing means either the TRD or the
    // tree moved, and somebody should decide which is right rather than
    // discovering the drift at the next audit.
    expect(deviations.map((component) => component.id).sort()).toEqual(['C-03', 'C-25']);
  });
});

describe('every acquisition adapter the engine claims is registered', () => {
  /**
   * The adapters, by the id each one reports.
   *
   * This list exists because the component audit MISSED `google:dom`. The TRD's
   * numbered table names the browser session (C-09) and the navigator (C-10) —
   * the adapter that composes them has no row, so it had nothing to be absent
   * from, and it went unbuilt for the whole project while every part it needed
   * shipped around it.
   *
   * A component with no row is invisible to a check that reads the rows.
   */
  const ADAPTER_IDS = [
    'csv:file',
    'google:dom',
    'google:places-api',
    'google:business-profile-api',
  ];

  it('registers exactly these ids in the composition root', async () => {
    const { buildDependencies } = await import('../../src/cli/composition.mjs');
    const deps = buildDependencies({ env: {} });

    expect(Object.keys(deps.adapters).sort()).toEqual([...ADAPTER_IDS].sort());
  });

  it('gives each one the id it is registered under', async () => {
    const { buildDependencies } = await import('../../src/cli/composition.mjs');
    const deps = buildDependencies({ env: {} });

    // The registry is keyed by each adapter's own `id`, so a mismatch here
    // would mean the string in a payload's provenance block disagrees with the
    // string the config selected — and "which adapter produced this?" stops
    // being answerable.
    for (const [key, adapter] of Object.entries(deps.adapters)) {
      expect(adapter.id).toBe(key);
    }
  });

  it('does not launch a browser to register the DOM adapter', async () => {
    // Registering must be free. Most runs are CSV or API clients and never
    // touch a page; an eager launch would add seconds and ~200 MB to every
    // `plan`, `doctor` and `validate-config`, and would break those commands
    // entirely on a machine with no Chromium installed.
    const { buildDependencies } = await import('../../src/cli/composition.mjs');
    const started = Date.now();

    buildDependencies({ env: {} });

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
