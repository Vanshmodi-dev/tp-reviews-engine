/**
 * `NotifierPort` — telling a human something needs attention.
 *
 * ## Deduplication is required, not optional
 *
 * An implementation MUST fingerprint an alert and MUST NOT raise a second
 * notification for a fingerprint already open. A cadence-driven engine that
 * re-alerts every six hours for the same broken selector produces forty
 * notifications a week for one problem, and the human response to that is to
 * mute the channel — after which the next real alert is invisible too.
 *
 * Alert fatigue is not a nuisance in this system; it is the failure mode that
 * makes every other detection mechanism worthless.
 *
 * ## An alert names what to do
 *
 * The itemised gate reasons, the error class, and the runbook anchor. An alert
 * that says only "publish rejected" costs an engineer the twenty minutes of
 * reconstruction the engine has already done and could simply have reported.
 *
 * **This file declares. It does not implement.** See `adapters/notifier/`.
 *
 * @module ports/notifier
 */

/**
 * @typedef {object} Alert
 * @property {string} fingerprint   Stable across runs for the same problem.
 * @property {string} severity
 * @property {string} title
 * @property {string} body
 * @property {string | null} runbook  Anchor into `docs/runbooks/`.
 * @property {Record<string, unknown>} context
 */

/**
 * @typedef {object} NotifierPort
 * @property {(alert: Alert) => Promise<any>} raise
 * @property {(fingerprint: string) => Promise<any>} resolve
 *   Closes an alert whose condition has cleared, so the next occurrence is
 *   reported as new rather than suppressed as a duplicate.
 */

export {};
