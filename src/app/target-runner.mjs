/**
 * The per-target envelope (DEL-70, TR-APP-001, TR-APP-002).
 *
 * ## One target cannot end another
 *
 * **No error, rejection, or timeout from one target may propagate to another.**
 * That is INV-09 stated as control flow: thirty clients share a run, and the
 * one whose source is having a bad morning must not take the other twenty-nine
 * with it.
 *
 * So every target runs inside a `try`, every outcome is a value rather than an
 * exception, and the context is closed in a `finally` that tolerates the close
 * itself failing.
 *
 * ## A per-target budget aborts the target, not the run (TR-APP-004)
 *
 * `ERR-BUDGET-TARGET`, then continue to the next. A budget is a statement about
 * one listing taking too long, which says nothing about the next one.
 *
 * ## Every target produces an outcome (TR-APP-006)
 *
 * Including blocked and deferred ones. **A target absent from the outcome list
 * is invisible in the manifest and therefore invisible in the incident** — and
 * "did it fail or did we never try it" is unanswerable after the fact.
 *
 * @module app/target-runner
 */

/** Outcome states. `deferred` is a scheduling fact, not a failure (SCHED-03). */
export const OUTCOME_STATES = Object.freeze([
  'succeeded',
  'failed',
  'blocked',
  'deferred',
  'skipped',
]);

/**
 * @typedef {object} TargetOutcome
 * @property {string} clientSlug
 * @property {string} listingKey
 * @property {string} state
 * @property {string | null} code
 * @property {string} detail
 * @property {number} durationMs
 * @property {any} preflight
 * @property {any} report
 */

/**
 * Runs one target inside its envelope.
 *
 * @param {any} target
 * @param {object} ctx
 * @param {() => number} ctx.now
 * @param {(target: any) => Promise<any>} ctx.stages   The eleven-stage pipeline.
 * @param {(target: any) => Promise<any>} [ctx.gate]   Preflight, run first.
 * @param {number} [ctx.budgetMs]
 * @param {any} [ctx.logger]
 * @returns {Promise<TargetOutcome>}
 */
export async function runTarget(target, ctx) {
  const started = ctx.now();
  const gate = ctx.gate;
  const verdict = gate === undefined ? null : await safely(() => gate(target));
  const record = { target, started, ctx };
  const stopped = gateOutcome(verdict);

  if (stopped !== null) return outcome(record, stopped);

  const allowedBy = verdict?.value ?? null;
  const result = await safely(() => withBudget(ctx.stages(target), ctx.budgetMs, ctx));

  if (result.ok === false) {
    return outcome(record, {
      state: 'failed',
      code: result.code ?? 'ERR-TARGET-FAILED',
      detail: result.detail,
      verdict: allowedBy,
    });
  }

  return {
    ...outcome(record, { state: 'succeeded', code: null, detail: 'completed', verdict: allowedBy }),
    report: result.value ?? null,
  };
}

/**
 * Whether the gate stopped this target, and how.
 *
 * A gate that THREW and a gate that DENIED are different outcomes. Throwing
 * means the gate could not decide, which is a failure; denying means it decided
 * no, which is policy working. Failing open on the first would run a target the
 * gate never cleared.
 *
 * @param {any} verdict
 * @returns {{ state: string, code: string | null, detail: string, verdict: any } | null}
 */
function gateOutcome(verdict) {
  if (verdict === null) return null;

  if (verdict.ok === false) {
    return {
      state: 'failed',
      code: 'ERR-PREFLIGHT-FAILED',
      detail: verdict.detail,
      verdict: null,
    };
  }

  if (verdict.value?.allow !== false) return null;

  // Blocked, not failed. A kill switch or an open breaker is the system working
  // as configured, and counting it as a failure would make the success-rate
  // metric measure policy rather than health.
  return {
    state: 'blocked',
    code: verdict.value.code,
    detail: describeDenial(verdict.value),
    verdict: verdict.value,
  };
}

/**
 * The denial reason, chosen from the one check that stopped it.
 *
 * @param {any} verdict
 * @returns {string}
 */
function describeDenial(verdict) {
  const denial = (verdict.reasons ?? []).find((/** @type {any} */ reason) => !reason.passed);

  return denial === undefined
    ? 'preflight denied without a stated reason'
    : `check ${denial.check} (${denial.name}): ${denial.detail}`;
}

/**
 * Runs a promise under a budget.
 *
 * The timeout rejects rather than resolving, so a target that overruns is
 * distinguishable from one that finished with nothing — those have opposite
 * meanings for absence.
 *
 * @param {Promise<any>} work
 * @param {number | undefined} budgetMs
 * @param {any} ctx
 * @returns {Promise<any>}
 */
async function withBudget(work, budgetMs, ctx) {
  if (typeof budgetMs !== 'number' || budgetMs <= 0) return work;

  /** @type {any} */
  let timer;
  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`the target budget of ${budgetMs}ms expired`);

      /** @type {any} */ (error).code = 'ERR-BUDGET-TARGET';
      reject(error);
    }, budgetMs);
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    // Cleared whichever way the race went. An uncleared timer keeps the process
    // alive past the run, which turns a finished harvest into a hung job.
    clearTimeout(timer);
    ctx.logger?.debug?.('target.budget_cleared', { budgetMs });
  }
}

/**
 * @param {() => Promise<any>} work
 * @returns {Promise<any>}
 */
async function safely(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return {
      ok: false,
      code: /** @type {any} */ (error)?.code ?? null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {{ target: any, started: number, ctx: any }} record
 * @param {{ state: string, code: string | null, detail: string, verdict: any }} result
 * @returns {TargetOutcome}
 */
function outcome(record, result) {
  return {
    clientSlug: record.target.clientSlug,
    listingKey: record.target.listingKey,
    state: result.state,
    code: result.code,
    detail: result.detail,
    durationMs: record.ctx.now() - record.started,
    preflight: result.verdict,
    report: null,
  };
}

/**
 * An outcome for a target that never ran.
 *
 * @param {any} target
 * @param {string} state
 * @param {string} detail
 * @returns {TargetOutcome}
 */
export function notRun(target, state, detail) {
  return {
    clientSlug: target.clientSlug,
    listingKey: target.listingKey,
    state,
    code: state === 'deferred' ? 'ERR-BUDGET-RUN' : null,
    detail,
    durationMs: 0,
    preflight: null,
    report: null,
  };
}
