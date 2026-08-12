/**
 * Alert fingerprints and lifecycle (§45).
 *
 * ## The fingerprint scope is the whole design
 *
 * `[tpre:<severity>:<condition>:<scope>]` (TRD §69.2). Get the scope wrong and
 * the system is either useless or unbearable:
 *
 * | Scope | Consequence |
 * | --- | --- |
 * | Per run | One issue every run. Useless; muted within a week. |
 * | Per error instance | An alert storm. Muted within a day. |
 * | **Per client per condition** | What an operator acts on. |
 * | **Per source per condition** | Correct for source-scoped conditions — one issue for a challenge, not one per client. |
 *
 * MON-01: the scope MUST come from the error taxonomy, which already made this
 * decision. The notifier consumes it rather than re-deciding — two places
 * deciding scope is two places to get it wrong, and they will disagree.
 *
 * ## An alerting system that only opens is one that gets muted (MON-04)
 *
 * Closing is not a nicety. An issue that stays open after its condition clears
 * teaches the operator that open issues do not mean anything, and the next real
 * one is ignored too. The close carries the run that cleared it, so "when did
 * this stop" is answerable without reading the series.
 *
 * @module core/health/alerts
 */

/** Severities that maintenance mode may NOT suppress (MON-05). */
const UNSUPPRESSIBLE = Object.freeze(['critical']);

/**
 * The fingerprint for one condition.
 *
 * Deterministic and stable across runs — that is the entire point. A
 * fingerprint containing a run id, a timestamp, or a count would open a fresh
 * issue every cycle for a condition that has not changed.
 *
 * @param {object} input
 * @param {string} input.severity
 * @param {string} input.condition   The error class or metric id.
 * @param {string} input.scope       From the taxonomy: run | source | target | record.
 * @param {string | undefined} [input.clientSlug]
 * @param {string | undefined} [input.listingKey]
 * @param {string | undefined} [input.source]
 * @returns {string}
 */
export function fingerprint({ severity, condition, scope, clientSlug, listingKey, source }) {
  return `[tpre:${severity}:${condition}:${scopeKey({ scope, clientSlug, listingKey, source })}]`;
}

/**
 * The scope segment, chosen by the taxonomy's scope rather than by the caller.
 *
 * @param {{
 *   scope: string,
 *   clientSlug?: string | undefined,
 *   listingKey?: string | undefined,
 *   source?: string | undefined,
 * }} input
 * @returns {string}
 */
function scopeKey({ scope, clientSlug, listingKey, source }) {
  if (scope === 'source') return `source/${source ?? 'unknown'}`;
  if (scope === 'run') return 'run';

  // `target` and `record` both key on the client. A record-scoped condition
  // affecting forty reviews of one listing is one problem for one operator, not
  // forty issues.
  return `client/${clientSlug ?? 'unknown'}/${listingKey ?? 'all'}`;
}

/**
 * @typedef {object} Alert
 * @property {string} fingerprint
 * @property {string} severity
 * @property {string} condition
 * @property {string} title
 * @property {string} body
 */

/**
 * Builds an alert from a health record.
 *
 * @param {object} input
 * @param {any} input.record
 * @param {any} input.errorClass  The taxonomy entry: `{ severity, scope, runbook }`.
 * @param {string} input.runUrl
 * @returns {Alert}
 */
export function alertFor({ record, errorClass, runUrl }) {
  const taxonomy = errorClass ?? {};
  const severity = taxonomy.severity ?? 'error';
  const condition = record.error_class ?? 'UNKNOWN';
  const id = fingerprint({
    severity,
    condition,
    // MON-01: the scope comes from the taxonomy, which already decided it.
    scope: taxonomy.scope ?? 'target',
    ...optional({
      clientSlug: record.client_slug,
      listingKey: record.listing_key,
      source: record.adapter,
    }),
  });

  return {
    fingerprint: id,
    severity,
    condition,
    title: `${condition} — ${record.client_slug ?? 'unknown'}/${record.listing_key ?? 'all'}`,
    body: alertBody({ record, errorClass, runUrl, severity, condition, id }),
  };
}

/**
 * Drops null and undefined keys.
 *
 * `exactOptionalPropertyTypes` distinguishes absent from present-and-undefined,
 * and a health record uses `null` for "not measured" — so the two vocabularies
 * have to be translated somewhere rather than at every call site.
 *
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 */
function optional(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  );
}

/**
 * @param {any} input
 * @returns {string}
 */
function alertBody({ record, errorClass, runUrl, severity, condition, id }) {
  const runbook = errorClass?.runbook;

  return [
    `**Condition:** \`${condition}\` (${severity})`,
    `**Client:** \`${record.client_slug}\` / \`${record.listing_key}\``,
    `**Stop reason:** \`${record.stop_reason ?? 'n/a'}\``,
    `**Run:** ${runUrl}`,
    // The runbook link is what turns an alert into an action. An alert without
    // one is a notification that somebody has to translate before acting.
    ...(runbook === undefined ? [] : ['', `Runbook: \`docs/runbooks/${runbook}.md\``]),
    '',
    id,
  ].join('\n');
}

/**
 * Whether an alert is delivered under the current mode (MON-05).
 *
 * Maintenance mode suppresses noise during planned work. It must NOT suppress
 * critical alerts: the whole point of maintenance is that somebody is looking,
 * and a challenge or a data-loss condition arriving mid-maintenance is exactly
 * when it is cheapest to act on.
 *
 * @param {Alert} alert
 * @param {{ maintenance?: boolean }} [mode]
 * @returns {boolean}
 */
export function shouldDeliver(alert, mode = {}) {
  if (mode.maintenance !== true) return true;

  return UNSUPPRESSIBLE.includes(alert.severity);
}

/**
 * Decides what to do about an alert given what is already open.
 *
 * Three outcomes rather than two: opening a duplicate is the alert-storm
 * failure, and commenting on an existing issue is what turns "it happened
 * again" into evidence rather than into forty issues.
 *
 * @param {Alert} alert
 * @param {ReadonlyArray<{ fingerprint: string, number: number }>} open
 * @returns {{ action: 'open' | 'comment', issue: number | null }}
 */
export function decideDelivery(alert, open) {
  const existing = open.find((issue) => issue.fingerprint === alert.fingerprint);

  return existing === undefined
    ? { action: 'open', issue: null }
    : { action: 'comment', issue: existing.number };
}

/**
 * Which open issues should now be closed (MON-04).
 *
 * An issue whose fingerprint no longer appears in the current alert set has
 * cleared. Closing it automatically is what stops the issue list becoming
 * archaeology.
 *
 * @param {ReadonlyArray<Alert>} current
 * @param {ReadonlyArray<{ fingerprint: string, number: number }>} open
 * @returns {Array<{ number: number, fingerprint: string }>}
 */
export function resolved(current, open) {
  const active = new Set(current.map((alert) => alert.fingerprint));

  return open
    .filter((issue) => !active.has(issue.fingerprint))
    .map((issue) => ({ number: issue.number, fingerprint: issue.fingerprint }));
}

/**
 * The closing comment.
 *
 * Names the run that cleared it, because "when did this stop" is the second
 * question anybody asks and the series is a slow way to answer it.
 *
 * @param {string} runUrl
 * @returns {string}
 */
export function closingComment(runUrl) {
  return `The condition cleared. Closed automatically by ${runUrl}.`;
}
