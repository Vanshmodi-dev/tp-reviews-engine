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

  for (const review of collapseDuplicates(observed)) {
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
 * Collapses intra-run duplicates by a TOTAL ordering (DUP-03).
 *
 * One crawl can legitimately yield the same `identity_hash` twice with
 * different content — a paginated list re-renders while it is being read. The
 * survivor MUST be chosen by comparing the records themselves, never by which
 * one the iteration happened to reach last, because upstream ordering is
 * unstable and personalised. "Last write wins" is the natural implementation
 * and it is the one that breaks PT-02.
 *
 * The ordering here is lexicographic on `content_hash`. Any total order works;
 * what matters is that it reads only the records' own values. Two entries that
 * compare equal are identical in every field this reconciler copies, so which
 * of them survives is unobservable.
 *
 * @param {ReadonlyArray<any>} observed
 * @returns {any[]}
 */
function collapseDuplicates(observed) {
  const winners = new Map();

  for (const review of observed) {
    const held = winners.get(review.identity_hash);

    if (held === undefined || String(review.content_hash) < String(held.content_hash)) {
      winners.set(review.identity_hash, review);
    }
  }

  return [...winners.values()].sort((a, b) =>
    a.identity_hash < b.identity_hash ? -1 : a.identity_hash > b.identity_hash ? 1 : 0,
  );
}

/**
 * The absent half, and the only place the asymmetry lives.
 *
 * ## Why this half needs an idempotence guard and the observed half does not
 *
 * PT-01 states `reconcile(reconcile(L,H),H) ≡ reconcile(L,H)` for fixed `now`.
 * Every field the observed half writes satisfies that for free, because each is
 * either derived from the incoming review or explicitly preserved from the
 * existing record — re-applying computes the same value again.
 *
 * `missing_streak` is the one exception. It is the only field defined by
 * *accumulation* rather than by the observation, so a second application of the
 * same harvest counts the same absence twice: a record absent from one `full`
 * harvest reaches streak 1, then 2, and with `removal_confirmations` at 3 a
 * doubly-applied harvest is two thirds of the way to a tombstone that one
 * application would never have reached.
 *
 * That is not a hypothetical. Idempotence exists precisely so a shard that
 * crashes after reconciling but before committing can re-run, and the crash-then
 * -retry path is exactly the path that would double-count.
 *
 * So counting an absence must be guarded by "this record has already been
 * evaluated against this harvest". `last_absence_eval_at` is how this reference
 * does it. **It is not a mandated field.** T-109 may satisfy the law any way it
 * likes, and the `Ledger` already carries `last_full_harvest_at`, which under a
 * fixed `now` answers the same question without a schema change. The law
 * constrains only that some guard exists.
 *
 * `naiveUnguardedAbsence` is this function without the guard, and PT-01 rejects
 * it.
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

    // THE IDEMPOTENCE GUARD (PT-01). See the note below on why counting an
    // absence needs one and observing a review does not.
    if (record.last_absence_eval_at === now) continue;

    const streak = record.missing_streak + 1;
    const reached = streak >= removalConfirmations;

    next.set(id, {
      ...record,
      missing_streak: streak,
      state: reached ? 'tombstoned' : 'unconfirmed',
      tombstoned_at: reached ? now : null,
      last_absence_eval_at: now,
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
 * NAIVE #5 — counts an absence again every time the same harvest is applied.
 *
 * This one is different in kind from the four above: it is not a simplification
 * somebody might make, it is **the reference implementation with one guard
 * removed**, and it is what you get by writing the streak logic the obvious way.
 * Absence accumulates, so re-applying accumulates again.
 *
 * The damage is bounded but real. A shard that crashes between reconciling and
 * committing re-runs, and each replay advances every absent record's streak.
 * With `removal_confirmations` at 3, two replays of one `full` harvest tombstone
 * records that a single application would have left merely `unconfirmed` —
 * reviews pulled from a client's site because a job was retried.
 *
 * **PT-01 must reject this.**
 *
 * @param {NaiveInput} input
 * @returns {Map<string, any>}
 */
export function naiveUnguardedAbsence({
  prior,
  observed,
  completeness,
  removalConfirmations,
  now,
}) {
  const next = new Map(prior);
  const seen = applyObserved(next, observed, now);

  // The asymmetry is still here - this is NOT the PT-07 counterexample. The
  // difference from `applyAbsent` is exactly one line, and it is the missing
  // one: there is no `last_absence_eval_at` check and no marker written.
  if (!absenceIsMeaningful(completeness)) return next;

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
    .map(([key, record]) => [key, sortedFields(record)]);

  return JSON.stringify(entries);
}

/**
 * Every own field of a record, in key order.
 *
 * Deliberately total rather than an allowlist. An allowlist decides in advance
 * which fields a wrong implementation is allowed to be wrong about, and every
 * field outside it becomes invisible to every law that compares snapshots —
 * `naiveNonIdempotent` differs from the reference only in a field an allowlist
 * would not have thought to include, and PT-01 would have passed against it.
 *
 * Key order is normalised because two records with the same fields written in a
 * different order are the same record, and `JSON.stringify` does not know that.
 *
 * @param {Record<string, any>} record
 * @returns {Record<string, any>}
 */
function sortedFields(record) {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}
