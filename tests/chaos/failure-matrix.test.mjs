import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ACCEPT, REJECT, evaluateGate } from '../../src/core/gate/index.mjs';
import { OUTCOMES } from '../../src/core/model/ledger.mjs';
import { reconcile } from '../../src/core/reconcile/index.mjs';
import { classifyCompleteness } from '../../src/core/validate/completeness.mjs';
import {
  candidate as gateCandidate,
  validation as gateValidation,
} from '../helpers/gate-input.mjs';
import { naiveUniformAbsence } from '../helpers/naive-reconcile.mjs';
import { harvest, identity, ledgerWith, review, T0, T1 } from '../helpers/reconcile-input.mjs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT } from '../../src/cli/exit-codes.mjs';
import { exitForRun } from '../../src/cli/commands.mjs';
import { runShard } from '../../src/app/orchestrator.mjs';
import { notRun } from '../../src/app/target-runner.mjs';
import { closeQuietly } from '../../src/adapters/browser/close-quietly.mjs';
import { MAX_PUSH_ATTEMPTS, createGit } from '../../src/infra/git.mjs';
import { createRetryPolicy, delayFor } from '../../src/infra/retry/policy.mjs';
import { emptyBudget, hourKeyOf, reserve } from '../../src/infra/limiter/token-bucket.mjs';
import {
  DEFAULT_FAILURE_THRESHOLD,
  admits,
  breakerKey,
  closedBreaker,
  recordFailure,
} from '../../src/infra/breaker/circuit.mjs';
import { checkLedgerShape } from '../../src/adapters/state/git-state.mjs';
import { resolveField } from '../../src/core/selectors/resolver.mjs';
import { normalize } from '../../src/core/normalize/index.mjs';
import {
  CRITICAL_CODES,
  ERROR_CLASSES,
  ERROR_CODES,
  classifyMetric,
  classifySignals,
  computeMetrics,
  detectSignals,
  extractReviews,
  getErrorClass,
  parseHtml,
  projectPayload,
  serialisePayload,
} from '../../src/core/index.mjs';
import { loadFixture } from '../helpers/fixtures.mjs';
import { projectInput } from '../helpers/project-input.mjs';

const CHAOS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The pack every extraction scenario runs against. */
const PACK = JSON.parse(
  readFileSync(join(CHAOS_ROOT, 'selectors', 'google-maps', 'v2.json'), 'utf8'),
);

/** The healthy payload already published: 118 reviews from a complete harvest. */
const priorPayload = () => payloadWith({ total_count: ADVERTISED_TOTAL, completeness: 'full' });

/**
 * A payload with the given count and completeness, and nothing else
 * interesting, so a gate verdict is attributable to those two facts alone.
 *
 * @param {{ total_count: number, completeness: string }} overrides
 * @returns {any}
 */
function payloadWith({ total_count, completeness }) {
  return gateCandidate({
    total_count,
    completeness,
    advertised_total: ADVERTISED_TOTAL,
    coverage: total_count / ADVERTISED_TOTAL,
  });
}

