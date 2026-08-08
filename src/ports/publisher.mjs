/**
 * `PublisherPort` — writing artifacts where a client's website can fetch them.
 *
 * ## Hash-gating is part of the contract, not an optimisation
 *
 * An implementation MUST NOT write a file whose bytes equal the bytes already
 * there (FR-065). Without that, every run commits every artifact for every
 * client on every cycle, and the git history — which is the audit log — fills
 * with diffs that mean nothing.
 *
 * ## Ordering is payload first, then state (EDR-025)
 *
 * Two commits to two branches cannot be atomic. A crash between them leaves the
 * system inconsistent in one of two ways, and they are not equally recoverable:
 *
 * - **Payload written, state not:** the next run re-reconciles from the older
 *   ledger and produces the same payload. A benign no-op, because
 *   reconciliation is idempotent.
 * - **State written, payload not:** the ledger records reviews as published that
 *   were never published. The next run sees no changes, hash-gates the write,
 *   and **the payload is never produced**. The system silently converges on a
 *   wrong state.
 *
 * The general principle worth extracting: when two writes cannot be atomic,
 * order them so a crash between them leaves a state the next run can repair.
 *
 * ## Never force
 *
 * `--force` and `--force-with-lease` MUST NOT be used against `data` or `state`
 * (TR-PUB-010). On a non-fast-forward, fetch and rebase; shards write disjoint
 * paths, so a rebase can only ever be an ancestry update, never a content
 * conflict.
 *
 * **This file declares. It does not implement.** See `adapters/publisher/`.
 *
 * @module ports/publisher
 */

/**
 * @typedef {object} PublishTarget
 * @property {string} clientSlug
 * @property {string} listingKey
 * @property {Record<string, { bytes: string, contentHash: string }>} artifacts
 */

/**
 * @typedef {object} PublishResult
 * @property {ReadonlyArray<string>} written   Paths actually written.
 * @property {ReadonlyArray<string>} skipped   Paths whose bytes were unchanged.
 * @property {string | null} commit            The commit sha, or null when nothing changed.
 */

/**
 * @typedef {object} PublisherPort
 * @property {(target: PublishTarget) => Promise<any>} stage
 * @property {(message: string) => Promise<any>} commit
 * @property {() => Promise<any>} push
 * @property {(clientSlug: string, listingKey: string) => Promise<any>} readCurrent
 *   Returns a `StateRead`-shaped value: the gate needs `absent` and `unreadable`
 *   kept apart (GATE-03).
 */

export {};
