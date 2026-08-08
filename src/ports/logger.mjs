/**
 * `LoggerPort` — structured events, redacted at the sink.
 *
 * ## Redaction is not the caller's job (EDR-031)
 *
 * Every implementation of this port MUST apply redaction at the sink. The
 * conventional alternative — asking each call site to avoid logging secrets —
 * works until one call site logs a whole config object, and one omission is a
 * permanent secret exposure in a public repository. Human discipline is not a
 * control for an irreversible failure.
 *
 * A careless `log.debug({ detail: config })` must be safe by construction.
 *
 * ## Levels
 *
 * `trace` and `debug` are ring-buffered and flushed only on target failure
 * (EDR-032), so the common case pays almost nothing for them and a failure
 * still gets the detail that explains it.
 *
 * **This file declares. It does not implement.** See `infra/logger/`.
 *
 * @module ports/logger
 */

/** Ascending severity. `fatal` ends the run. */
export const LOG_LEVELS = Object.freeze(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/**
 * @typedef {object} LoggerPort
 * @property {(message: string, fields?: Record<string, unknown>) => void} trace
 * @property {(message: string, fields?: Record<string, unknown>) => void} debug
 * @property {(message: string, fields?: Record<string, unknown>) => void} info
 * @property {(message: string, fields?: Record<string, unknown>) => void} warn
 * @property {(message: string, fields?: Record<string, unknown>) => void} error
 * @property {(message: string, fields?: Record<string, unknown>) => void} fatal
 * @property {(bindings: Record<string, unknown>) => LoggerPort} child
 *   A logger carrying additional correlation fields on every event.
 * @property {() => ReadonlyArray<Record<string, unknown>>} flushBuffered
 *   Drains the ring buffer. Called on target failure, never on success.
 */

export {};
