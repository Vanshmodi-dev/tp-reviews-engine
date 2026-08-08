/**
 * `StatePort` — durable engine state on the `state` branch.
 *
 * Ledgers, the identity cache, health records, and breaker state. Everything
 * here is internal; nothing here is ever published.
 *
 * ## Reading and writing are not symmetric
 *
 * `readLedger` distinguishes three outcomes and the caller must too:
 *
 * - **found** — here is the ledger.
 * - **absent** — there is genuinely no ledger; this is a first run.
 * - **unreadable** — a ledger exists and could not be parsed.
 *
 * Collapsing the last two into "no ledger" is rated `Critical` (IR-25). A
 * corrupt file would masquerade as a first run, the engine would reconcile from
 * an empty ledger, every existing review would look new, and the Publish Gate's
 * first-publish exception would wave the result through onto a live site.
 *
 * ## Writes are atomic or they do not happen
 *
 * Every implementation MUST write through a temp-then-rename path (TR-STOR-001).
 * A crash mid-write must leave the previous file intact, because the previous
 * file is the only copy of state that a rejected run still depends on.
 *
 * **This file declares. It does not implement.** See `adapters/state/`.
 *
 * @module ports/state
 */

/** What a read found. Three outcomes, never two. */
export const READ_OUTCOMES = Object.freeze(['found', 'absent', 'unreadable']);

/**
 * @typedef {object} StateRead
 * @property {string} outcome        One of {@link READ_OUTCOMES}.
 * @property {any} value             The parsed value when `found`, otherwise null.
 * @property {string | null} reason  Why it was unreadable, when it was.
 */

/**
 * @typedef {object} StatePort
 * @property {(clientSlug: string, listingKey: string) => Promise<StateRead>} readLedger
 * @property {(clientSlug: string, listingKey: string, ledger: any) => Promise<any>} writeLedger
 * @property {(record: any) => Promise<any>} appendHealth
 * @property {(key: string) => Promise<StateRead>} readBreaker
 * @property {(key: string, state: any) => Promise<any>} writeBreaker
 * @property {() => Promise<any>} commit  Publishes staged state. Separate from payload publication.
 */

export {};
