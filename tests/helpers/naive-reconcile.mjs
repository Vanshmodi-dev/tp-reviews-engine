/**
 * Deliberately-wrong reconcilers, and the generators that expose them.
 *
 * **These exist so the property laws have something to be red against.**
 *
 * The plan requires PT-01, PT-02 and PT-07 to be written as failing tests
 * before any implementation (ID-13, LEDG-02). A pure no-op — which is what
 * `core/reconcile/index.mjs` currently is — satisfies every one of those laws
 * vacuously: it is trivially idempotent, trivially commutative, and trivially
 * changes nothing on a partial harvest. Testing a law against a no-op proves
 * nothing at all.
 *
 * So each law is asserted twice: it passes against the real (scaffolded)
 * reconciler, and it **rejects** the corresponding naive implementation below.
 * The naive versions are not strawmen — each is the specific simplification the
 * documents warn about by name, written the way it would actually be written.
 *
 * Nothing here is production code and nothing here is imported by `src/`.
 *
 * @module tests/helpers/naive-reconcile
 */

import { absenceIsMeaningful } from '../../src/core/model/review.mjs';

/**
 * @typedef {object} NaiveInput
 * @property {Map<string, any>} prior
 * @property {ReadonlyArray<any>} observed
 * @property {string} completeness
 * @property {number} removalConfirmations
 * @property {string} now
 */

/**
 * A correct-enough reference reconciler, used as the control.
 *
 * This is NOT the implementation — T-109 writes that, and this deliberately
 * omits suppression, near-duplicate collapse, revision history, and the
 * decision log. It exists so the laws can be shown to *pass* for something,
 * which is what distinguishes "this law is meaningful" from "this law is
 * unsatisfiable".
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function referenceReconcile({ prior, observed, completeness, removalConfirmations, now }) {
  const next = new Map(prior);
  const seen = applyObserved(next, observed, now);

  applyAbsent(next, seen, { completeness, removalConfirmations, now });

  return next;
}

/**
 * The observed half. Split out so neither pass exceeds the complexity limit.
 *
 * @param {Map<string, any>} next
 * @param {ReadonlyArray<any>} observed
 * @param {string} now
 * @returns {Set<string>} The identities this harvest saw.
 */
function applyObserved(next, observed, now) {
  const seen = new Set();

  for (const review of observed) {
    const id = review.identity_hash;
    seen.add(id);
    const existing = next.get(id);

    if (existing !== undefined && isTerminal(existing)) continue;

    next.set(id, {
      identity_hash: id,
      content_hash: review.content_hash,
      state: 'active',
      first_seen_at: existing?.first_seen_at ?? now,
      last_seen_at: now,
      missing_streak: 0,
      tombstoned_at: null,
    });
  }

  return seen;
}

/**
 * The absent half, and the only place the asymmetry lives.
 *
 * @param {Map<string, any>} next
 * @param {ReadonlySet<string>} seen
 * @param {{ completeness: string, removalConfirmations: number, now: string }} policy
 * @returns {void}
 */
function applyAbsent(next, seen, { completeness, removalConfirmations, now }) {
  // THE ASYMMETRY. Absence is only evidence when the harvest actually looked.
  if (!absenceIsMeaningful(completeness)) return;

  for (const [id, record] of next) {
    if (seen.has(id) || isTerminal(record)) continue;

    const streak = record.missing_streak + 1;
    const reached = streak >= removalConfirmations;

    next.set(id, {
      ...record,
      missing_streak: streak,
      state: reached ? 'tombstoned' : 'unconfirmed',
      tombstoned_at: reached ? now : null,
    });
  }
}

/**
 * NAIVE #1 — treats absence uniformly.
 *
 * The exact simplification TRD §22.5's Agent Note names: the completeness check
 * looks like redundant branching, so it is removed. Every other line is
 * identical to the reference.
 *
 * The consequence is not a wrong number. It is that one stalled page load
 * begins a countdown, and three harvests later a paying client's entire review
 * set is gone, with no error anywhere in the logs.
 *
 * **PT-07 must reject this.**
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function naiveUniformAbsence(input) {
  return referenceReconcile({ ...input, completeness: 'full' });
}

/**
 * NAIVE #2 — order-dependent, because it keeps the LAST observation of a
 * duplicated identity rather than resolving by a total ordering.
 *
 * Plausible: "later wins" is a normal merge rule. But upstream ordering is
 * unstable and personalised, so the same harvest in a different order produces
 * a different ledger — and every run then writes a payload, forever.
 *
 * **PT-02 must reject this.**
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function naiveOrderDependent(input) {
  const next = new Map(input.prior);

  for (const review of input.observed) {
    next.set(review.identity_hash, {
      identity_hash: review.identity_hash,
      content_hash: review.content_hash,
      state: 'active',
      // Last write wins, including for first_seen_at - so the result depends
      // on the order the source happened to render.
      first_seen_at: input.now,
      last_seen_at: input.now,
      missing_streak: 0,
      tombstoned_at: null,
      order_marker: review.order_marker,
    });
  }

  return next;
}

/**
 * NAIVE #3 — non-idempotent, because it increments a counter on every pass
 * rather than deriving state from the observation.
 *
 * Plausible: "count how many times we have seen this" is a reasonable-sounding
 * field. But re-running a crashed shard then double-counts, so a retry is no
 * longer safe — and retry safety is the entire reason PT-01 exists.
 *
 * **PT-01 must reject this.**
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function naiveNonIdempotent(input) {
  const next = new Map(input.prior);

  for (const review of input.observed) {
    const existing = next.get(review.identity_hash);
    next.set(review.identity_hash, {
      identity_hash: review.identity_hash,
      content_hash: review.content_hash,
      state: 'active',
      first_seen_at: existing?.first_seen_at ?? input.now,
      last_seen_at: input.now,
      missing_streak: 0,
      tombstoned_at: null,
      observation_count: (existing?.observation_count ?? 0) + 1,
    });
  }

  return next;
}

/**
 * NAIVE #4 — resurrects tombstones, because it treats "observed" as sufficient
 * grounds to be active.
 *
 * Plausible: the review is right there on the page. But a tombstone may record
 * an erasure request, and resurrecting it is a compliance failure rather than a
 * data-freshness improvement.
 *
 * **PT-03 must reject this.**
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function naiveResurrects(input) {
  const next = new Map(input.prior);

  for (const review of input.observed) {
    next.set(review.identity_hash, {
      ...(next.get(review.identity_hash) ?? {}),
      identity_hash: review.identity_hash,
      content_hash: review.content_hash,
      // No terminal check at all.
      state: 'active',
      last_seen_at: input.now,
      missing_streak: 0,
      tombstoned_at: null,
    });
  }

  return next;
}

/**
 * @param {any} record
 * @returns {boolean}
 */
export function isTerminal(record) {
  return record?.state === 'tombstoned' || record?.state === 'suppressed';
}

/**
 * A comparable snapshot of a ledger map, independent of insertion order.
 *
 * Property laws compare ledgers, and a Map compares by identity. Sorting by key
 * and serialising is what makes "identical ledger" a checkable claim.
 *
 * @param {Map<string, any>} ledger
 * @returns {string}
 */
export function snapshot(ledger) {
  const entries = [...ledger.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, record]) => [
      key,
      {
        content_hash: record.content_hash ?? null,
        state: record.state ?? null,
        first_seen_at: record.first_seen_at ?? null,
        last_seen_at: record.last_seen_at ?? null,
        missing_streak: record.missing_streak ?? null,
        tombstoned_at: record.tombstoned_at ?? null,
      },
    ]);

  return JSON.stringify(entries);
}
