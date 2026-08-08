/**
 * G-01…G-12 as **data**, not as inline conditionals (T-123, TR-GATE-003).
 *
 * Each rule is an object with an `evaluate` function that can be called on its
 * own, with nothing but a context object. That is the whole design, and it buys
 * three things a chain of `if` statements inside the gate would not:
 *
 * - **Independent testability.** GATE-02 requires every rule to have a test
 *   proving it rejects *and* a test proving it does not reject spuriously. With
 *   rules as data, that is twenty-four small tests against twelve functions,
 *   rather than twenty-four paths through one large one.
 * - **Independent configurability.** A threshold belongs to its rule.
 * - **Evaluate-all.** A list can be mapped over. A chain of conditionals invites
 *   an early return, which is exactly what EDR-023 forbids.
 *
 * ## Reading the verdicts
 *
 * `REJECT` blocks publication. `WARN` records a reason and publishes anyway.
 * Which is which is a property of the rule, not of the caller — the gate does
 * not get to decide that a rejection is really a warning, and `--force-publish`
 * can only downgrade the four rules that are explicitly overridable.
 *
 * ## Thresholds
 *
 * Every default here is from TRD §26.3. They arrive through config so a client
 * with unusual data can be tuned without a code change, but the *defaults* live
 * with the rules because a threshold with no default is a threshold somebody
 * has to guess at during onboarding.
 *
 * @module core/gate/rules
 */

/** Ratios are reported as percentages, because that is how a threshold reads. */
const PERCENT = 100;

/** Verdict a rule can return. */
export const REJECT = 'REJECT';
export const WARN = 'WARN';
export const PASS = 'PASS';

/** Defaults from TRD §26.3. */
export const GATE_DEFAULTS = Object.freeze({
  max_count_drop_ratio: 0.2,
  max_rating_shift: 0.5,
  quarantine_max: 0.05,
  coverage_min: 0.95,
  rating_tolerance: 0.3,
  max_payload_bytes: 2_097_152,
  max_duplicate_cluster: 3,
  advertised_drop_tolerance: 0.4,
});

/**
 * Everything a rule may read.
 *
 * @typedef {object} GateContext
 * @property {Record<string, any>} candidate       The payload about to be published.
 * @property {Record<string, any> | null} prior    The currently published payload, or null.
 * @property {boolean} priorReadable               False when the prior exists but could not be read.
 * @property {boolean} firstPublish                True only when there genuinely is no prior.
 * @property {any} validation                      The `ValidationReport`.
 * @property {any} thresholds                      Resolved thresholds.
 * @property {number} candidateBytes               Serialised size of the candidate.
 * @property {ReadonlyArray<string>} schemaErrors  Empty when the candidate validates.
 * @property {ReadonlyArray<any>} nearDuplicates   From reconciliation.
 */

/**
 * @param {string} verdict
 * @param {string} detail
 * @param {unknown} [observed]
 * @param {unknown} [threshold]
 * @returns {{ verdict: string, detail: string, observed?: unknown, threshold?: unknown }}
 */
function result(verdict, detail, observed, threshold) {
  return { verdict, detail, observed, threshold };
}

/** @param {string} detail @returns {any} */
const pass = (detail = 'ok') => result(PASS, detail);

/**
 * Rules that compare against the prior payload, and are therefore skipped on a
 * genuine first publish (TRD §26.4).
 */
const CHANGE_BASED = Object.freeze(['G-02', 'G-03', 'G-04', 'G-05', 'G-12']);

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isChangeBased(id) {
  return CHANGE_BASED.includes(id);
}

/**
 * The twelve rules.
 *
 * `overridable` mirrors SAD §26.8 and TRD §26.8: `--force-publish` downgrades
 * G-03, G-04, G-05 and G-12 to warnings, and nothing else. G-01, G-02, G-06 and
 * G-07 indicate a defect or genuine corruption rather than a disagreement about
 * a threshold, so no operator intent can wave them through.
 */
