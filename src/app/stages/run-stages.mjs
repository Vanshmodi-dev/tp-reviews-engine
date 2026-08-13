/**
 * Stages 1–10, composed (TRD §1.3).
 *
 * `runTarget` owns stage 0 (preflight) and the failure envelope. This is
 * everything after it, in order, with no stage reaching forward to a later
 * stage's data.
 *
 * ## What this file is, and is not
 *
 * It is **wiring**. Every decision it appears to make was made somewhere else
 * and is tested there: what counts as complete, whether a record is
 * publishable, whether bytes may be written. This file's job is to call those
 * in the right order with the right inputs, and to stop when one of them says
 * stop.
 *
 * That is why it is short and why it has almost no branches. A pipeline that
 * accumulates its own judgement is one where the reconciler's guarantees stop
 * being the system's guarantees.
 *
 * ## Stage ordering is a safety property, not a style
 *
 * Two orderings in particular are load-bearing:
 *
 * - **Gate before publish, always.** Stage 9 is the decision point. There is no
 *   path from stage 8 to stage 10 that does not pass through it.
 * - **Reconcile before project.** The projection is derived from the ledger,
 *   never from the harvest. Projecting the harvest directly would publish
 *   exactly what was seen this run — which is INV-03 inverted, and it would
 *   delete a client's history the first time a source paginated badly.
 *
 * @module app/stages/run-stages
 */

// Through the barrel, never past it (DR-6).
//
// `GATE_REJECT` is the gate's own constant, aliased on the barrel. It is not
// the string 'reject': this file first shipped comparing against a literal,
// and because the gate returns 'REJECT' the comparison was silently false —
// the gate rejected and the pipeline published anyway, bypassing the single
// most important control in the system. A literal cannot be spelled wrong
// loudly; an imported constant can.
import {
  GATE_REJECT,
  classifyCompleteness,
  computeCoverage,
  computeQuarantineRate,
  createLedger,
  evaluateGate,
  projectArtifacts,
  reconcile,
} from '../../core/index.mjs';
import { normaliseRecords } from './normalize-records.mjs';

/** Consecutive qualifying harvests before a missing review is tombstoned. */
const DEFAULT_REMOVAL_CONFIRMATIONS = 2;

/** Similarity at or above which two records are treated as the same review. */
const DEFAULT_NEAR_DUPLICATE = 0.92;

/**
 * @param {string} code
 * @param {string} detail
 * @returns {Error}
 */
function stageError(code, detail) {
  const error = new Error(detail);

  /** @type {any} */ (error).code = code;

  return error;
}

/**
 * Builds the pipeline.
 *
 * Ports in, function out. `app/` names no concrete adapter (DR-4) — the
 * resolver, acquirer, state and publisher all arrive from the composition root.
 *
 * @param {object} deps
 * @param {{ resolve: (input: any) => Promise<any> }} deps.resolver
 * @param {(input: any) => Promise<any>} deps.acquire  Stage 2, from the adapter registry.
 * @param {{ readLedger: (key: string) => Promise<any>, writeLedger: (key: string, ledger: any) => Promise<any> }} deps.state
 * @param {{ read: (path: string) => Promise<any>, publish: (input: any) => Promise<any> }} deps.publisher
 * @param {{ enrich: (reviews: ReadonlyArray<any>) => Promise<any> }} [deps.enricher]
 * @param {() => number} deps.now
 * @param {ReadonlySet<string>} [deps.denylist]  Compliance suppressions, from `main`.
 * @param {any} [deps.engine]
 * @param {any} [deps.logger]
 * @returns {(target: any) => Promise<any>}
 */
export function createRunStages(deps) {
  const logger = deps.logger ?? { info: () => {}, warn: () => {} };

  return async function runStages(target) {
    const ctx = {
      target,
      deps,
      logger,
      observedAtMs: deps.now(),
      config: target.config ?? {},
      listing: target.listing ?? {},
    };

    const identity = await stageResolve(ctx);
    const harvest = await stageAcquire(ctx, identity);
    const normalised = stageNormalise(ctx, identity, harvest);
    const report = buildReport({ harvest, identity, normalised });
    const ledger = await stageReconcile(ctx, normalised, report);
    const artifacts = await stageProject(ctx, ledger, harvest, report);

    return stagePublish(ctx, { ledger, artifacts, report });
  };
}

