/**
 * The public surface of the pure kernel.
 *
 * **DR-6: nothing outside `core/` may import past this file.** Not
 * `core/model/ledger.mjs`, not `core/util/hash.mjs` — this module or nothing.
 *
 * The rule exists so that the core's internal layout stays changeable. Six of
 * the eleven pipeline stages live in here and are expected to be refactored as
 * the property laws teach us things; if `app/` and the adapters reach past this
 * file, every one of those refactors becomes a cross-layer change and stops
 * happening. Enforced by the architecture test, not by convention.
 *
 * What this file is **not** is a convenience barrel. Everything re-exported
 * here is deliberately part of the contract. If something is missing, that is
 * usually the correct answer rather than an oversight — check whether the
 * caller belongs in `core/`.
 *
 * @module core
 */

// --- The Result union. The core's only error mechanism (EDR-002). ---
export {
  all,
  andThen,
  err,
  fromNullable,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  orElse,
  partition,
  unwrapOr,
  unwrapOrElse,
} from './util/result.mjs';

// --- Canonical serialisation and digests. ---
export {
  canonicalize,
  escapeForHash,
  hashObject,
  identityDigest,
  joinForHash,
  sha256Hex,
} from './util/hash.mjs';

// --- The error taxonomy. ---
export {
  BLOCKED_CODES,
  CRITICAL_CODES,
  ERROR_CLASSES,
  ERROR_CODES,
  RETRY_STRATEGIES,
  SCOPES,
  SEVERITIES as ERROR_SEVERITIES,
  getErrorClass,
  isErrorCode,
  isRetryable,
} from './model/errors.mjs';

// --- The review record and its vocabulary. ---
export {
  COMPLETENESS,
  DATE_CONFIDENCES,
  DATE_PRECISIONS,
  LEDGER_STATES,
  MAX_RATING,
  MIN_RATING,
  REVIEW_FLAGS,
  REVIEW_SOURCES,
  absenceIsMeaningful,
  isValidRating,
  markNormalised,
} from './model/review.mjs';

// --- The ledger: shape, safe mutations, invariants. ---
export {
  LEDGER_VERSION,
  OUTCOMES,
  checkLedgerInvariants,
  createLedger,
  fromJSON as ledgerFromJSON,
  insertReview,
  isTerminal,
  markMissing,
  publishableRecords,
  recordHarvest,
  suppressReview,
  toJSON as ledgerToJSON,
  touchReview,
  updateReview,
} from './model/ledger.mjs';

// --- The public payload contract. ---
export {
  ARTIFACTS,
  FORBIDDEN_PAYLOAD_FIELDS,
  NOTICES,
  SCHEMA_VERSION,
  checkStatsConsistency,
  findForbiddenFields,
  hashableProjection,
} from './model/payload.mjs';

// --- Stage reports and the Publish Gate vocabulary. ---
export {
  GATE_DECISIONS,
  GATE_RULES,
  NON_OVERRIDABLE_RULES,
  SEVERITIES as FINDING_SEVERITIES,
  STOP_REASONS,
  getGateRule,
  isNoOpHarvest,
} from './model/report.mjs';

// --- Adapter capability declaration. ---
export {
  CAPABILITIES,
  declareCapabilities,
  explainNull,
  supports as supportsCapability,
  unknownCapabilities,
} from './model/capabilities.mjs';

// --- Reconciliation: the merge, and the decisions it is composed of. ---
export { decideAbsent, decideObserved, isNoOpOutcome } from './reconcile/decide.mjs';

export {
  bucketByAuthor,
  collapseIntraRun,
  findNearDuplicates,
  isKnownIdentity,
} from './reconcile/duplicates.mjs';

export { checkRemovalPolicy, evaluateRemoval, isTerminalState } from './reconcile/removal.mjs';

export { applySuppression, buildDenylist, suppressedAmong } from './reconcile/suppress.mjs';

export { EMPTY_DECISIONS, reconcile } from './reconcile/index.mjs';

// --- Projection: ledger to the public artifact set, and the Publish Gate. ---
export {
  DISPLAY_DEFAULTS,
  applyDisplayFilters,
  canonicalise,
  compareForPublication,
  computeCoverage,
  computeStats,
  hashableBytes,
  orderForPublication,
  projectArtifacts,
  projectLatest,
  projectPayload,
  projectReview,
  projectSchemaOrg,
  projectStatsArtifact,
  resolveDisplay,
  sealArtifact,
  selectPublishable,
  serialiseLedger,
  serialisePayload,
} from './project/index.mjs';

export {
  ACCEPT,
  ACCEPT_WITH_WARNINGS,
  GATE_DEFAULTS,
  RULES as GATE_RULE_SET,
  REJECT,
  downgradedRules,
  evaluateGate,
  forceIsEffective,
} from './gate/index.mjs';

// --- Completeness: derived from the navigator's stop reason, never counts. ---
export { COMPLETENESS_VALUES, classifyCompleteness, isComplete } from './validate/completeness.mjs';
