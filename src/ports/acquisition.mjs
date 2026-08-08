/**
 * `AcquisitionPort` — the interface that earns the architecture.
 *
 * Four adapters implement it in v1.0: a DOM adapter, two official APIs, and
 * CSV. The CSV adapter is built **first**, before any browser code exists, and
 * that ordering is deliberate: an interface validated against a single
 * implementation is a rename, not an interface. Two implementations that differ
 * in kind — one scraping a rendered page, one reading a file — is what forces
 * the shape to be honest.
 *
 * ## The contract that matters most: the stop reason
 *
 * An implementation MUST report **why** it stopped, and MUST NOT report
 * completeness itself. Completeness is derived from the stop reason by
 * `core/validate/completeness.mjs` and nowhere else (VAL-01).
 *
 * The temptation is to compare counts — "I got 118 of 118, so this is complete".
 * That is wrong in both directions and silently: a source that under-reports its
 * own total makes a partial harvest look full, and every review the harvest
 * missed then begins a countdown to deletion. The navigator knows something a
 * count never can, which is why the loop stopped.
 *
 * ## Capabilities explain nulls
 *
 * An adapter declares what it *could* supply. "This adapter cannot see owner
 * replies" is a different fact from "this review has no owner reply", and a
 * consumer cannot tell them apart without the declaration.
 *
 * **This file declares. It does not implement.** See `adapters/acquisition/`.
 *
 * @module ports/acquisition
 */

/**
 * @typedef {object} AcquisitionRequest
 * @property {any} listing        The listing to harvest, from effective config.
 * @property {number} targetCount How many reviews to seek before stopping.
 * @property {number} cap         Our own ceiling. Reaching it yields `cap_reached`.
 * @property {any} budget         Time and request budget for this harvest.
 */

/**
 * @typedef {object} AcquisitionResult
 * @property {ReadonlyArray<any>} reviews  Raw records, pre-normalisation.
 * @property {string} stop_reason          One of `STOP_REASONS`. **Never a completeness value.**
 * @property {number | null} advertised_total   The source's claim, unmodified.
 * @property {number | null} advertised_rating  The source's claim, unmodified.
 * @property {ReadonlyArray<string>} capabilities  What this adapter could supply.
 * @property {any} diagnostics             Timings, request counts, selector health.
 */

/**
 * @typedef {object} AcquisitionPort
 * @property {string} id  e.g. `google:dom`. Appears in provenance.
 * @property {() => ReadonlyArray<string>} capabilities
 * @property {(request: AcquisitionRequest) => Promise<any>} harvest
 *   Resolves to a `Result` carrying an `AcquisitionResult`. **Never throws** for
 *   an expected failure; a blocked source is a value, not an exception.
 */

export {};