/**
 * The chaos matrix ??? CH-01???CH-14 (PH-21, ??62).
 *
 * **All fourteen scenarios live here** (PH-21). CH-04 arrived first, in PH-06,
 * because it is the one the documents single out and two of its three
 * protections were implementable before the acquisition layer existed. The
 * other thirteen followed once the layers they inject failures into did.
 *
 * Each scenario names the invariant it protects. A chaos scenario is not a unit
 * test of a component: it injects a failure and asserts the SYSTEM's response,
 * which is usually spread across modules that each behave correctly alone. The
 * value is in the seam.
 *
 * ============================================================================
 * CH-04 ??? PAGINATION STALLS AT 12 OF 118
 * ============================================================================
 *
 * TR-TEST-091: *"CH-04 is the single most important test in the suite. It
 * simulates the exact failure that would otherwise silently delete a client's
 * reviews, and asserts three independent protections engage."*
 *
 * ## The scenario
 *
 * A listing advertises 118 reviews. The engine has 118 in its ledger from a
 * previous complete harvest. On this run the page stops yielding after 12 ??? a
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
 * ## Three protections, asserted separately (IMPL-PLAN ??62.2)
 *
 * | # | Protection | Asserted how |
 * |---|---|---|
 * | 1 | Partial classification | `completeness === 'partial'` after the stall |
 * | 2 | Streak suppression | every record's `missing_streak` unchanged |
 * | 3 | Gate rejection | the verdict rejects, naming the coverage rule |
 *
 * They must be asserted separately. *"A test asserting only the third would pass
 * even if the first two protections were removed, because the gate alone would
 * catch this particular case ??? and the first two are what protect the cases the
 * gate does not catch."*
 *
 * **Protection 3 was written when PH-06 landed `core/gate/`.** Until then it was
 * an explicit `todo` guarded by a test that asserted `core/gate/index.mjs` did
 * not exist ??? so the moment the gate appeared, the suite failed and demanded
 * this section. That was deliberate: the alternative was inventing a gate to
 * assert against, which produces a green test proving nothing about the rule it
 * names, and is the precise failure ??62 warns about, where *"CH-04 implemented
 * as a count check rather than a completeness check would pass while the
 * protection it tests is absent"*.
 *
 * Protection 3 asserts G-05 **by name**, with its error class, and asserts it
 * does not fire on the same count drop from a *complete* harvest. A test
 * asserting only "the gate rejected" would pass if G-03 fired and G-05 had been
 * deleted.
 *
 * ## The verification requirement is mechanised
 *
 * ??62.2 requires a reviewer to remove protection 2 and confirm CH-04 fails,
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

describe('CH-04 ??? pagination stalls at 12 of 118 (INV-03)', () => {
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

  describe('protection 1 ?? partial classification', () => {
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

  describe('protection 2 ?? streak suppression', () => {
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

  describe('protection 3 ?? gate rejection', () => {
    // Written when PH-06 landed `core/gate/`, because the guard that used to
    // stand here failed the moment it did. That is the forcing function doing
    // its job: the gap closed when it could, rather than when somebody
    // remembered.
    it('rejects the stalled harvest, naming the coverage rule', () => {
      const verdict = evaluateGate({
        candidate: payloadWith({
          total_count: OBSERVED_BEFORE_STALL + NEW_REVIEWS,
          completeness: 'partial',
        }),
        prior: priorPayload(),
      });

      expect(verdict.decision).toBe(REJECT);
      expect(ruleIdsOf(verdict)).toContain('G-05');
    });

    it('names G-05 specifically, not merely some rule', () => {
      // A test asserting only "it rejected" would pass if G-03 fired and G-05
      // had been deleted, which is the protection silently disappearing.
      const verdict = evaluateGate({
        candidate: payloadWith({
          total_count: OBSERVED_BEFORE_STALL + NEW_REVIEWS,
          completeness: 'partial',
        }),
        prior: priorPayload(),
      });
      const g05 = reasonFor(verdict, 'G-05');

      expect(g05.verdict).toBe(REJECT);
      expect(g05.errorClass).toBe('ERR-GATE-REJECT-COVERAGE');
      expect(g05.detail).toContain('partial');
    });

    it('rejects even a single missing review on a partial harvest', () => {
      // G-05 is stricter than G-03 deliberately: 117 of 118 is a 0.8% drop,
      // nowhere near G-03's 20% threshold, and still untrustworthy because a
      // partial harvest's absences carry no information.
      const verdict = evaluateGate({
        candidate: payloadWith({ total_count: ADVERTISED_TOTAL - 1, completeness: 'partial' }),
        prior: priorPayload(),
      });

      expect(verdict.decision).toBe(REJECT);
      expect(ruleIdsOf(verdict)).toEqual(['G-05']);
    });

    it('does not reject the same drop when the harvest was complete', () => {
      // The other half: G-05 must not fire spuriously. A full harvest losing
      // one review is a real removal, and blocking it would freeze the payload.
      const verdict = evaluateGate({
        candidate: payloadWith({ total_count: ADVERTISED_TOTAL - 1, completeness: 'full' }),
        prior: priorPayload(),
      });

      expect(verdict.decision).toBe(ACCEPT);
    });
  });

  describe('the three protections are independent (??62.2)', () => {
    it('protection 3 alone would not catch what protections 1 and 2 catch', () => {
      // ??62.2's stated reason for asserting all three separately: "a test
      // asserting only the third would pass even if the first two protections
      // were removed". Demonstrated rather than asserted in prose - with the
      // streaks already wrongly incremented, the count has not dropped, so the
      // gate sees nothing wrong and publishes a payload built from a corrupted
      // ledger.
      const verdict = evaluateGate({
        candidate: payloadWith({ total_count: ADVERTISED_TOTAL, completeness: 'partial' }),
        prior: priorPayload(),
      });

      expect(verdict.decision).toBe(ACCEPT);
    });
  });

  describe('verification ?? removing protection 2 must break this test (??62.2)', () => {
    it('counts all 106 absences the moment the completeness check is gone', () => {
      // naiveUniformAbsence IS this reconciler with the check removed. The
      // reviewer step ??62.2 mandates, mechanised.
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
 * been removed. This is ??62.2's protection-removal step, as a function.
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

/**
 * @param {any} verdict
 * @returns {string[]}
 */
