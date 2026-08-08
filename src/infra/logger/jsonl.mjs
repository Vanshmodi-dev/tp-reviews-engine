/**
 * The JSONL log sink (T-132, T-133, T-134).
 *
 * ## There is exactly one write path, and it redacts
 *
 * Every event this module emits goes through `emit`, and `emit` applies the
 * redactor before anything is serialised. There is deliberately no second way
 * out — no "raw" variant, no bypass for startup, no convenience helper that
 * skips the transform for performance. LOG-ORD-02's acceptance is a code search
 * for alternative write helpers, and it should find none.
 *
 * `console.*` is forbidden outside `infra/logger/` and `cli/` (TR-LOG-024)
 * precisely because it is such an alternative path: it bypasses redaction
 * entirely, and it is one keystroke away at every call site.
 *
 * ## Construction order (LOG-ORD-01, IR-21)
 *
 * A logger REQUIRES a redactor. It is a constructor argument with no default,
 * because a default would let a logger exist before the filter is seeded, and
 * such a logger can leak a secret in its own startup event. Boot step 4 seeds
 * the filter; step 5 constructs this. That order is not negotiable, and the
 * signature is what enforces it.
 *
 * ## Ring-buffered detail (EDR-032)
 *
 * `trace` and `debug` are the levels that explain a failure and the levels
 * nobody reads on a healthy run. Writing them always is expensive and noisy;
 * dropping them means a failure arrives with no context. So they go to a bounded
 * ring buffer and are flushed **only when a target fails**.
 *
 * The buffer is bounded rather than growing, because an unbounded buffer in a
 * long run over thousands of reviews is a memory leak that presents as a crash
 * hours later, in a different component, with no obvious cause.
 *
 * @module infra/logger/jsonl
 */

import { LOG_LEVELS } from '../../ports/logger.mjs';

/** Levels that are buffered rather than written immediately. */
const BUFFERED_LEVELS = Object.freeze(['trace', 'debug']);

/** How many buffered events are retained. Oldest are dropped first. */
export const DEFAULT_BUFFER_SIZE = 500;

/** Severity order, for threshold comparison. */
const SEVERITY = Object.freeze(
  Object.fromEntries(LOG_LEVELS.map((level, index) => [level, index])),
);

/**
 * @typedef {object} LoggerOptions
 * @property {{ redact: (value: unknown) => unknown }} redactor  Required. See LOG-ORD-01.
 * @property {import('../../ports/clock.mjs').ClockPort} clock   Required; `core/` reads no clock.
 * @property {(line: string) => void} [write]      Defaults to stdout.
 * @property {string} [level]                      Minimum severity written. Default `info`.
 * @property {number} [bufferSize]
 * @property {Record<string, unknown>} [bindings]  Correlation fields on every event.
 */

/**
 * Creates a logger.
 *
 * @param {LoggerOptions} options
 * @returns {any}
 */
export function createLogger(options) {
  if (options?.redactor === undefined) {
    // Thrown rather than defaulted. A logger that quietly supplied its own
    // empty redactor would satisfy every type check and leak every secret.
    throw new Error('createLogger requires a redactor: seed it at boot step 4 (LOG-ORD-01)');
  }
  if (options.clock === undefined) {
    throw new Error('createLogger requires a clock: core reads no clock (DR-2)');
  }

  const write = options.write ?? defaultWrite;
  const threshold = severityOf(options.level ?? 'info');
  const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;

  /** @type {Record<string, unknown>[]} */
  const buffer = [];

  return build(options.bindings ?? {});

  /**
   * @param {Record<string, unknown>} bindings
   * @returns {any}
   */
  function build(bindings) {
    /**
     * The single write path. Everything below funnels through here.
     *
     * @param {string} level
     * @param {string} message
     * @param {Record<string, unknown>} [fields]
     * @returns {void}
     */
    const emit = (level, message, fields = {}) => {
      const event = /** @type {Record<string, unknown>} */ (
        options.redactor.redact({
          // The mandatory field set. `ts` and `level` first so a human scanning
          // raw JSONL can read the important part without parsing.
          ts: options.clock.nowIso(),
          level,
          msg: message,
          ...bindings,
          ...fields,
        })
      );

      if (BUFFERED_LEVELS.includes(level)) {
        buffer.push(event);
        // Bounded: the oldest event is dropped rather than the process growing
        // until it dies somewhere unrelated.
        if (buffer.length > bufferSize) buffer.shift();

        return;
      }

      if (severityOf(level) < threshold) return;

      write(JSON.stringify(event));
    };

    const logger = {
      /** @param {Record<string, unknown>} extra */
      child: (extra) => build({ ...bindings, ...extra }),

      /**
       * Drains the buffer. Called on target failure, never on success.
       *
       * Draining rather than copying: a flushed buffer must not be flushed
       * again by the next failing target, or one run's diagnostics would
       * accumulate every earlier target's noise.
       *
       * @returns {Record<string, unknown>[]}
       */
      flushBuffered: () => buffer.splice(0, buffer.length),

      /** @returns {number} */
      bufferedCount: () => buffer.length,
    };

    for (const level of LOG_LEVELS) {
      /** @type {any} */ (logger)[level] = (
        /** @type {string} */ message,
        /** @type {Record<string, unknown>} */ fields,
      ) => emit(level, message, fields);
    }

    return logger;
  }
}

/**
 * A level's severity, defaulting to `info` for anything unrecognised.
 *
 * @param {string} level
 * @returns {number}
 */
function severityOf(level) {
  return SEVERITY[level] ?? SEVERITY.info ?? 0;
}

/**
 * The default sink.
 *
 * `process.stdout.write` rather than `console.log`: one is a stream write, the
 * other formats and inspects its arguments, which for an object means a second
 * serialisation this module has already done — and one that does not go through
 * the redactor.
 *
 * @param {string} line
 * @returns {void}
 */
function defaultWrite(line) {
  process.stdout.write(`${line}\n`);
}
