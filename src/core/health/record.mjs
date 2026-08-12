/**
 * Health records — one durable fact per target per run (§44).
 *
 * ## Append-only, and that is a concurrency decision (HLTH-01, EDR-033)
 *
 * Shards run in parallel. A read-modify-write of one series file from two
 * shards **loses records silently**: both read the same bytes, both append
 * their own line, and whichever writes second wins. Appending is the only
 * concurrency-safe operation available without a lock, and there are no locks
 * by design (EDR-035 — safety by path disjointness, not by locking).
 *
 * The consequence for this module is that it builds a *line*, never a series.
 * Nothing here reads what is already on disk.
 *
 * ## A record for EVERY outcome (HLTH-02)
 *
 * Succeeded, failed, blocked, deferred, skipped. Writing only failures is the
 * obvious economy and it makes **success rate — the primary health metric —
 * uncomputable**, because the denominator is gone. You cannot recover "how many
 * runs did we attempt" from a file that only contains the ones that went wrong.
 *
 * ## Derived signals are computed at read time (HLTH-04)
 *
 * No running aggregates are stored. A stored aggregate is a second source of
 * truth, and the two drift the first time a write is lost or replayed. The
 * series is the truth; everything else is a function of it.
 *
 * @module core/health/record
 */

/** Schema version for `health-record.v1.schema.json`. */
export const HEALTH_RECORD_VERSION = 1;

/**
 * Every outcome that must produce a record (HLTH-02, TRD §2.4.1).
 *
 * Listed here rather than imported from the orchestrator so that adding an
 * outcome state there without deciding what it means for health is a test
 * failure rather than a silent gap in the series.
 */
export const RECORDED_OUTCOMES = Object.freeze([
  'succeeded',
  'failed',
  'blocked',
  'deferred',
  'skipped',
]);

/**
 * Builds one health record.
 *
 * Pure: it takes an outcome and a clock reading and returns a value. The
 * appending is the state adapter's job, which is what lets the shape be
 * validated in a unit test rather than by running a harvest.
 *
 * @param {object} input
 * @param {any} input.outcome        A `TargetOutcome`.
 * @param {string} input.runId
 * @param {string} input.recordedAt  RFC 3339.
 * @param {any} [input.engine]       `{ version, packVersion, adapter }`.
 * @param {any} [input.gate]         The gate verdict, when there was one.
 * @param {number} [input.peakRssBytes]
 * @returns {Record<string, any>}
 */
export function buildHealthRecord({ outcome, runId, recordedAt, engine, gate, peakRssBytes }) {
  const target = outcome ?? {};
  const report = target.report ?? {};
  const verdict = gate ?? {};

  return {
    schema_version: HEALTH_RECORD_VERSION,
    recorded_at: recordedAt,
    run_id: runId,
    ...identity(target, engine ?? {}),
    ...counts(report),
    ...nullify({
      duration_ms: target.durationMs,
      stage_timings: report.stageTimings,
      // The earliest upstream-change signal there is. A field that has always
      // resolved at index 0 and starts resolving at index 1 says the source
      // changed while the payload is still perfectly correct.
      strategy_histogram: report.strategyHistogram,
      peak_rss_bytes: peakRssBytes,
      gate_decision: verdict.decision,
      gate_reasons: verdict.reasons,
    }),
  };
}

/**
 * Every value becomes `null` rather than disappearing.
 *
 * `undefined` vanishes through `JSON.stringify`, so an absent field would make
 * the record's *shape* vary run to run — and a consumer reading
 * `record.coverage` would get `undefined` on some lines and a number on others,
 * which is the difference between "we did not measure it" and "the key is not
 * in this version of the schema".
 *
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 */
function nullify(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? null]));
}

/**
 * "Which code and which knowledge produced this?"
 *
 * The question asked first during any incident, and unanswerable after the
 * fact without it — packs are immutable (SEL-01), so `pack_version` still
 * means something months later.
 *
 * @param {any} outcome
 * @param {any} engine
 * @returns {Record<string, any>}
 */
function identity(outcome, engine) {
  return nullify({
    client_slug: outcome.clientSlug,
    listing_key: outcome.listingKey,
    adapter: engine.adapter,
    pack_version: engine.packVersion,
    engine_version: engine.version,
    outcome: outcome.state,
    error_class: outcome.code,
  });
}

/**
 * "How much, and how much was lost where?"
 *
 * Four counts rather than one, because a drop between any adjacent pair
 * localises the loss to a stage. The stop reason sits alongside them and is the
 * only one of the five that decides completeness (VAL-01) — a reader who
 * inferred it from the counts would be making the mistake the whole design
 * exists to prevent.
 *
 * @param {any} report
 * @returns {Record<string, any>}
 */
function counts(report) {
  return nullify({
    observed_count: report.finalCount,
    extracted_count: report.extractedCount,
    quarantined_count: report.quarantinedCount,
    published_count: report.publishedCount,
    stop_reason: report.stopReason,
    completeness: report.completeness,
    coverage: report.coverage,
  });
}

/**
 * Checks a record against the shape the series promises.
 *
 * An unvalidated observability stream degrades into a stream nobody can parse
 * (HLTH-03) — and it degrades quietly, because nothing reads it until the day
 * somebody needs it.
 *
 * @param {any} record
 * @returns {string[]}
 */
export function checkHealthRecord(record) {
  /** @type {string[]} */
  const problems = [];

  if (record === null || typeof record !== 'object') return ['the record is not an object'];

  for (const field of ['recorded_at', 'run_id', 'client_slug', 'listing_key', 'outcome']) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      problems.push(`${field} is missing`);
    }
  }

  if (record.schema_version !== HEALTH_RECORD_VERSION) {
    problems.push(`schema_version must be ${HEALTH_RECORD_VERSION}`);
  }

  if (typeof record.outcome === 'string' && !RECORDED_OUTCOMES.includes(record.outcome)) {
    problems.push(`outcome "${record.outcome}" is not one of ${RECORDED_OUTCOMES.join(', ')}`);
  }

  return problems;
}

/**
 * Serialises a record as one JSONL line.
 *
 * Ends with a newline, always. A line without one silently merges with the next
 * append, and the corruption is invisible until something tries to parse the
 * series — which, by then, is every record after the join.
 *
 * @param {Record<string, any>} record
 * @returns {string}
 */
export function toJsonl(record) {
  return `${JSON.stringify(record)}\n`;
}

/**
 * Parses a series, skipping lines it cannot read.
 *
 * A single corrupt line — a half-written append from a killed runner — must not
 * make the whole series unreadable. The count of skipped lines is returned
 * rather than swallowed, because "your history has a hole in it" is a fact an
 * operator needs, not a detail to hide.
 *
 * @param {string} text
 * @returns {{ records: any[], skipped: number }}
 */
export function parseSeries(text) {
  /** @type {any[]} */
  const records = [];
  let skipped = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }

  return { records, skipped };
}