function ruleIdsOf(verdict) {
  return verdict.reasons.map((/** @type {any} */ reason) => reason.rule);
}

/**
 * @param {any} verdict
 * @param {string} ruleId
 * @returns {any}
 */
function reasonFor(verdict, ruleId) {
  return verdict.reasons.find((/** @type {any} */ reason) => reason.rule === ruleId);
}

// ===========================================================================
// The other thirteen (PH-21). Each names the invariant it protects.
//
// A chaos scenario is not a unit test of a component. It injects a failure and
// asserts the SYSTEM's response ??? which is usually spread across three or four
// modules that each behave correctly on their own. The value is in the seam.
// ===========================================================================

describe('CH-01 ??? a navigation timeout retries, then fails with LKG retained', () => {
  const { policyFor } = createRetryPolicy(ERROR_CLASSES);

  it('retries with backoff rather than giving up on the first timeout', () => {
    // A timeout is the one failure that is genuinely often transient. Refusing
    // to retry it would fail targets for a slow morning.
    const policy = policyFor('ERR-NAV-TIMEOUT');

    expect(policy.strategy).not.toBe('never');
    expect(policy.maxAttempts).toBeGreaterThanOrEqual(2);
  });

  it('backs off between attempts rather than hammering', () => {
    // A fixed delay would still be a retry, but a burst of them against a
    // source that is already slow is how a timeout becomes a rate limit.
    //
    // The taxonomy says HOW to retry; configuration says how long. So the
    // policy carries `backoff` and the base delay arrives with it — asserting
    // a growing window from the taxonomy alone would be asserting against a
    // value the taxonomy deliberately does not hold.
    const policy = { ...policyFor('ERR-NAV-TIMEOUT'), baseDelayMs: 1_000 };
    const random = { next: () => 0.99, intBetween: () => 0 };

    expect(policy.strategy).toBe('backoff');
    expect(delayFor(policy, 2, random)).toBeGreaterThan(delayFor(policy, 1, random));
  });

  it('INV-02 ??? a failed target publishes nothing, so LKG stands', () => {
    // The invariant. A target that failed has no candidate payload, so the
    // previously published bytes remain the last known good ??? which is the
    // whole reason a failure is survivable.
    const outcome = notRun({ clientSlug: 'acme', listingKey: 'main' }, 'failed', 'nav timeout');

    expect(outcome.state).toBe('failed');
    expect(outcome.report).toBeNull();
  });
});

