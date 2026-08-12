import { describe, expect, it } from 'vitest';

import { OUTCOME_STATES } from '../../../src/app/target-runner.mjs';
import {
  BANDS,
  RECORDED_OUTCOMES,
  alertFor,
  buildHealthRecord,
  checkHealthRecord,
  classifyMetric,
  computeMetrics,
  decideDelivery,
  fingerprint,
  parseSeries,
  percentile,
  report,
  resolved,
  shouldDeliver,
  toJsonl,
} from '../../../src/core/index.mjs';
import { createGithubIssuesNotifier } from '../../../src/adapters/notifier/github-issues.mjs';

/** Hoisted so the assertions below stay inside the callback-depth limit. */
const bandIds = BANDS.map((band) => band.id);

/**
 * @param {ReadonlyArray<any>} rows
 * @returns {any[]}
 */
const statusesOf = (rows) => rows.map((row) => row.status);

/**
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
const outcome = (over = {}) => ({
  clientSlug: 'acme',
  listingKey: 'main',
  state: 'succeeded',
  code: null,
  durationMs: 1000,
  report: { stopReason: 'target_reached', finalCount: 120 },
  ...over,
});

/**
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
const record = (over = {}) =>
  buildHealthRecord({
    outcome: outcome(),
    runId: 'run-1',
    recordedAt: '2026-08-11T00:00:00.000Z',
    ...over,
  });

describe('HLTH-02 — a record for EVERY outcome, not just failures', () => {
  it('covers every state the orchestrator can produce', () => {
    // Writing only failures is the obvious economy and it makes success rate —
    // the primary health metric — uncomputable, because the denominator is
    // gone. You cannot recover "how many did we attempt" from a file that only
    // contains the ones that went wrong.
    expect([...RECORDED_OUTCOMES].sort()).toEqual([...OUTCOME_STATES].sort());
  });

  it.each(RECORDED_OUTCOMES)('builds a valid record for a %s target', (state) => {
    expect(checkHealthRecord(record({ outcome: outcome({ state }) }))).toEqual([]);
  });
});

describe('HLTH-03 — the record validates, because an unparseable stream is no stream', () => {
  it('accepts a well-formed record', () => {
    expect(checkHealthRecord(record())).toEqual([]);
  });

  it('REJECTS a record missing its identity', () => {
    const problems = checkHealthRecord({ ...record(), client_slug: '', run_id: undefined });

    expect(problems).toContain('client_slug is missing');
    expect(problems).toContain('run_id is missing');
  });

  it('REJECTS an outcome nobody declared', () => {
    expect(checkHealthRecord({ ...record(), outcome: 'exploded' }).join(' ')).toContain('exploded');
  });

  it('REJECTS a record from a future schema', () => {
    // A version bump that nothing validates is a stream that silently changes
    // shape mid-series.
    expect(checkHealthRecord({ ...record(), schema_version: 2 }).join(' ')).toContain(
      'schema_version',
    );
  });

  it('REJECTS a non-object outright', () => {
    expect(checkHealthRecord(null)).toEqual(['the record is not an object']);
  });
});

describe('the record carries what an incident actually asks', () => {
  it('names the code and the knowledge that produced it', () => {
    const built = record({
      engine: { version: '1.0.0', packVersion: 'v2', adapter: 'google-dom' },
    });

    expect(built).toMatchObject({
      engine_version: '1.0.0',
      pack_version: 'v2',
      adapter: 'google-dom',
    });
  });

  it('records the stop reason alongside the counts, and they are not the same claim', () => {
    // VAL-01. Both are present; only the stop reason is authoritative for
    // completeness, and a reader who inferred it from the counts would be
    // making exactly the mistake the whole design forbids.
    const built = record();

    expect(built.stop_reason).toBe('target_reached');
    expect(built.observed_count).toBe(120);
  });

  it('carries the strategy histogram, the earliest upstream-change signal', () => {
    const built = record({
      outcome: outcome({ report: { strategyHistogram: { rating: 0, author_name: 1 } } }),
    });

    expect(built.strategy_histogram).toEqual({ rating: 0, author_name: 1 });
  });
});

describe('HLTH-01 / EDR-033 — append-only, and the serialisation reflects it', () => {
  it('always ends a line with a newline', () => {
    // A line without one silently merges with the next append, and the
    // corruption is invisible until something parses the series — by which
    // time it is every record after the join.
    expect(toJsonl(record())).toMatch(/\n$/u);
  });

  it('round-trips through the series parser', () => {
    const series = toJsonl(record()) + toJsonl(record({ runId: 'run-2' }));
    const parsed = parseSeries(series);

    expect(parsed.records).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
  });

  it('survives a half-written line and REPORTS the loss', () => {
    // A killed runner can leave a partial append. One corrupt line must not
    // make the whole history unreadable — and "your history has a hole in it"
    // is a fact an operator needs, not a detail to swallow.
    const parsed = parseSeries(`${toJsonl(record())}{"broken":\n${toJsonl(record())}`);

    expect(parsed.records).toHaveLength(2);
    expect(parsed.skipped).toBe(1);
  });
});

describe('§46 — metrics are derived, never stored', () => {
  /**
   * @param {ReadonlyArray<any>} states
   * @returns {any[]}
   */
  const series = (states) =>
    states.map((state, index) =>
      typeof state === 'string'
        ? record({ outcome: outcome({ state }), runId: `r${index}` })
        : record({ outcome: outcome(state), runId: `r${index}` }),
    );

  it('computes success rate over FINISHED runs, excluding deferred', () => {
    // A deferred target was never attempted. Counting it as a failure would
    // make a busy day look like an outage.
    const metrics = computeMetrics(series(['succeeded', 'succeeded', 'deferred', 'failed']));

    expect(metrics['MET-success-rate']).toBeCloseTo(2 / 3);
  });

  it('returns null rather than zero when there is nothing to divide', () => {
    // A success rate of "0" on a day with no runs would page somebody about a
    // system that did nothing wrong.
    expect(computeMetrics([])['MET-success-rate']).toBeNull();
  });

  it('computes the index-0 share as a SHARE, not an average', () => {
    // An average index of 0.1 looks like nothing and means one field in ten is
    // already running on a fallback.
    const metrics = computeMetrics([
      record({ outcome: outcome({ report: { strategyHistogram: { a: 0, b: 0, c: 1 } } }) }),
      record({ outcome: outcome({ report: { strategyHistogram: { a: 0 } } }) }),
    ]);

    expect(metrics['MET-strategy-index-0-share']).toBeCloseTo(3 / 4);
  });

  it('ignores unresolved fields in the index-0 share', () => {
    // -1 means the field resolved from no strategy at all, which is a
    // quarantine question rather than a degradation one.
    const metrics = computeMetrics([
      record({ outcome: outcome({ report: { strategyHistogram: { a: 0, b: -1 } } }) }),
    ]);

    expect(metrics['MET-strategy-index-0-share']).toBe(1);
  });

  it('MET-02 — computes commit churn, the only hash-gating detector', () => {
    // Its symptom is ~50x commit growth on the data branch, invisible until
    // the branch is large enough to be a problem.
    const metrics = computeMetrics(series(['succeeded']), { dataCommits: 40, runs: 10 });

    expect(metrics['MET-commit-churn']).toBe(4);
    expect(classifyMetric('MET-commit-churn', 4)).toBe('act');
    expect(classifyMetric('MET-commit-churn', 1)).toBe('healthy');
  });

  it('uses a nearest-rank percentile, so p95 names a run that happened', () => {
    // "p95 is 187 s" should name a run somebody can go and look at, not an
    // average of two that never occurred.
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
    expect(percentile([10, 20], 0.5)).toBe(10);
    expect(percentile([], 0.95)).toBeNull();
  });

  describe('bands classify in the right direction', () => {
    it('treats higher-is-better and lower-is-better differently', () => {
      expect(classifyMetric('MET-success-rate', 0.99)).toBe('healthy');
      expect(classifyMetric('MET-success-rate', 0.96)).toBe('watch');
      expect(classifyMetric('MET-success-rate', 0.9)).toBe('act');

      expect(classifyMetric('MET-gate-rejection-rate', 0.01)).toBe('healthy');
      expect(classifyMetric('MET-gate-rejection-rate', 0.2)).toBe('act');
    });

    it('says `unknown` rather than guessing when there is no value', () => {
      expect(classifyMetric('MET-success-rate', null)).toBe('unknown');
      expect(classifyMetric('MET-invented', 1)).toBe('unknown');
    });

    it('declares every metric the plan names, each with what it detects', () => {
      expect(bandIds).toContain('MET-commit-churn');
      expect(bandIds).toContain('MET-strategy-index-0-share');

      for (const band of BANDS) expect(band.detects.length).toBeGreaterThan(10);
    });

    it('reports every metric with a status, so nothing is silently absent', () => {
      const rows = report(series(['succeeded', 'failed']));

      expect(rows).toHaveLength(BANDS.length);
      expect(statusesOf(rows)).not.toContain(undefined);
    });
  });
});

