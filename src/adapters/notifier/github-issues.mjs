/**
 * The GitHub Issues notifier (§45).
 *
 * ## It must never fail the run (MON-02, TRD §7.6)
 *
 * A harvest that published correctly and then failed because the alerting API
 * was rate-limited has turned a working run into a red build — and the operator
 * now investigates a data pipeline that did nothing wrong.
 *
 * So every call here is wrapped, every failure is logged, and the return value
 * says what happened rather than throwing. The run's exit code is decided by
 * the harvest, never by the notifier.
 *
 * ## Deduplication is the reason anyone will still read these issues in a month
 *
 * A condition that persists across cycles must comment on one issue, not open a
 * new one each time. The fingerprint carries the identity; this adapter only
 * matches on it.
 *
 * @module adapters/notifier/github-issues
 */

import { closingComment, decideDelivery, resolved, shouldDeliver } from '../../core/index.mjs';

/** The label every engine-raised issue carries, so a search can find them. */
export const ALERT_LABEL = 'tpre-alert';

/**
 * @param {object} options
 * @param {any} options.api      `{ listOpen, create, comment, close }`.
 * @param {string} options.runUrl
 * @param {{ maintenance?: boolean }} [options.mode]
 * @param {any} [options.logger]
 * @returns {any}
 */
export function createGithubIssuesNotifier({ api, runUrl, mode = {}, logger }) {
  return {
    /**
     * Delivers a whole alert set and closes what has cleared.
     *
     * @param {ReadonlyArray<any>} alerts
     * @returns {Promise<any>}
     */
    async notify(alerts) {
      const deliverable = alerts.filter((alert) => shouldDeliver(alert, mode));
      const suppressed = alerts.length - deliverable.length;
      const open = await safely(() => api.listOpen(ALERT_LABEL), logger, 'listOpen');

      if (open.ok === false) {
        // Without the open set we cannot deduplicate. Opening anyway would risk
        // the alert storm this whole module exists to prevent, so the honest
        // move is to report that alerting degraded and let the run continue.
        return { delivered: 0, suppressed, closed: 0, degraded: true, reason: open.detail };
      }

      const delivered = [];

      for (const alert of deliverable) {
        const decision = decideDelivery(alert, open.value);
        const result = await deliver(api, alert, decision, logger);

        if (result.ok) delivered.push({ ...decision, fingerprint: alert.fingerprint });
      }

      const closed = await closeCleared({
        api,
        alerts: deliverable,
        open: open.value,
        runUrl,
        logger,
      });

      return { delivered: delivered.length, suppressed, closed, degraded: false, reason: null };
    },
  };
}

/**
 * @param {any} api
 * @param {any} alert
 * @param {any} decision
 * @param {any} logger
 * @returns {Promise<any>}
 */
async function deliver(api, alert, decision, logger) {
  if (decision.action === 'comment') {
    return safely(() => api.comment(decision.issue, alert.body), logger, 'comment');
  }

  return safely(
    () => api.create({ title: alert.title, body: alert.body, labels: [ALERT_LABEL] }),
    logger,
    'create',
  );
}

/**
 * MON-04 — close what cleared, with the run that cleared it.
 *
 * @param {{
 *   api: any,
 *   alerts: ReadonlyArray<any>,
 *   open: ReadonlyArray<any>,
 *   runUrl: string,
 *   logger: any,
 * }} input
 * @returns {Promise<number>}
 */
async function closeCleared({ api, alerts, open, runUrl, logger }) {
  let closed = 0;

  for (const issue of resolved(alerts, open)) {
    const result = await safely(
      () => api.close(issue.number, closingComment(runUrl)),
      logger,
      'close',
    );

    if (result.ok) closed += 1;
  }

  return closed;
}

/**
 * @param {() => Promise<any>} work
 * @param {any} logger
 * @param {string} what
 * @returns {Promise<any>}
 */
async function safely(work, logger, what) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    // Logged, never rethrown. MON-02: an alerting failure must not change the
    // run's exit code.
    const detail = error instanceof Error ? error.message : String(error);

    logger?.warn?.('notifier.failed', { what, message: detail });

    return { ok: false, detail };
  }
}
