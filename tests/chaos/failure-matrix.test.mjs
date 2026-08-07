import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OUTCOMES } from '../../src/core/model/ledger.mjs';
import { reconcile } from '../../src/core/reconcile/index.mjs';
import { classifyCompleteness } from '../../src/core/validate/completeness.mjs';
import { naiveUniformAbsence } from '../helpers/naive-reconcile.mjs';
import { harvest, identity, ledgerWith, review, T0, T1 } from '../helpers/reconcile-input.mjs';

/**
 * The chaos matrix — CH-01…CH-14 (PH-21, §62).
 *
 * **This file currently contains CH-04 only.** The other thirteen scenarios need
 * the acquisition, gate and publish layers, which are PH-06 and later. CH-04 is
 * here early and deliberately: it is the scenario the documents single out, and
 * two of its three protections are already implementable.
 *
 * ============================================================================
 * CH-04 — PAGINATION STALLS AT 12 OF 118
 * ============================================================================
 *
 * TR-TEST-091: *"CH-04 is the single most important test in the suite. It
 * simulates the exact failure that would otherwise silently delete a client's
 * reviews, and asserts three independent protections engage."*
 *
 * ## The scenario
 *
 * A listing advertises 118 reviews. The engine has 118 in its ledger from a
 * previous complete harvest. On this run the page stops yielding after 12 — a
 * stalled scroll, a lazy-loader that never fired, a network stall. Nothing
 * throws. There is no error to catch. The engine simply has 12 records where it
 * expected 118.
 *
 * The catastrophic reading of that moment is "106 reviews were deleted". They
 * were not. They were **not looked at**. If the engine cannot tell those two
 * situations apart, one stalled page load starts a countdown that removes a
 * paying client's entire review set three harvests later, with no error raised
 * anywhere, no failed job, and no alert.
 *
 * ## Three protections, asserted separately (IMPL-PLAN §62.2)
 *
 * | # | Protection | Asserted how |
 * |---|---|---|
 * | 1 | Partial classification | `completeness === 'partial'` after the stall |
 * | 2 | Streak suppression | every record's `missing_streak` unchanged |
 * | 3 | Gate rejection | the verdict rejects, naming the coverage rule |
 *
 * They must be asserted separately. *"A test asserting only the third would pass
 * even if the first two protections were removed, because the gate alone would
 * catch this particular case — and the first two are what protect the cases the
 * gate does not catch."*
 *
 * **Protection 3 cannot be asserted yet.** `src/core/gate/` is empty until
 * PH-06, and the honest options were to leave the assertion out or to invent a
 * gate to assert against. Inventing one would produce a green test that proves
 * nothing about the rule it names — the precise failure §62 warns about, where
 * *"CH-04 implemented as a count check rather than a completeness check would
 * pass while the protection it tests is absent"*. So protection 3 is an explicit
 * `todo`, and a guard below fails the moment `core/gate/index.mjs` appears.
 *
 * ## The verification requirement is mechanised
 *
 * §62.2 requires a reviewer to remove protection 2 and confirm CH-04 fails,
 * because *"a chaos test that still passes with a protection removed is testing
 * something else"*. That review is automated here: `naiveUniformAbsence` **is**
 * the reconciler with the completeness check removed, and the last two tests run
 * this same scenario through it and assert the damage.
 */

const ADVERTISED_TOTAL = 118;
const OBSERVED_BEFORE_STALL = 12;
const NEW_REVIEWS = 2;

/** The 118 reviews a previous complete harvest established. */
const priorReviews = () => Array.from({ length: ADVERTISED_TOTAL }, (_, i) => review(i));

/** The 12 the stalled run managed to read, re-served unchanged. */
const observedReviews = () => Array.from({ length: OBSERVED_BEFORE_STALL }, (_, i) => review(i));

/** Two reviews that appeared for the first time during the stalled run. */
const freshReviews = () =>
  Array.from({ length: NEW_REVIEWS }, (_, i) => review(ADVERTISED_TOTAL + i));

/** The identities the run never reached. */
const unreachedIds = () =>
  Array.from({ length: ADVERTISED_TOTAL - OBSERVED_BEFORE_STALL }, (_, i) =>
    identity(i + OBSERVED_BEFORE_STALL),
  );

/**
 * The stalled run's report. `stop_reason` is the ONLY input to completeness
 * (VAL-01); the counts ride along for diagnostics and are never consulted.
 * `12 < 118` is the tempting signal and it is wrong in both directions.
 */