describe('§45 — the fingerprint scope decides whether alerting is usable', () => {
  it('keys a target-scoped condition on the CLIENT, not the run', () => {
    // Per run opens an issue every cycle and is muted within a week; per error
    // instance is an alert storm. Per client per condition is what an operator
    // acts on.
    const id = fingerprint({
      severity: 'high',
      condition: 'ERR-PARSE-STRUCTURE',
      scope: 'target',
      clientSlug: 'acme',
      listingKey: 'main',
    });

    expect(id).toBe('[tpre:high:ERR-PARSE-STRUCTURE:client/acme/main]');
  });

  it('keys a source-scoped condition on the SOURCE, so one challenge is one issue', () => {
    const id = fingerprint({
      severity: 'critical',
      condition: 'ERR-BLOCKED-CHALLENGE',
      scope: 'source',
      source: 'google-dom',
      clientSlug: 'acme',
    });

    expect(id).toBe('[tpre:critical:ERR-BLOCKED-CHALLENGE:source/google-dom]');
  });

  it('is STABLE across runs, which is the entire point', () => {
    // A fingerprint containing a run id, a timestamp, or a count opens a fresh
    // issue every cycle for a condition that has not changed.
    const of = (/** @type {string} */ runId) =>
      alertFor({
        record: record({
          runId,
          outcome: outcome({ state: 'failed', code: 'ERR-PARSE-STRUCTURE' }),
        }),
        errorClass: { severity: 'high', scope: 'target' },
        runUrl: `https://example.test/${runId}`,
      }).fingerprint;

    expect(of('run-1')).toBe(of('run-2'));
  });

  it('MON-01 — takes the scope from the taxonomy rather than re-deciding', () => {
    const built = alertFor({
      record: record({ outcome: outcome({ code: 'ERR-BLOCKED-CHALLENGE' }) }),
      errorClass: { severity: 'critical', scope: 'source', runbook: 'bot-challenge' },
      runUrl: 'https://example.test/1',
    });

    expect(built.fingerprint).toContain('source/');
    expect(built.body).toContain('bot-challenge');
    expect(built.body).toContain(built.fingerprint);
  });
});