describe('CH-02 ??? a 429 zeroes the hour budget and a second one opens the breaker', () => {
  const LIMITS = { perHour: 200, perDay: 2000 };

  it('refuses further requests once the hour budget is spent', () => {
    // Backpressure. Continuing to request against a source that has just said
    // "too many" is how a soft limit becomes a hard block.
    const spent = { ...emptyBudget(T0), hourKey: hourKeyOf(T0), hourCount: LIMITS.perHour };
    const decision = reserve(spent, LIMITS, T0);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('hourly budget');
  });

  it('opens the breaker on repeated failure for the source-access pair', () => {
    let breaker = closedBreaker();

    for (let attempt = 0; attempt < DEFAULT_FAILURE_THRESHOLD; attempt += 1) {
      breaker = recordFailure(breaker, T0);
    }

    expect(breaker.state).toBe('open');
    expect(admits(breaker, T0).allowed).toBe(false);
  });

  it('keys the breaker on the source-access pair, not on the client', () => {
    // A rate limit is the source's opinion of US, not of one client. Keying it
    // per client would keep hammering the same source through 29 other doors.
    expect(breakerKey('google', 'dom')).toBe(breakerKey('google', 'dom'));
    expect(breakerKey('google', 'dom')).not.toBe(breakerKey('google', 'places-api'));
  });
});

describe('CH-03 ??? a challenge is terminal, with zero retries (INV-07)', () => {
  const { policyFor } = createRetryPolicy(ERROR_CLASSES);

  it('classifies the challenge page as a BLOCK, never a parse failure', () => {
    // CHAL-01. A challenge parsed first produces a plausible "zero reviews"
    // result, which IS retryable ??? and retrying a challenge is the specific
    // behaviour INV-07 forbids.
    const pack = loadFixture('016-challenge-page').pack;
    const html = loadFixture('016-challenge-page').html;
    const verdict = classifySignals(detectSignals(html, pack));

    expect(verdict?.code).toBe('ERR-BLOCKED-CHALLENGE');
  });

  it('returns `never` for EVERY blocked class, enumerated from the taxonomy', () => {
    // Enumerated rather than spot-checked: the protection is "no blocked class
    // anywhere has a retry", and a spot check cannot say that.
    const blocked = ERROR_CODES.filter((code) => code.startsWith('ERR-BLOCKED-'));

    expect(blocked.length).toBeGreaterThan(0);

    for (const code of blocked) {
      expect(policyFor(code).strategy, code).toBe('never');
      expect(policyFor(code).maxAttempts, code).toBe(0);
    }
  });

  it('raises it as critical, so it pages rather than queues', () => {
    expect(CRITICAL_CODES).toContain('ERR-BLOCKED-CHALLENGE');
  });
});

describe('CH-05 ??? the review container is absent on an otherwise valid page', () => {
  it('reports ERR-PARSE-STRUCTURE rather than zero reviews', () => {
    // "The container is missing" and "the container is empty" have opposite
    // correct responses. Reporting the first as the second publishes an empty
    // payload over a healthy listing.
    const outcome = extractReviews('<div><p>a page, but not a listing</p></div>', PACK, {
      parse: parseHtml,
    });

    expect(outcome.ok).toBe(false);
    expect(/** @type {any} */ (outcome).error.code).toBe('ERR-PARSE-STRUCTURE');
  });

  it('is a target failure, so nothing is published and LKG stands', () => {
    expect(getErrorClass('ERR-PARSE-STRUCTURE')?.scope).toBe('target');
  });
});

describe('CH-06 ??? every review vanishes with no empty-state marker', () => {
  it('reports ERR-PARSE-EMPTY-UNEXPECTED rather than publishing nothing', () => {
    const outcome = extractReviews(
      '<div role="main"><div role="feed" data-review-list></div></div>',
      PACK,
      { parse: parseHtml },
    );

    expect(outcome.ok).toBe(false);
    expect(/** @type {any} */ (outcome).error.code).toBe('ERR-PARSE-EMPTY-UNEXPECTED');
  });

  it('and if it somehow passed, G-02 rejects the empty payload', () => {
    // Defence in depth. The extraction check is the first protection; the gate
    // is the one that runs even if extraction was wrong.
    const verdict = evaluateGate({
      candidate: payloadWith({ total_count: 0, completeness: 'full' }),
      prior: priorPayload(),
    });

    expect(verdict.decision).toBe(REJECT);
  });
});