export const RULES = Object.freeze([
  Object.freeze({
    id: 'G-01',
    statement: 'Candidate validates against the payload schema',
    errorClass: 'ERR-GATE-REJECT-SCHEMA',
    overridable: false,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) =>
      ctx.schemaErrors.length === 0
        ? pass()
        : result(REJECT, `candidate is schema-invalid: ${ctx.schemaErrors.join('; ')}`),
  }),

  Object.freeze({
    id: 'G-02',
    statement: 'Candidate non-empty when the prior payload was non-empty',
    errorClass: 'ERR-GATE-REJECT-EMPTY',
    overridable: false,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const priorCount = ctx.prior?.stats?.total_count ?? 0;
      const count = ctx.candidate.stats.total_count;

      // Empty-over-empty is fine; empty-over-populated is the catastrophe. A
      // client's page going from 180 reviews to a blank section is the most
      // visible failure this system can produce.
      if (count > 0 || priorCount === 0) return pass();

      return result(REJECT, 'candidate is empty but the prior payload was not', count, priorCount);
    },
  }),

  Object.freeze({
    id: 'G-03',
    statement: 'Count has not dropped by more than max_count_drop_ratio',
    errorClass: 'ERR-GATE-REJECT-COUNT-DROP',
    overridable: true,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const priorCount = ctx.prior?.stats?.total_count ?? 0;
      if (priorCount === 0) return pass('no prior count to compare');

      const count = ctx.candidate.stats.total_count;
      const drop = (priorCount - count) / priorCount;
      const limit = ctx.thresholds.max_count_drop_ratio;

      return drop > limit
        ? result(REJECT, `count dropped ${formatRatio(drop)} of ${priorCount}`, drop, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-04',
    statement: 'Mean rating has not shifted by more than max_rating_shift',
    errorClass: 'ERR-GATE-REJECT-RATING-SHIFT',
    overridable: true,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      // Read the stats block once. Reaching through `ctx.prior?.stats?.` twice
      // needs a `?? 0` on the second reach, and that fallback is only reachable
      // in a state the payload schema forbids - a prior with a mean rating but
      // no count. An unreachable branch is an untestable one.
      const priorStats = ctx.prior?.stats;
      const priorMean = priorStats?.mean_rating;

      if (typeof priorMean !== 'number') return pass('no prior mean to compare');
      if (priorStats.total_count === 0) return pass('prior published nothing to average');

      const shift = Math.abs(ctx.candidate.stats.mean_rating - priorMean);
      const limit = ctx.thresholds.max_rating_shift;

      return shift > limit
        ? result(REJECT, `mean rating shifted by ${shift.toFixed(2)}`, shift, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-05',
    statement: 'If completeness is partial, count must not have dropped at all',
    errorClass: 'ERR-GATE-REJECT-COVERAGE',
    overridable: true,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      // THE RULE CH-04 EXISTS TO EXERCISE, and deliberately stricter than G-03:
      // in a partial harvest absence carries no information at all, so ANY drop
      // is untrustworthy rather than merely large.
      if (ctx.candidate.stats.completeness !== 'partial') return pass('harvest was not partial');

      const priorCount = ctx.prior?.stats?.total_count ?? 0;
      const count = ctx.candidate.stats.total_count;

      return count < priorCount
        ? result(
            REJECT,
            `count dropped from ${priorCount} to ${count} on a partial harvest`,
            count,
            priorCount,
          )
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-06',
    statement: 'Quarantine rate within quarantine_max',
    errorClass: 'ERR-VALIDATE-QUARANTINE-RATE',
    overridable: false,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const rate = quarantineRate(ctx.validation);
      const limit = ctx.thresholds.quarantine_max;

      // Never overridable, and the reason is worth stating: a high quarantine
      // rate means the data is WRONG, not merely different from last time. No
      // amount of operator confidence makes malformed records publishable.
      return rate > limit
        ? result(REJECT, `quarantine rate ${formatRatio(rate)}`, rate, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-07',
    statement: 'No record-level fatal findings remain',
    errorClass: 'ERR-VALIDATE-AGGREGATE',
    overridable: false,
    warnOnly: false,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const fatal = (ctx.validation?.findings ?? []).filter(
        (/** @type {any} */ finding) => finding.severity === 'fatal',
      );

      return fatal.length > 0
        ? result(REJECT, `${fatal.length} fatal finding(s) remain`, fatal.length, 0)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-08',
    statement: 'Coverage at least coverage_min, or completeness is full_capped',
    errorClass: null,
    overridable: false,
    warnOnly: true,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const stats = ctx.candidate.stats;

      // A capped harvest legitimately did not look past our own ceiling, so its
      // coverage is low by design rather than by failure.
      if (stats.completeness === 'full_capped') return pass('capped harvest');
      if (stats.coverage === null) return pass('advertised total unknown');

      const limit = ctx.thresholds.coverage_min;

      return stats.coverage < limit
        ? result(WARN, `coverage ${formatRatio(stats.coverage)}`, stats.coverage, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-09',
    statement: 'Computed mean within rating_tolerance of advertised',
    errorClass: null,
    overridable: false,
    warnOnly: true,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const stats = ctx.candidate.stats;
      if (typeof stats.advertised_rating !== 'number') return pass('no advertised rating');
      if (stats.total_count === 0) return pass('nothing published to compare');

      const gap = Math.abs(stats.mean_rating - stats.advertised_rating);
      const limit = ctx.thresholds.rating_tolerance;

      return gap > limit
        ? result(WARN, `computed mean differs from advertised by ${gap.toFixed(2)}`, gap, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-10',
    statement: 'Payload size within budget',
    errorClass: null,
    overridable: false,
    warnOnly: true,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const limit = ctx.thresholds.max_payload_bytes;

      return ctx.candidateBytes > limit
        ? result(WARN, `payload is ${ctx.candidateBytes} bytes`, ctx.candidateBytes, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-11',
    statement: 'No near-duplicate cluster larger than three',
    errorClass: null,
    overridable: false,
    warnOnly: true,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const largest = largestCluster(ctx.nearDuplicates);
      const limit = ctx.thresholds.max_duplicate_cluster;

      return largest > limit
        ? result(WARN, `a near-duplicate cluster holds ${largest} reviews`, largest, limit)
        : pass();
    },
  }),

  Object.freeze({
    id: 'G-12',
    statement: 'advertised_total has not dropped beyond tolerance',
    errorClass: null,
    overridable: true,
    warnOnly: true,
    /** @param {GateContext} ctx */
    evaluate: (ctx) => {
      const priorAdvertised = ctx.prior?.stats?.advertised_total;
      const advertised = ctx.candidate.stats.advertised_total;

      if (typeof priorAdvertised !== 'number' || priorAdvertised <= 0)
        return pass('no prior total');
      if (typeof advertised !== 'number') return pass('no current total');

      const drop = (priorAdvertised - advertised) / priorAdvertised;
      const limit = ctx.thresholds.advertised_drop_tolerance;

      return drop > limit
        ? result(WARN, `advertised total dropped ${formatRatio(drop)}`, drop, limit)
        : pass();
    },
  }),
]);

/**
 * The quarantine rate: quarantined records over records considered.
 *
 * Zero when nothing was considered — an empty harvest has not quarantined
 * everything, it has quarantined nothing, and `0/0` would otherwise produce
 * `NaN`, which compares false against every threshold and would let the rule
 * silently pass.
 *
 * @param {any} validation
 * @returns {number}
 */
export function quarantineRate(validation) {
  const considered = validation?.considered ?? 0;
  const quarantined = validation?.quarantined ?? 0;

  return considered === 0 ? 0 : quarantined / considered;
}

/**
 * The size of the largest near-duplicate cluster.
 *
 * Pairs are transitive for this purpose: A~B and B~C means a cluster of three,
 * even if A and C were never compared directly. Counting pairs instead would
 * report "two clusters of two" for what a reader would call one group.
 *
 * @param {ReadonlyArray<any>} pairs
 * @returns {number}
 */
export function largestCluster(pairs) {
  if (pairs.length === 0) return 0;

  /** @type {Map<string, Set<string>>} */
  const adjacency = new Map();

  for (const pair of pairs) {
    link(adjacency, pair.left, pair.right);
    link(adjacency, pair.right, pair.left);
  }

  let largest = 0;
  const seen = new Set();

  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;

    largest = Math.max(largest, componentSize(adjacency, start, seen));
  }

  return largest;
}

/**
 * @param {Map<string, Set<string>>} adjacency
 * @param {string} from
 * @param {string} to
 * @returns {void}
 */
function link(adjacency, from, to) {
  const neighbours = adjacency.get(from);

  if (neighbours === undefined) adjacency.set(from, new Set([to]));
  else neighbours.add(to);
}

/**
 * Breadth-first component walk. Iterative rather than recursive: a pathological
 * cluster is bounded only by the review count, and a thousand-deep recursion
 * would overflow the stack inside a pure function that must not throw.
 *
 * @param {Map<string, Set<string>>} adjacency
 * @param {string} start
 * @param {Set<string>} seen
 * @returns {number}
 */
function componentSize(adjacency, start, seen) {
  const queue = [start];
  seen.add(start);
  let size = 0;

  while (queue.length > 0) {
    const node = /** @type {string} */ (queue.pop());
    size += 1;

    // `link` is called in both directions for every pair, so every id that can
    // reach this loop is a key in the map. The assertion states that invariant
    // rather than adding a fallback branch that cannot be taken and so cannot
    // be covered.
    const neighbours = /** @type {Set<string>} */ (adjacency.get(node));

    for (const neighbour of neighbours) {
      if (seen.has(neighbour)) continue;

      seen.add(neighbour);
      queue.push(neighbour);
    }
  }

  return size;
}

/**
 * @param {number} ratio
 * @returns {string}
 */
function formatRatio(ratio) {
  return `${(ratio * PERCENT).toFixed(1)}%`;
}

/**
 * @param {string} id
 * @returns {any}
 */
export function getRule(id) {
  return RULES.find((rule) => rule.id === id);
}