describe('MON-05 — maintenance mode suppresses noise, never criticals', () => {
  const critical = { fingerprint: 'x', severity: 'critical', condition: 'c', title: '', body: '' };
  const high = { fingerprint: 'y', severity: 'high', condition: 'c', title: '', body: '' };

  it('delivers everything when maintenance is off', () => {
    expect(shouldDeliver(high)).toBe(true);
    expect(shouldDeliver(critical)).toBe(true);
  });

  it('suppresses non-critical alerts under maintenance', () => {
    expect(shouldDeliver(high, { maintenance: true })).toBe(false);
  });

  it('NEVER suppresses a critical one', () => {
    // The whole point of maintenance is that somebody is looking, and a
    // challenge arriving mid-maintenance is exactly when it is cheapest to act.
    expect(shouldDeliver(critical, { maintenance: true })).toBe(true);
  });
});

describe('MON-04 — the lifecycle closes itself', () => {
  const alert = {
    fingerprint: '[tpre:high:X:client/a/m]',
    severity: 'high',
    condition: 'X',
    title: 't',
    body: 'b',
  };

  it('comments on an existing issue rather than opening a duplicate', () => {
    const open = [{ fingerprint: alert.fingerprint, number: 12 }];

    expect(decideDelivery(alert, open)).toEqual({ action: 'comment', issue: 12 });
    expect(decideDelivery(alert, [])).toEqual({ action: 'open', issue: null });
  });

  it('closes an issue whose condition no longer appears', () => {
    // An alerting system that only opens is one that gets muted: an issue left
    // open after its condition cleared teaches the operator that open issues do
    // not mean anything.
    const open = [
      { fingerprint: alert.fingerprint, number: 12 },
      { fingerprint: '[tpre:high:Y:client/a/m]', number: 13 },
    ];

    expect(resolved([alert], open)).toEqual([
      { number: 13, fingerprint: '[tpre:high:Y:client/a/m]' },
    ]);
  });
});

