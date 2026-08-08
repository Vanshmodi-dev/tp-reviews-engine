import { defineConfig } from 'vitest/config';

/**
 * TP Reviews Engine - test runner.
 *
 * Two projects. `default` is everything that runs offline and blocks a merge;
 * `live` is opt-in and touches the network.
 *
 * TR-TEST-010 / TR-TEST-021 / IR-18: tests/live/ is excluded from the default
 * runner and must stay excluded. A network-dependent test in the blocking path
 * trains engineers to re-run CI until it passes, and that habit is then applied
 * to every red build - which destroys the value of every other test here,
 * including the property laws and the Gate's coverage obligation.
 */

const PERCENT_FULL = 100;
const PERCENT_HIGH = 95;
const PERCENT_GOOD = 90;
const PERCENT_OVERALL = 70;

/** @param {number} n @returns {{statements:number,branches:number,functions:number,lines:number}} */
const all = (n) => ({ statements: n, branches: n, functions: n, lines: n });

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'default',
          include: ['tests/**/*.test.mjs'],
          exclude: ['tests/live/**', '**/node_modules/**'],
          environment: 'node',
          // 61.3.2: no shared mutable state between tests, and no global setup.
          globals: false,
          // Fifteen property laws run 1,000 generated cases each, and CI runs
          // them under v8 coverage instrumentation on a shared runner. A single
          // law legitimately takes several seconds there; the 10 s this started
          // at was set when the suite was a tenth of its current size, and
          // tightening it further would fail runs for being on a busy machine
          // rather than for being wrong.
          //
          // This is not cover for a slow test. Anything genuinely quadratic is
          // caught by tests/budgets/, which asserts complexity class rather than
          // wall-clock and would fail long before this timeout mattered.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'live',
          include: ['tests/live/**/*.test.mjs'],
          environment: 'node',
          globals: false,
          // The directory is expected to be empty until PH-19. An empty opt-in
          // suite is a pass, not a failure.
          passWithNoTests: true,
          testTimeout: 120_000,
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.mjs'],
      exclude: ['src/**/index.mjs', 'tests/**'],

      // TEST-CFG-01: thresholds are per-path, never a single global number. A
      // global threshold lets the two 100% modules degrade while the average is
      // carried by trivially-covered constants files.
      //
      // TEST-CFG-02: written in week 1, with the paths that do not exist yet. A
      // threshold added after the module is written is a threshold set to
      // whatever the module happened to achieve.
      thresholds: {
        // Overall floor, effective from PH-06.
        ...all(PERCENT_OVERALL),

        // The Publish Gate decides whether anything reaches a visitor at all.
        // 100% is what surfaces an unreached branch, which is how IR-08
        // (short-circuit evaluation) is caught.
        'src/core/gate/**': all(PERCENT_FULL),

        // The last thing standing between a secret and a public CI log.
        'src/infra/logger/redact.mjs': all(PERCENT_FULL),

        'src/core/normalize/**': all(PERCENT_HIGH),
        'src/core/dates/**': all(PERCENT_HIGH),
        'src/core/identity/**': all(PERCENT_HIGH),
        'src/core/validate/**': all(PERCENT_HIGH),
        'src/core/reconcile/**': all(PERCENT_HIGH),
        'src/core/project/**': all(PERCENT_HIGH),
        'src/infra/retry/**': all(PERCENT_HIGH),

        'src/core/extract/**': all(PERCENT_GOOD),
        'src/app/config/**': all(PERCENT_GOOD),
        'src/core/**': all(PERCENT_GOOD),
      },
    },
  },
});
