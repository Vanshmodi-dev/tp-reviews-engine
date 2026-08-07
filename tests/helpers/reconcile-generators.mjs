/**
 * Shared arbitraries for PT-01, PT-02 and PT-03.
 *
 * The three reconciliation laws are about the *same* system, so they must be
 * about the same inputs. Three files each rolling their own ledger generator is
 * how a law ends up quietly exercising a shape the others never produce — and
 * the shapes that matter here are adversarial and easy to omit: intra-run
 * duplicates, records already part-way to a tombstone, and terminal records the
 * source keeps re-serving.
 *
 * PT-07 deliberately keeps its own generator. Its guarantee — that at least one
 * prior record is absent from every case — is the thing T-099 asks an architect
 * to review, and a shared generator would put that guarantee one edit away from
 * a law that stops being about anything.
 *
 * Nothing here is imported by `src/`.
 *
 * @module tests/helpers/reconcile-generators
 */

import fc from 'fast-check';

/** Fixed clock. Every law that mentions `now` fixes it; PT-01 requires it. */
export const NOW = '2026-03-01T00:00:00.000Z';

/** The documented default (TRD §22.5). Three confirmations before a tombstone. */
export const REMOVAL_CONFIRMATIONS = 3;

const HEX = '0123456789abcdef';

/** A 32-hex `identity_hash`, the shape `core/identity/` emits (EDR-036). */
export const identityHash = () =>
  fc.array(fc.constantFrom(...HEX), { minLength: 32, maxLength: 32 }).map((cs) => cs.join(''));

/** All four completeness values, including the two where absence means nothing. */
export const anyCompleteness = () => fc.constantFrom('full', 'full_capped', 'partial', 'failed');

/** Only the values where absence IS evidence, so the streak logic actually runs. */
export const completeHarvest = () => fc.constantFrom('full', 'full_capped');

/**
 * A prior ledger record.
 *
 * `missing_streak` tops out at 1 against a threshold of 3 deliberately. A record
 * already at 2 tombstones on its first absence and then becomes terminal, and
 * terminal records are skipped by every subsequent pass — which would make
 * PT-01's counterexample pass by accident, because the second application would
 * have nothing left to double-count.
 *
 * @param {string} id
 * @param {string} state
 * @param {number} missingStreak
 * @returns {Record<string, any>}
 */
export function makeRecord(id, state, missingStreak) {
  return {
    identity_hash: id,
    content_hash: `seed-${id.slice(0, 8)}`,
    state,
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-02-01T00:00:00.000Z',
    missing_streak: missingStreak,
    tombstoned_at: state === 'tombstoned' ? '2026-02-15T00:00:00.000Z' : null,
  };
}

/** States a record can still move out of. */
const liveState = () => fc.constantFrom('active', 'unconfirmed');

/**
 * A ledger of 2-10 records with distinct identities.
 *
 * @param {{ state?: fc.Arbitrary<string> }} [options]
 * @returns {fc.Arbitrary<Map<string, any>>}
 */
export const priorLedger = ({ state = liveState() } = {}) =>
  fc
    .uniqueArray(identityHash(), { minLength: 2, maxLength: 10 })
    .chain((ids) => fc.tuple(...ids.map((id) => recordFor(id, state))))
    .map((records) => new Map(records.map((record) => [record.identity_hash, record])));

/**
 * One generated record for a known identity.
 *
 * Built per id rather than by zipping two arrays: an index into a parallel array
 * is only correct while the two stay the same length, and nothing here would
 * notice if they stopped.
 *
 * @param {string} id
 * @param {fc.Arbitrary<string>} state
 * @returns {fc.Arbitrary<Record<string, any>>}
 */
const recordFor = (id, state) =>
  fc
    .record({ state, missing_streak: fc.integer({ min: 0, max: 1 }) })
    .map((shape) => makeRecord(id, shape.state, shape.missing_streak));

/**
 * Turns identities into the records a harvest yields.
 *
 * @param {ReadonlyArray<string>} ids
 * @param {string} [tag]
 * @returns {any[]}
 */
export function observationsFrom(ids, tag = '0') {
  return ids.map((id, index) => ({
    identity_hash: id,
    content_hash: `c-${id.slice(0, 6)}-${tag}`,
    order_marker: index,
  }));
}

/**
 * What one harvest observed: some of the prior ledger, some brand-new
 * identities, and some intra-run duplicates.
 *
 * ## The duplicates are the point
 *
 * At most `prior.size - 1` prior identities are drawn, so there is always at
 * least one absent record and the absence path is never skipped.
 *
 * The duplicated entries carry the **same identity with different content**,
 * which is what one crawl genuinely produces when a paginated list re-renders
 * while it is being read. Without them PT-02 is untestable: with unique
 * identities, even a last-write-wins reconciler is commutative, because each
 * identity is written exactly once. The duplicates are the only thing that makes
 * "chosen by a total ordering" (DUP-03) distinguishable from "chosen by
 * iteration order".
 *
 * `order_marker` records the position each entry arrived in. Nothing correct
 * reads it — the reference builds its records field by field and never copies it
 * — so if it turns up in a result, the result depends on input order.
 *
 * @param {Map<string, any>} prior
 * @returns {fc.Arbitrary<any[]>}
 */