/**
 * Stage 1 · Resolve.
 *
 * @param {any} ctx
 * @returns {Promise<any>}
 */
async function stageResolve(ctx) {
  const resolved = await ctx.deps.resolver.resolve({
    listing: ctx.listing,
    config: ctx.config,
    clientSlug: ctx.target.clientSlug,
  });

  if (resolved.ok === false) throw stageError(resolved.error.code, resolved.error.message);

  return resolved.value;
}

/**
 * Stage 2 · Acquire.
 *
 * @param {any} ctx
 * @param {any} identity
 * @returns {Promise<any>}
 */
async function stageAcquire(ctx, identity) {
  const acquired = await ctx.deps.acquire({
    listing: { ...ctx.listing, ...identity },
    targetCount: ctx.config.max_reviews ?? identity.advertisedTotal ?? 0,
    cap: ctx.config.max_reviews ?? Number.POSITIVE_INFINITY,
    budget: ctx.target.budget ?? {},
    secrets: ctx.target.secrets ?? {},
  });

  if (acquired.ok === false) throw stageError(acquired.error.code, acquired.error.message);

  return acquired.value;
}

/**
 * Stages 3–4 · Extract, Normalize.
 *
 * Stage 3 lives inside the adapter, against a serialised subtree; what arrives
 * here is already per-review. Stage 4 turns those into ledger records:
 * sanitised, dated, hashed.
 *
 * @param {any} ctx
 * @param {any} identity
 * @param {any} harvest
 * @returns {any}
 */
function stageNormalise(ctx, identity, harvest) {
  return normaliseRecords(harvest.reviews ?? [], {
    listingKey: ctx.target.listingKey,
    source: identity.source ?? ctx.listing.source ?? 'google',
    observedAtMs: ctx.observedAtMs,
    locale: ctx.config.locale ?? 'en',
  });
}

/**
 * Stage 6 · Reconcile.
 *
 * @param {any} ctx
 * @param {any} normalised
 * @param {any} report
 * @returns {Promise<any>}
 */
async function stageReconcile(ctx, normalised, report) {
  const now = new Date(ctx.observedAtMs).toISOString();

  // A first run has no ledger, and `reconcile` requires one — an EMPTY ledger,
  // not `null`. The distinction matters: an empty ledger says "this listing has
  // no history", which is true and lets every absence rule apply normally.
  // `null` would mean "we could not read the history", which is the state
  // INV-04 says must never be treated as evidence of removal.
  const prior =
    (await ctx.deps.state.readLedger(ctx.target.listingKey)) ??
    createLedger({ clientSlug: ctx.target.clientSlug, listingKey: ctx.target.listingKey, now });

  const outcome = reconcile({
    prior,
    observed: normalised.records,
    report,
    config: reconcileConfig(ctx.config, ctx.deps.denylist),
    now,
  });

  if (outcome.invariantViolations.length > 0) {
    // The engine produced a state its own rules forbid. Publishing it would
    // write that state to a client's site.
    throw stageError('ERR-INTERNAL-INVARIANT', outcome.invariantViolations.join('; '));
  }

  return outcome.ledger;
}

/**
 * Stages 7–8 · Enrich, Project.
 *
 * @param {any} ctx
 * @param {any} ledger
 * @param {any} harvest
 * @param {any} report
 * @returns {Promise<any>}
 */
async function stageProject(ctx, ledger, harvest, report) {
  // Stage 7 is optional and never fatal (TRD §1.3). It produces annotations,
  // and the projection below is built from the LEDGER either way.
  if (ctx.deps.enricher) await ctx.deps.enricher.enrich(publishable(ledger));

  return projectArtifacts({
    ledger,
    config: ctx.config,
    meta: { ...(ctx.deps.engine ?? {}), adapter: harvest.adapter_id, report },
    generatedAt: new Date(ctx.observedAtMs).toISOString(),
  });
}

/**
 * Stages 9–10 · Gate, Publish.
 *
 * The gate is the only route to publication. There is no path from stage 8 to
 * stage 10 that does not pass through it.
 *
 * @param {any} ctx
 * @param {any} input
 * @returns {Promise<any>}
 */