const stalledReport = Object.freeze({
  stop_reason: 'stalled',
  advertised_total: ADVERTISED_TOTAL,
  observed_count: OBSERVED_BEFORE_STALL,
});

describe('CH-04 — pagination stalls at 12 of 118 (INV-03)', () => {
  const before = ledgerWith(priorReviews(), T0);
  const out = reconcile(
    harvest({
      prior: before,
      observed: [...observedReviews(), ...freshReviews()],
      stopReason: 'stalled',
      now: T1,
    }),
  );
  const after = out.ledger;

  describe('protection 1 · partial classification', () => {
    it('classifies the stalled harvest as partial', () => {
      expect(classifyCompleteness(stalledReport)).toBe('partial');
    });

    it('derives that from the stop reason, not from the counts', () => {
      // The same 12-of-118 shortfall classifies as `full` when the navigator
      // says it stopped because it had everything. Counts cannot tell the two
      // apart; the stop reason is the only thing that can.
      expect(classifyCompleteness({ ...stalledReport, stop_reason: 'target_reached' })).toBe(
        'full',
      );
      expect(classifyCompleteness({ ...stalledReport, stop_reason: 'budget_exhausted' })).toBe(
        'partial',
      );
    });

    it('does not treat a partial harvest as evidence of absence', () => {
      const completeness = classifyCompleteness(stalledReport);

      expect(completeness).not.toBe('full');
      expect(completeness).not.toBe('full_capped');
    });
  });

  describe('protection 2 · streak suppression', () => {
    it('leaves every unreached record byte-identical', () => {
      expect(changedRecords(before, after, unreachedIds())).toEqual([]);
    });

    it('increments no streak anywhere in the ledger', () => {
      expect(distinctStreaks(after)).toEqual([0]);
    });

    it('tombstones nothing', () => {
      expect(distinctStates(after)).toEqual(['active']);
      expect(out.decisions.tombstoned).toBe(0);
    });

    it('reports every absence as HELD rather than MISSING', () => {
      // HELD is the outcome that says "this absence was not counted". A run
      // reporting MISSING for these would be counting them.
      expect(out.decisions.held).toBe(ADVERTISED_TOTAL - OBSERVED_BEFORE_STALL);
      expect(out.decisions.missing).toBe(0);
      expect(countOf(out.decisions.decisions, OUTCOMES.MISSING)).toBe(0);
    });
  });

  describe('additions are still merged', () => {
    it('inserts reviews first seen during the stalled run', () => {
      // Observation is always evidence; only ABSENCE is conditional. Refusing
      // new reviews on a partial harvest would be a different bug in the
      // opposite direction, and a payload that never grows during a bad week.
      expect(after.records.size).toBe(ADVERTISED_TOTAL + NEW_REVIEWS);
      expect(out.decisions.inserted).toBe(NEW_REVIEWS);
      expect(after.records.get(identity(ADVERTISED_TOTAL))?.state).toBe('active');
    });

    it('advances last_seen_at for the 12 that were observed', () => {
      expect(after.records.get(identity(0))?.last_seen_at).toBe(T1);
      expect(after.records.get(identity(ADVERTISED_TOTAL - 1))?.last_seen_at).toBe(T0);
      expect(out.decisions.unchanged).toBe(OBSERVED_BEFORE_STALL);
    });

    it('does not advance the freshness signal', () => {
      // `last_full_harvest_at` is what a client is told about freshness. A
      // stalled run must not make the data look newly verified.
      expect(after.last_full_harvest_at).toBe(before.last_full_harvest_at);
      expect(after.updated_at).toBe(T1);
    });

    it('leaves the ledger sound', () => {
      expect(out.invariantViolations).toEqual([]);
    });
  });

  describe('protection 3 · gate rejection', () => {
    it.todo('rejects on the coverage rule G-05 — needs core/gate/ (PH-06, T-295)');

    it('fails once the gate exists, so protection 3 cannot stay unwritten', () => {
      // A forcing function rather than a note somebody has to find. When PH-06
      // lands `core/gate/index.mjs`, this test fails and the todo above must be
      // written for the suite to go green again.
      expect(
        existsSync(new URL('../../src/core/gate/index.mjs', import.meta.url)),
        'core/gate/ now exists: write CH-04 protection 3 (T-295) and delete this test',
      ).toBe(false);
    });
  });

  describe('verification · removing protection 2 must break this test (§62.2)', () => {
    it('counts all 106 absences the moment the completeness check is gone', () => {
      // naiveUniformAbsence IS this reconciler with the check removed. The
      // reviewer step §62.2 mandates, mechanised.
      const damaged = withProtectionRemoved(asPlainMap(before), T1);

      expect(countedAbsences(damaged, unreachedIds())).toBe(
        ADVERTISED_TOTAL - OBSERVED_BEFORE_STALL,
      );
    });

    it('deletes 106 of 118 reviews after three stalls', () => {
      // The cost, stated as a number rather than as a warning. Three stalled
      // runs - eighteen hours at the default cadence - and 90% of a client's
      // reviews are gone from their website.
      let damaged = asPlainMap(before);

      for (let stall = 0; stall < 3; stall += 1) {
        damaged = withProtectionRemoved(damaged, `2026-03-0${stall + 1}T00:00:00.000Z`);
      }

      const tombstoned = countTombstoned(damaged);

      expect(tombstoned).toBe(ADVERTISED_TOTAL - OBSERVED_BEFORE_STALL);
      expect(after.records.size - tombstoned).toBe(OBSERVED_BEFORE_STALL + NEW_REVIEWS);
    });

    it('and the real reconciler survives the same three stalls untouched', () => {
      // The other side of the same experiment, which is what makes the number
      // above meaningful rather than merely alarming.
      let ledger = before;

      for (let stall = 0; stall < 3; stall += 1) {
        ledger = reconcile(
          harvest({
            prior: ledger,
            observed: observedReviews(),
            stopReason: 'stalled',
            now: `2026-03-0${stall + 1}T00:00:00.000Z`,
          }),
        ).ledger;
      }

      expect(distinctStates(ledger)).toEqual(['active']);
      expect(distinctStreaks(ledger)).toEqual([0]);
    });
  });
});