export const observationOf = (prior) =>
  fc
    .tuple(
      fc.subarray([...prior.keys()], { maxLength: Math.max(0, prior.size - 1) }),
      fc.uniqueArray(identityHash(), { maxLength: 3 }),
      fc.array(fc.constantFrom('x', 'y', 'z'), { maxLength: 2 }),
    )
    .map(([knownIds, newIds, duplicateTags]) => {
      const base = observationsFrom([...knownIds, ...newIds]);

      return [...base, ...duplicatesOf(base, duplicateTags)];
    });

/**
 * @param {ReadonlyArray<any>} base
 * @param {ReadonlyArray<string>} tags
 * @returns {any[]}
 */
function duplicatesOf(base, tags) {
  if (base.length === 0) return [];

  return tags.map((tag, index) => {
    const target = base[index % base.length];

    return {
      identity_hash: target.identity_hash,
      content_hash: `c-${target.identity_hash.slice(0, 6)}-${tag}`,
      order_marker: base.length + index,
    };
  });
}

/**
 * A complete `NaiveInput`: ledger, harvest, completeness, policy and clock.
 *
 * Spreadable straight into any of the reconcilers in `naive-reconcile.mjs`.
 *
 * @param {{ completeness?: fc.Arbitrary<string> }} [options]
 * @returns {fc.Arbitrary<any>}
 */
export const ledgerAndHarvest = ({ completeness = anyCompleteness() } = {}) =>
  priorLedger().chain((prior) =>
    fc.record({
      prior: fc.constant(prior),
      observed: observationOf(prior),
      completeness,
      removalConfirmations: fc.constant(REMOVAL_CONFIRMATIONS),
      now: fc.constant(NOW),
    }),
  );

/**
 * A full permutation of an array — every element, reordered.
 *
 * `shuffledSubarray` with both bounds pinned to the length is a permutation
 * rather than a sample, which is what PT-02 is about: the *same* harvest, seen
 * in a different order.
 *
 * @param {ReadonlyArray<any>} items
 * @returns {fc.Arbitrary<any[]>}
 */
export const permutationOf = (items) =>
  fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });

/**
 * A harvest paired with a reordering of itself.
 *
 * @param {{ completeness?: fc.Arbitrary<string> }} [options]
 * @returns {fc.Arbitrary<{ input: any, shuffled: any[] }>}
 */
export const ledgerAndHarvestShuffled = ({ completeness = anyCompleteness() } = {}) =>
  ledgerAndHarvest({ completeness }).chain((input) =>
    fc.record({ input: fc.constant(input), shuffled: permutationOf(input.observed) }),
  );

/**
 * A ledger containing at least one terminal record, and a sequence of harvests.
 *
 * PT-03 says a tombstoned id never becomes active *under any observation
 * sequence*, so one harvest is not enough to state it. The sequence is 1-5
 * harvests of arbitrary completeness, and the law forces every terminal identity
 * into every one of them — the adversarial case, where the source keeps serving
 * a review that was deleted and keeps serving it on every single run.
 *
 * Both terminal states are generated. `tombstoned` and `suppressed` reach
 * terminality for unrelated reasons — a confirmed removal and an erasure
 * obligation — and a reconciler that guarded only the first would leave the one
 * with legal weight unprotected.
 *
 * @returns {fc.Arbitrary<{ prior: Map<string, any>, terminalIds: string[], sequence: any[] }>}
 */
export const terminalLedgerAndHarvest = () =>
  fc
    .tuple(
      fc.uniqueArray(identityHash(), { minLength: 2, maxLength: 8 }),
      fc.constantFrom('tombstoned', 'suppressed'),
      fc.integer({ min: 1, max: 3 }),
    )
    .chain(([ids, terminalState, requestedTerminal]) => {
      const terminalCount = Math.min(requestedTerminal, ids.length - 1);
      const terminalIds = ids.slice(0, terminalCount);
      const prior = new Map(
        ids.map((id, index) => [
          id,
          makeRecord(id, index < terminalCount ? terminalState : 'active', 0),
        ]),
      );

      return fc.record({
        prior: fc.constant(prior),
        terminalIds: fc.constant(terminalIds),
        sequence: harvestSequence(ids),
      });
    });

/**
 * 1-5 harvests, each observing an arbitrary subset at an increasing timestamp.
 *
 * @param {ReadonlyArray<string>} ids
 * @returns {fc.Arbitrary<any[]>}
 */
const harvestSequence = (ids) =>
  fc.array(fc.record({ observedIds: fc.subarray([...ids]), completeness: anyCompleteness() }), {
    minLength: 1,
    maxLength: 5,
  });

/**
 * A distinct RFC 3339 instant per step of a harvest sequence.
 *
 * Each harvest in a sequence must run at its own `now` — reusing one instant
 * would let the idempotence guard suppress later harvests and PT-03 would stop
 * exercising repeated observation, which is the whole scenario.
 *
 * @param {number} index
 * @returns {string}
 */
export function instantAt(index) {
  return `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;
}