async function stagePublish(ctx, { ledger, artifacts, report }) {
  const current = await ctx.deps.publisher.read(ctx.target.listingKey);
  const verdict = evaluateGate({
    candidate: artifacts.reviews.payload ?? artifacts.reviews,
    prior: current ?? null,
    validation: report,
    thresholds: ctx.config.gate ?? {},
    ...(ctx.config.force === undefined ? {} : { force: ctx.config.force }),
  });

  if (verdict.decision === GATE_REJECT) {
    // Not an error. The gate deciding no is the gate working, and it is exit
    // code 5 — a CI success (EDR-030). The ledger is deliberately NOT written:
    // advancing it past a rejected publish would make the next run compare
    // against state that was never published, and the gate would then see no
    // change and let the bad payload through.
    return { published: false, verdict, report, artifacts };
  }

  const published = await ctx.deps.publisher.publish({
    listingKey: ctx.target.listingKey,
    clientSlug: ctx.target.clientSlug,
    artifacts,
  });

  await ctx.deps.state.writeLedger(ctx.target.listingKey, ledger);

  ctx.logger.info('target published', {
    client: ctx.target.clientSlug,
    listing: ctx.target.listingKey,
    changed: published?.changed ?? null,
  });

  return { published: true, verdict, report, artifacts, publish: published };
}

/**
 * The reconciler's config, with its four required fields present.
 *
 * `denylist` is the compliance suppression set, and it arrives from `main`
 * rather than from the ledger — a suppression that lived only in `state` would
 * be resurrected by the documented rebuild procedure, turning a recoverable
 * incident into a compliance breach (`compliance/README.md`).
 *
 * An **empty Set** is the correct default, not `undefined`: the reconciler asks
 * it whether each identity is suppressed, and a missing set is a crash rather
 * than a permissive answer. Defaulting to empty keeps "nothing is suppressed"
 * distinct from "we could not read the suppressions" — the latter should never
 * silently become the former.
 *
 * `keepTombstones` defaults to true: a tombstone that is dropped lets a
 * previously-removed review reappear on the next harvest (PT-03).
 *
 * @param {any} config
 * @param {ReadonlySet<string> | undefined} denylist
 * @returns {any}
 */
function reconcileConfig(config, denylist) {
  const declared = config.reconcile ?? {};

  return {
    removalConfirmations: declared.removalConfirmations ?? DEFAULT_REMOVAL_CONFIRMATIONS,
    nearDuplicateThreshold: declared.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE,
    keepTombstones: declared.keepTombstones ?? true,
    denylist: denylist ?? new Set(),
  };
}

/**
 * Stage 5 · the validation report.
 *
 * Completeness comes from the navigator's STOP REASON, never from counts
 * (VAL-01). A harvest that stopped because it hit our own cap is `full_capped`
 * however many reviews it returned; one that stalled is `partial` even if the
 * count happens to match the advertised total.
 *
 * @param {{ harvest: any, identity: any, normalised: any }} input
 * @returns {any}
 */
function buildReport({ harvest, identity, normalised }) {
  const advertised = harvest.advertised_total ?? identity.advertisedTotal ?? null;

  return {
    stop_reason: harvest.stop_reason,
    // Takes the REPORT, not the reason string. Passing the string returns
    // `failed` — the fail-closed default for an unrecognised reason — which is
    // correct behaviour and an invisible bug at the call site, because a
    // completeness of `failed` looks like a bad harvest rather than a bad call.
    harvest_completeness: classifyCompleteness({ stop_reason: harvest.stop_reason }),
    observed_count: normalised.records.length,
    advertised_total: advertised,
    advertised_rating: harvest.advertised_rating ?? identity.advertisedRating ?? null,
    coverage: computeCoverage(normalised.records.length, advertised),
    quarantine_rate: computeQuarantineRate(
      normalised.records.length,
      normalised.quarantined.length,
    ),
    quarantined: normalised.quarantined,
    capabilities: harvest.capabilities ?? [],
    adapter: harvest.adapter_id ?? null,
    resolved_via: identity.resolvedVia ?? null,
    diagnostics: harvest.diagnostics ?? {},
  };
}

/**
 * @param {any} ledger
 * @returns {any[]}
 */
function publishable(ledger) {
  return Object.values(ledger?.reviews ?? {});
}
