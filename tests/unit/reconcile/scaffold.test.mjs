import { describe, expect, it } from 'vitest';

import { createLedger } from '../../../src/core/model/ledger.mjs';
import {
  NOT_IMPLEMENTED,
  decideAbsent,
  decideObserved,
} from '../../../src/core/reconcile/decide.mjs';
import { EMPTY_DECISIONS, isScaffold, reconcile } from '../../../src/core/reconcile/index.mjs';
import {
  NOT_IMPLEMENTED_OUTCOME,
  evaluateRemoval,
  isTerminalState,
} from '../../../src/core/reconcile/removal.mjs';
import * as decideModule from '../../../src/core/reconcile/decide.mjs';
import * as removalModule from '../../../src/core/reconcile/removal.mjs';
import * as suppressModule from '../../../src/core/reconcile/suppress.mjs';
import { applySuppression, suppressedAmong } from '../../../src/core/reconcile/suppress.mjs';

/**
 * The scaffold's contract.
 *
 * A scaffold has no logic, so it cannot be tested for behaviour — but it does
 * have a contract, and that contract is the socket the real implementation gets
 * dropped into. These tests lock it: the shapes returned, that nothing throws,
 * and above all the guarantees that must survive implementation.
 *
 * The last two `describe` blocks are the ones that matter after T-100 lands.
 * They are written now so they are already in place when someone starts
 * editing, rather than being added afterwards by someone who has to remember.
 */

const NOW = '2026-03-01T00:00:00.000Z';
const emptyLedger = () => createLedger({ clientSlug: 'c', listingKey: 'main', now: NOW });

describe('the scaffold declares itself', () => {
  it('reports isScaffold from every module that has one', () => {
    // When these start returning false, the "vacuous law" notices in the
    // property suites stop being true and must be removed.
    expect(isScaffold()).toBe(true);
    expect(decideModule.isScaffold()).toBe(true);
    expect(removalModule.isScaffold()).toBe(true);
    expect(suppressModule.isScaffold()).toBe(true);
  });
});

describe('reconcile scaffold contract', () => {
  const out = reconcile({
    prior: emptyLedger(),
    observed: [],
    report: /** @type {any} */ ({ stop_reason: 'target_reached' }),
    config: /** @type {any} */ ({ removalConfirmations: 3, denylist: new Set() }),
    now: NOW,
  });

  it('returns the prior ledger untouched', () => {
    // The safest possible no-op: it publishes nothing new and removes nothing.
    // Shipped by accident, a payload goes stale - visible and recoverable.
    expect(out.ledger.records.size).toBe(0);
  });

  it('returns an all-zero decision log', () => {
    expect(out.decisions).toEqual(EMPTY_DECISIONS);
  });

  it('reports invariant violations as an array', () => {
    expect(Array.isArray(out.invariantViolations)).toBe(true);
    expect(out.invariantViolations).toEqual([]);
  });

  it('requires now as an explicit parameter (LEDG-04)', () => {
    // A Date.now() default here would void five property laws without failing a
    // single existing test.
    expect(String(reconcile)).not.toContain('Date.now');
    expect(String(reconcile)).not.toContain('new Date(');
  });

  it('does not throw on an empty or hostile input', () => {
    const probe = () =>
      reconcile({
        prior: emptyLedger(),
        observed: [],
        report: /** @type {any} */ ({}),
        config: /** @type {any} */ ({ removalConfirmations: 0, denylist: new Set() }),
        now: NOW,
      });

    expect(probe).not.toThrow();
  });
});

describe('decide scaffold contract', () => {
  const context = /** @type {any} */ ({
    completeness: 'full',
    removalConfirmations: 3,
    denylist: new Set(),
    now: NOW,
  });

  it('returns the NOT_IMPLEMENTED sentinel rather than guessing', () => {
    expect(decideObserved({}, undefined, context).outcome).toBe(NOT_IMPLEMENTED.outcome);
    expect(decideAbsent({}, context).outcome).toBe(NOT_IMPLEMENTED.outcome);
  });

  it('returns the full Decision shape, so the call site is already correct', () => {
    for (const decision of [decideObserved({}, undefined, context), decideAbsent({}, context)]) {
      expect(Object.keys(decision).sort()).toEqual(['identity_hash', 'outcome', 'reason']);
      expect(Object.isFrozen(decision)).toBe(true);
    }
  });

  it('names the task that will implement it', () => {
    expect(NOT_IMPLEMENTED.reason).toContain('T-100');
  });
});

describe('removal scaffold contract', () => {
  it('returns the change-nothing outcome', () => {
    expect(evaluateRemoval({}, /** @type {any} */ ({ removalConfirmations: 3 }), NOW)).toEqual(
      NOT_IMPLEMENTED_OUTCOME,
    );
  });

  it('never tombstones from the scaffold', () => {
    expect(NOT_IMPLEMENTED_OUTCOME.tombstone).toBe(false);
    expect(NOT_IMPLEMENTED_OUTCOME.tombstonedAt).toBeNull();
  });

  it('defines terminal state concretely, because PT-03 needs it now', () => {
    expect(isTerminalState('tombstoned')).toBe(true);
    expect(isTerminalState('suppressed')).toBe(true);
    expect(isTerminalState('active')).toBe(false);
    expect(isTerminalState('unconfirmed')).toBe(false);
    expect(isTerminalState(undefined)).toBe(false);
  });
});

describe('suppress scaffold contract', () => {
  it('returns the not-suppressed outcome', () => {
    expect(applySuppression('a'.repeat(32), 'active', new Set())).toEqual({
      suppressed: false,
      nextState: 'active',
    });
  });

  it('intersects an identity set with the denylist', () => {
    const denylist = new Set(['a'.repeat(32)]);

    expect(suppressedAmong(['a'.repeat(32), 'b'.repeat(32)], denylist)).toEqual(['a'.repeat(32)]);
    expect(suppressedAmong([], denylist)).toEqual([]);
  });
});

describe('PT-04 — there is no un-suppress path, and there must never be one', () => {
  it('exports nothing that would reverse a suppression', () => {
    // T-107's stated verification is that a reviewer looks for an un-suppress
    // path and finds none. Mechanised so it stays true after future edits
    // rather than only on the day someone looked.
    const forbidden = ['unsuppress', 'restore', 'clear', 'undo', 'reactivate', 'enable'];

    for (const name of Object.keys(suppressModule)) {
      for (const word of forbidden) {
        expect(name.toLowerCase(), `suppress.mjs exports "${name}"`).not.toContain(word);
      }
    }
  });

  it('takes no flag that would re-enable a suppressed id', () => {
    // applySuppression(identityHash, priorState, denylist). Three parameters,
    // none of them a boolean escape hatch.
    expect(applySuppression.length).toBe(3);
  });
});