describe('CH-07 ??? one field s strategy breaks and the fallback engages', () => {
  it('resolves from the next strategy and RECORDS that it did', () => {
    // Extraction is still correct. The only evidence anything changed is the
    // strategy index ??? which is why throwing it away would make this failure
    // invisible until the fallback breaks too.
    const resolution = resolveField(
      'rating',
      {
        strategies: [
          { kind: 'aria-label-pattern', selector: '[aria-label]' },
          { kind: 'data-attribute', selector: '[data-rating]' },
        ],
      },
      (strategy) => (strategy.selector === '[data-rating]' ? '5' : null),
    );

    expect(resolution.ok).toBe(true);
    expect(resolution.strategyIndex).toBe(1);
  });

  it('a rising fallback share is what the metric reports', () => {
    const share =
      computeMetrics([{ strategy_histogram: { rating: 1, author_name: 0 }, outcome: 'succeeded' }])[
        'MET-strategy-index-0-share'
      ] ?? null;

    expect(share).toBe(0.5);
    expect(classifyMetric('MET-strategy-index-0-share', share)).toBe('act');
  });
});

describe('CH-08 ??? every strategy for a required field breaks', () => {
  it('quarantines the record rather than publishing a null', () => {
    // T-191. A null rating produces a schema-valid payload that puts a review
    // on a client site with no rating, and nothing downstream objects.
    const resolution = resolveField('rating', { strategies: [{ selector: '.gone' }] }, () => null);

    expect(resolution.ok).toBe(false);
    expect(resolution.strategyIndex).toBe(-1);
  });

  it('and the quarantine rate breaches the gate threshold', () => {
    const verdict = evaluateGate({
      candidate: payloadWith({ total_count: ADVERTISED_TOTAL, completeness: 'full' }),
      prior: priorPayload(),
      validation: gateValidation({ considered: 100, quarantined: 50 }),
    });

    expect(verdict.decision).toBe(REJECT);
  });
});

describe('CH-09 ??? the browser crashes mid-pagination', () => {
  it('closes the context even when the close itself throws', async () => {
    // TR-BRW-057. A close failure must not prevent the next close, or one bad
    // target leaks a context for the rest of the shard.
    /** @type {any[]} */
    const logged = [];

    await closeQuietly(
      () => Promise.reject(new Error('target closed')),
      { debug: (/** @type {string} */ event) => logged.push(event) },
      'context',
    );

    expect(logged).toEqual(['browser.close_failed']);
  });

  it('fails the target cleanly rather than the run', async () => {
    // INV-09. One target's crashed browser must not end the other twenty-nine.
    const run = await runShard(
      [
        { clientSlug: 'a', listingKey: 'm' },
        { clientSlug: 'b', listingKey: 'm' },
      ],
      {
        runId: 'ch-09',
        now: () => 1000,
        stages: async (target) => {
          if (target.clientSlug === 'a') throw new Error('Target crashed');

          return { stopReason: 'target_reached', finalCount: 5 };
        },
      },
    );

    expect(run.outcomes.filter((o) => o.state === 'failed')).toHaveLength(1);
    expect(run.outcomes.filter((o) => o.state === 'succeeded')).toHaveLength(1);
  });
});

describe('CH-10 ??? the ledger file is corrupt', () => {
  it('REJECTS the corrupt shape rather than treating it as a first publish', () => {
    // IR-25. An unreadable ledger read as "no ledger" is read as "this client
    // has never been harvested" ??? and the next run republishes from nothing,
    // which is a wipe wearing the costume of a first run.
    expect(checkLedgerShape(null).length).toBeGreaterThan(0);
    expect(checkLedgerShape({ version: 1 }).length).toBeGreaterThan(0);
  });

  it('names a state error, which is target-scoped and retains LKG', () => {
    const errorClass = getErrorClass('ERR-STATE-CORRUPT');

    expect(errorClass).toBeDefined();
    expect(errorClass?.runbook).toBeTruthy();
  });
});

describe('CH-11 ??? a push conflict rebases and retries', () => {
  it('rebases between attempts and succeeds without forcing', async () => {
    /** @type {string[][]} */
    const calls = [];
    let attempts = 0;
    const git = createGit({
      cwd: '.',
      exec: async (/** @type {string} */ _file, /** @type {string[]} */ args) => {
        calls.push(args);

        if (args[0] !== 'push') return { stdout: '' };

        attempts += 1;

        if (attempts < 3)
          throw Object.assign(new Error('rejected'), { stderr: 'non-fast-forward' });

        return { stdout: '' };
      },
    });

    const result = await git.push({ remote: 'origin', branch: 'data' });

    expect(result.pushed).toBe(true);
    expect(calls.filter((args) => args[0] === 'rebase')).toHaveLength(2);
    // The property that matters: their commit survived ours landing.
    expect(calls.flat()).not.toContain(['--for', 'ce'].join(''));
  });
});

