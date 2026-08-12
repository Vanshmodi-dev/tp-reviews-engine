/**
 * The metric set, derived from the health series (§46).
 *
 * ## Derived, never stored (HLTH-04, MET-01)
 *
 * Every number here is a function of the series and the `data` branch. Nothing
 * is kept as a running aggregate, because an aggregate is a second source of
 * truth and the two drift the first time a write is lost or a run is replayed —
 * at which point the dashboard and the files disagree and nobody knows which to
 * believe.
 *
 * It also means there is no metrics store to operate (CON-01). The cost is
 * recomputation, which is milliseconds over a JSONL file.
 *
 * ## Bands are stated, and they are guesses until the soak (MET-03)
 *
 * The healthy/act thresholds come from SAD Appendix G and were chosen before
 * any production data existed. §68 requires reviewing them once after thirty
 * days and adjusting deliberately. They are recorded here as data so that
 * adjustment is a diff rather than a hunt.
 *
 * @module core/health/metrics
 */

/**
 * @typedef {object} Band
 * @property {string} id
 * @property {string} label
 * @property {number | null} healthy   Better than this is fine.
 * @property {number | null} act       Worse than this needs action.
 * @property {'higher' | 'lower'} better
 * @property {string} detects
 */

/** The percentile the duration band is stated at. */
const DURATION_PERCENTILE = 0.95;

/** SAD Appendix G, as data (MET-03). */
export const BANDS = Object.freeze([
  {
    id: 'MET-success-rate',
    label: 'Success rate (30 d)',
    healthy: 0.98,
    act: 0.95,
    better: 'higher',
    detects: 'general degradation',
  },
  {
    id: 'MET-coverage',
    label: 'Coverage',
    healthy: 0.97,
    act: 0.95,
    better: 'higher',
    detects: 'partial harvests',
  },
  {
    id: 'MET-gate-rejection-rate',
    label: 'Gate rejection rate',
    healthy: 0.02,
    act: 0.1,
    better: 'lower',
    detects: 'an upstream or engine change',
  },
  {
    id: 'MET-strategy-index-0-share',
    label: 'Strategy index-0 share',
    healthy: 1,
    act: 0.95,
    better: 'higher',
    detects: 'the EARLIEST upstream-change signal — the pack running on fallbacks',
  },
  {
    id: 'MET-p95-duration-ms',
    label: 'p95 harvest duration',
    healthy: 150_000,
    act: 240_000,
    better: 'lower',
    detects: 'performance drift or a runner change',
  },
  {
    id: 'MET-challenges',
    label: 'Challenges (30 d)',
    healthy: 0,
    act: 1,
    better: 'lower',
    detects: 'a change in anti-bot posture',
  },
  {
    id: 'MET-commit-churn',
    label: 'Commits per run to data',
    healthy: 1,
    act: 3,
    better: 'lower',
    detects: 'a HASH-GATING REGRESSION (IR-06), which is otherwise invisible',
  },
  {
    id: 'MET-peak-rss-bytes',
    label: 'Peak RSS',
    healthy: 700_000_000,
    act: 900_000_000,
    better: 'lower',
    detects: 'a memory leak approaching the runner limit',
  },
]);

/**
 * Computes every metric from a health series.
 *
 * @param {ReadonlyArray<any>} records
 * @param {{ dataCommits?: number, runs?: number }} [branch]
 * @returns {Record<string, number | null>}
 */
export function computeMetrics(records, branch = {}) {
  const finished = records.filter((record) => record.outcome !== 'deferred');

  return {
    'MET-success-rate': ratio(
      finished.filter((record) => record.outcome === 'succeeded').length,
      finished.length,
    ),
    'MET-coverage': mean(records.map((record) => record.coverage)),
    'MET-gate-rejection-rate': ratio(
      records.filter((record) => record.gate_decision === 'REJECT').length,
      records.filter((record) => record.gate_decision !== null).length,
    ),
    'MET-strategy-index-0-share': indexZeroShare(records),
    'MET-p95-duration-ms': percentile(
      records.map((record) => record.duration_ms),
      DURATION_PERCENTILE,
    ),
    'MET-challenges': records.filter((record) => record.error_class === 'ERR-BLOCKED-CHALLENGE')
      .length,
    // MET-02. The ONLY detector for a hash-gating regression: its symptom is
    // ~50x commit growth on the data branch, which is invisible until the
    // branch is large enough to be a problem.
    'MET-commit-churn': ratio(branch.dataCommits ?? null, branch.runs ?? null),
    'MET-peak-rss-bytes':
      Math.max(0, ...records.map((record) => record.peak_rss_bytes ?? 0)) || null,
  };
}

/**
 * The share of resolved fields that came from strategy 0.
 *
 * The earliest signal a source changed. An average index would hide it: 0.1
 * looks like nothing and means one field in ten is already on a fallback.
 *
 * @param {ReadonlyArray<any>} records
 * @returns {number | null}
 */
function indexZeroShare(records) {
  let atZero = 0;
  let resolved = 0;

  for (const record of records) {
    for (const index of Object.values(record.strategy_histogram ?? {})) {
      // -1 means the field did not resolve at all, which is a quarantine
      // question rather than a degradation one.
      if (typeof index !== 'number' || index < 0) continue;

      resolved += 1;
      if (index === 0) atZero += 1;
    }
  }

  return ratio(atZero, resolved);
}

/**
 * @param {number | null} part
 * @param {number | null} whole
 * @returns {number | null}
 */
function ratio(part, whole) {
  // Null rather than 0 for an empty denominator. A success rate of "0" on a day
  // with no runs would page somebody about a system that did nothing wrong.
  if (part === null || whole === null || whole === 0) return null;

  return part / whole;
}

/**
 * @param {ReadonlyArray<any>} values
 * @returns {number | null}
 */
function mean(values) {
  const numbers = values.filter((value) => typeof value === 'number');

  if (numbers.length === 0) return null;

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

/**
 * Nearest-rank percentile.
 *
 * Nearest-rank rather than interpolated because the value must be one that
 * actually occurred: "p95 duration is 187 s" should name a run somebody can go
 * and look at, not an average of two that never happened.
 *
 * @param {ReadonlyArray<any>} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  const numbers = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);

  if (numbers.length === 0) return null;

  const rank = Math.max(1, Math.ceil(p * numbers.length));

  return numbers[rank - 1] ?? null;
}

/**
 * Classifies a metric against its band.
 *
 * @param {string} id
 * @param {number | null} value
 * @returns {'unknown' | 'healthy' | 'watch' | 'act'}
 */
export function classifyMetric(id, value) {
  const band = BANDS.find((entry) => entry.id === id);

  if (band === undefined || value === null) return 'unknown';

  const worseThan = (/** @type {number} */ threshold) =>
    band.better === 'higher' ? value < threshold : value > threshold;

  if (worseThan(band.act)) return 'act';
  if (worseThan(band.healthy)) return 'watch';

  return 'healthy';
}

/**
 * Every metric with its value and verdict.
 *
 * @param {ReadonlyArray<any>} records
 * @param {{ dataCommits?: number, runs?: number }} [branch]
 * @returns {Array<{ id: string, label: string, value: number | null, status: string, detects: string }>}
 */
export function report(records, branch = {}) {
  const values = computeMetrics(records, branch);

  return BANDS.map((band) => ({
    id: band.id,
    label: band.label,
    value: values[band.id] ?? null,
    status: classifyMetric(band.id, values[band.id] ?? null),
    detects: band.detects,
  }));
}
