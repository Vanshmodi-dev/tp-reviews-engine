/**
 * The `Result` discriminated union — the core's only error mechanism.
 *
 * EDR-002 / ERR-03: `core/` never throws. JavaScript's default error mechanism
 * is the exception, and using it inside a pure functional core means every
 * caller must reason about control flow that is invisible in the signature.
 * Here, the set of failures a function can produce stays visible in its
 * contract instead of accumulating in undocumented throw sites.
 *
 * Exceptions are thrown only at adapter and infrastructure boundaries, and are
 * converted to classified outcomes at exactly one place — the target runner
 * (ERR-04).
 *
 * **There is deliberately no `unwrap()` that throws on an error.** Providing one
 * would reintroduce the exception at every call site that finds unwrapping
 * tedious, which is precisely the failure this module exists to prevent. Use
 * {@link match}, {@link unwrapOr}, or {@link unwrapOrElse}.
 *
 * Every returned Result is frozen. A Result is a value, and a value that a
 * later stage can mutate is not one.
 *
 * @module core/util/result
 */

/**
 * @template T
 * @typedef {{ readonly ok: true, readonly value: T }} Ok
 */

/**
 * @template E
 * @typedef {{ readonly ok: false, readonly error: E }} Err
 */

/**
 * @template T
 * @template E
 * @typedef {Ok<T> | Err<E>} Result
 */

/**
 * Wraps a success value.
 *
 * @template T
 * @param {T} value
 * @returns {Ok<T>}
 */
export function ok(value) {
  return Object.freeze({ ok: /** @type {const} */ (true), value });
}

/**
 * Wraps a failure. `error` is normally an `ErrorClass` code from
 * `core/model/errors.mjs` or a structured object carrying one.
 *
 * @template E
 * @param {E} error
 * @returns {Err<E>}
 */
export function err(error) {
  return Object.freeze({ ok: /** @type {const} */ (false), error });
}

/**
 * @template T
 * @template E
 * @param {Result<T, E>} result
 * @returns {result is Ok<T>}
 */
export function isOk(result) {
  return result.ok;
}

/**
 * @template T
 * @template E
 * @param {Result<T, E>} result
 * @returns {result is Err<E>}
 */
export function isErr(result) {
  return !result.ok;
}

/**
 * Transforms a success value, leaving a failure untouched.
 *
 * @template T
 * @template U
 * @template E
 * @param {Result<T, E>} result
 * @param {(value: T) => U} fn
 * @returns {Result<U, E>}
 */
export function map(result, fn) {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Transforms a failure, leaving a success untouched. Used to add context to an
 * error as it crosses a stage boundary, never to reclassify it.
 *
 * @template T
 * @template E
 * @template F
 * @param {Result<T, E>} result
 * @param {(error: E) => F} fn
 * @returns {Result<T, F>}
 */
export function mapErr(result, fn) {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chains a fallible step. The pipeline stops at the first failure, which is
 * what makes an eleven-stage sequence readable as a sequence.
 *
 * @template T
 * @template U
 * @template E
 * @template F
 * @param {Result<T, E>} result
 * @param {(value: T) => Result<U, F>} fn
 * @returns {Result<U, E | F>}
 */
export function andThen(result, fn) {
  return result.ok ? fn(result.value) : result;
}

/**
 * Recovers from a failure by producing another Result.
 *
 * @template T
 * @template U
 * @template E
 * @template F
 * @param {Result<T, E>} result
 * @param {(error: E) => Result<U, F>} fn
 * @returns {Result<T | U, F>}
 */
export function orElse(result, fn) {
  return result.ok ? result : fn(result.error);
}

/**
 * @template T
 * @template E
 * @param {Result<T, E>} result
 * @param {T} fallback
 * @returns {T}
 */
export function unwrapOr(result, fallback) {
  return result.ok ? result.value : fallback;
}

/**
 * @template T
 * @template E
 * @param {Result<T, E>} result
 * @param {(error: E) => T} fn
 * @returns {T}
 */
export function unwrapOrElse(result, fn) {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Exhaustive handling. The type checker requires both branches, which is the
 * point: a failure cannot be forgotten the way an ignored return value can.
 *
 * @template T
 * @template E
 * @template R
 * @param {Result<T, E>} result
 * @param {{ ok: (value: T) => R, err: (error: E) => R }} handlers
 * @returns {R}
 */
export function match(result, handlers) {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error);
}

/**
 * Collects many Results into one, failing on the first error in order.
 *
 * Order matters and is guaranteed: the reported failure is the earliest one,
 * not whichever the iteration happened to reach first. Two runs over the same
 * input must report the same error, or a defect becomes irreproducible.
 *
 * @template T
 * @template E
 * @param {ReadonlyArray<Result<T, E>>} results
 * @returns {Result<T[], E>}
 */
export function all(results) {
  const values = [];

  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }

  return ok(values);
}

/**
 * Partitions Results into successes and failures, preserving input order in
 * both. Used where one bad record must be quarantined without failing the
 * harvest — "fail closed on permission, fail soft on data".
 *
 * @template T
 * @template E
 * @param {ReadonlyArray<Result<T, E>>} results
 * @returns {{ values: T[], errors: E[] }}
 */
export function partition(results) {
  /** @type {T[]} */
  const values = [];
  /** @type {E[]} */
  const errors = [];

  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }

  return { values, errors };
}

/**
 * Lifts a nullable value into a Result. `undefined` and `null` both become the
 * failure; every other value, including `0`, `''` and `false`, succeeds.
 *
 * @template T
 * @template E
 * @param {T | null | undefined} value
 * @param {E} error
 * @returns {Result<NonNullable<T>, E>}
 */
export function fromNullable(value, error) {
  return value === null || value === undefined ? err(error) : ok(value);
}