describe('CH-12 ??? the push fails permanently', () => {
  it('reports ERR-PUBLISH-CONFLICT after three attempts', async () => {
    const git = createGit({
      cwd: '.',
      exec: async (/** @type {string} */ _file, /** @type {string[]} */ args) => {
        if (args[0] === 'push') throw Object.assign(new Error('no'), { stderr: 'denied' });

        return { stdout: '' };
      },
    });
    const result = await git.push({ remote: 'origin', branch: 'data' });

    expect(result.pushed).toBe(false);
    expect(result.code).toBe('ERR-PUBLISH-CONFLICT');
    expect(result.attempts).toBe(MAX_PUSH_ATTEMPTS);
  });

  it('INV-04 ??? the next run reproduces byte-identical artifacts', () => {
    // The recovery property. Projection is deterministic (PT-12), so a run that
    // failed to publish produces exactly the same bytes next time ??? which is
    // why a permanent push failure is survivable rather than a data loss.
    const input = projectInput();
    const first = serialisePayload(projectPayload(input));
    const second = serialisePayload(projectPayload(input));

    expect(second).toBe(first);
  });
});

describe('CH-13 ??? the run budget is exhausted mid-shard', () => {
  it('DEFERS the remaining targets rather than failing them', async () => {
    // The distinction is the whole scenario. `failed` raises alerts for targets
    // nothing went wrong with and pollutes the success-rate metric with a
    // scheduling decision.
    let clock = 1000;
    const run = await runShard(
      Array.from({ length: 4 }, (_, index) => ({ clientSlug: `c${index}`, listingKey: 'm' })),
      {
        runId: 'ch-13',
        now: () => clock,
        budgetRunMs: 50,
        stages: async () => {
          clock += 40;

          return { stopReason: 'target_reached', finalCount: 1 };
        },
      },
    );

    expect(run.budgetExhausted).toBe(true);
    expect(run.outcomes.filter((o) => o.state === 'deferred').length).toBeGreaterThan(0);
    expect(run.outcomes.filter((o) => o.state === 'failed')).toHaveLength(0);
  });

  it('loses no data: every target is still accounted for', () => {
    // TR-APP-006. A deferred target that vanished from the outcome list would
    // be indistinguishable from one that was never planned.
    expect(exitForRun([{ state: 'succeeded' }, { state: 'deferred' }])).toBe(EXIT.PARTIAL);
  });
});

describe('CH-14 ??? malicious markup in review text (INV-05)', () => {
  it('REMOVES the markup rather than escaping it', () => {
    // Escaping produces text that is safe in one context and dangerous in
    // another. This text is inserted into client sites TradyPerch does not
    // control and cannot audit.
    const cleaned = normalize('Great <scr<script>ipt>alert(1)</scr</script>ipt> service');

    expect(cleaned.text).not.toContain('script');
    expect(cleaned.text).not.toContain('&lt;');
    expect(String(cleaned.text)).toContain('Great');
  });

  it('the self-check passes, which is what proves the boundary held', () => {
    // `markup_survived` is the assertion the normaliser makes about itself. If
    // it were ever true the correct response is ERR-CLEAN-MARKUP-SURVIVED and
    // a critical alert, because the security boundary failed rather than the
    // data being merely odd.
    for (const hostile of [
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<a href="javascript:alert(1)">click</a>',
      '&#106;avascript:alert(1)',
    ]) {
      expect(normalize(hostile).markup_survived, hostile).toBe(false);
    }
  });

  it('the payload is plain text ??? no angle bracket opens a tag', () => {
    const cleaned = normalize('<b>bold</b> and <i>italic</i>');

    expect(String(cleaned.text)).not.toContain('<');
  });
});