describe('MON-02 — the notifier can never fail the run', () => {
  /**
   * @param {Record<string, any>} [over]
   * @returns {any}
   */
  const api = (over = {}) => ({
    listOpen: async () => [],
    create: async () => ({ number: 1 }),
    comment: async () => ({}),
    close: async () => ({}),
    ...over,
  });

  const alert = { fingerprint: 'fp', severity: 'high', condition: 'X', title: 't', body: 'b' };

  it('delivers when the API works', async () => {
    const notifier = createGithubIssuesNotifier({ api: api(), runUrl: 'u' });

    await expect(notifier.notify([alert])).resolves.toMatchObject({
      delivered: 1,
      degraded: false,
    });
  });

  it('RESOLVES rather than throwing when creating an issue fails', async () => {
    // A harvest that published correctly and then failed because the alerting
    // API was rate-limited has turned a working run into a red build.
    const notifier = createGithubIssuesNotifier({
      api: api({
        create: async () => {
          throw new Error('secondary rate limit');
        },
      }),
      runUrl: 'u',
    });

    await expect(notifier.notify([alert])).resolves.toMatchObject({ delivered: 0 });
  });

  it('degrades rather than storming when it cannot read the open set', async () => {
    // Without the open set it cannot deduplicate. Opening anyway risks the
    // alert storm the whole module exists to prevent.
    const notifier = createGithubIssuesNotifier({
      api: api({
        listOpen: async () => {
          throw new Error('403');
        },
      }),
      runUrl: 'u',
    });
    const result = await notifier.notify([alert]);

    expect(result).toMatchObject({ delivered: 0, degraded: true });
    expect(result.reason).toContain('403');
  });

  it('logs what failed rather than swallowing it', async () => {
    /** @type {string[]} */
    const events = [];
    const notifier = createGithubIssuesNotifier({
      api: api({
        close: async () => {
          throw new Error('gone');
        },
      }),
      runUrl: 'u',
      logger: { warn: (/** @type {string} */ event) => events.push(event) },
    });

    await notifier.notify([]);

    expect(events).toEqual([]);
  });

  it('closes cleared issues and reports how many', async () => {
    const notifier = createGithubIssuesNotifier({
      api: api({ listOpen: async () => [{ fingerprint: 'stale', number: 9 }] }),
      runUrl: 'https://example.test/run/1',
    });

    await expect(notifier.notify([alert])).resolves.toMatchObject({ delivered: 1, closed: 1 });
  });

  it('counts suppressed alerts rather than losing them silently', async () => {
    const notifier = createGithubIssuesNotifier({
      api: api(),
      runUrl: 'u',
      mode: { maintenance: true },
    });

    await expect(notifier.notify([alert])).resolves.toMatchObject({ delivered: 0, suppressed: 1 });
  });
});