/**
 * The same stalled harvest, applied by a reconciler whose completeness check has
 * been removed. This is §62.2's protection-removal step, as a function.
 *
 * @param {Map<string, any>} prior
 * @param {string} now
 * @returns {Map<string, any>}
 */
function withProtectionRemoved(prior, now) {
  return naiveUniformAbsence({
    prior,
    observed: observedReviews().map((r) => ({
      identity_hash: r.identity_hash,
      content_hash: r.content_hash,
    })),
    completeness: 'partial',
    removalConfirmations: 3,
    now,
  });
}

/** @param {any} ledger @returns {number[]} */
function distinctStreaks(ledger) {
  return [...new Set([...ledger.records.values()].map((record) => record.missing_streak))].sort();
}

/** @param {any} ledger @returns {string[]} */
function distinctStates(ledger) {
  return [...new Set([...ledger.records.values()].map((record) => record.state))].sort();
}

/** @param {ReadonlyArray<any>} decisions @param {string} wanted @returns {number} */
function countOf(decisions, wanted) {
  return decisions.filter((entry) => entry.outcome === wanted).length;
}

/**
 * Which of `ids` differ in any field between two ledgers. Returns the ids rather
 * than a count, so a failure names the records that moved.
 *
 * @param {any} before
 * @param {any} after
 * @param {ReadonlyArray<string>} ids
 * @returns {string[]}
 */
function changedRecords(before, after, ids) {
  return ids.filter(
    (id) => JSON.stringify(before.records.get(id)) !== JSON.stringify(after.records.get(id)),
  );
}

/**
 * How many of `ids` had an absence counted against them.
 *
 * @param {Map<string, any>} ledger
 * @param {ReadonlyArray<string>} ids
 * @returns {number}
 */
function countedAbsences(ledger, ids) {
  return ids.filter((id) => ledger.get(id)?.missing_streak === 1).length;
}

/**
 * A `Ledger`'s records as the plain map the naive reconcilers take.
 *
 * @param {any} ledger
 * @returns {Map<string, any>}
 */
function asPlainMap(ledger) {
  return new Map(
    [...ledger.records.entries()].map(([id, record]) => [
      id,
      {
        identity_hash: id,
        content_hash: record.review.content_hash,
        state: record.state,
        first_seen_at: record.first_seen_at,
        last_seen_at: record.last_seen_at,
        missing_streak: record.missing_streak,
        tombstoned_at: record.tombstoned_at,
      },
    ]),
  );
}

/**
 * @param {Map<string, any>} ledger
 * @returns {number}
 */
function countTombstoned(ledger) {
  let total = 0;

  for (const record of ledger.values()) {
    if (record.state === 'tombstoned') total += 1;
  }

  return total;
}
