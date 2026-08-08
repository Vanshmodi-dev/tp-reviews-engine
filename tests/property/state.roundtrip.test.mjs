import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fromJSON, toJSON } from '../../src/core/model/ledger.mjs';
import { serialiseLedger } from '../../src/core/project/serialise.mjs';
import { instantAt, seedLedger } from '../helpers/reconcile-generators.mjs';

/**
 * PT-15 — ledger round-trip (T-145).
 *
 * `parse(serialise(L)) ≡ L`, **including fields this engine version does not
 * understand**.
 *
 * ## Why the unknown-field half is the important half
 *
 * `state` is a git branch, so rolling the engine back to an earlier version is
 * a normal, documented operation — not an emergency. Which means an *older*
 * engine reading a *newer* ledger is an expected event, not an edge case.
 *
 * If that older engine kept only the fields it recognised and wrote the file
 * back, the rollback would permanently delete whatever the newer version had
 * written. Nothing would report it: from the older engine's point of view the
 * file it wrote is exactly correct, the ledger still parses, and the next run
 * proceeds normally. The data is simply gone.
 *
 * TR-STOR-003 is the rule; this law is how it is held.
 */

const RUNS = 1000;

/** Field names a future engine version might plausibly add. */
const unknownKey = () =>
  fc.constantFrom(
    'sentiment_model_version',
    'reply_drafts',
    'moderation_flags',
    'ledger_epoch',
    'x_experimental',
  );

/** Values of every JSON-representable shape. */
const unknownValue = () =>
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string(), { maxLength: 3 }),
    fc.record({ nested: fc.string(), depth: fc.integer() }),
  );

/** A ledger, optionally carrying fields this version does not know. */
const ledgerWithUnknowns = () =>
  fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: 0, max: 200 }), { minLength: 0, maxLength: 6 }),
      fc.dictionary(unknownKey(), unknownValue(), { maxKeys: 4 }),
      fc.dictionary(unknownKey(), unknownValue(), { maxKeys: 3 }),
    )
    .map(([labels, topLevel, perRecord]) => {
      const base = toJSON(
        seedLedger(
          labels.map((label) => ({ label, state: 'active' })),
          instantAt(0),
        ),
      );

      return {
        ...base,
        ...topLevel,
        records: withUnknownRecordFields(/** @type {any} */ (base.records), perRecord),
      };
    });

describe('PT-15 — a ledger survives a round trip unchanged', () => {
  it('parses back to the same JSON it was serialised from', () => {
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        const round = toJSON(fromJSON(json));

        return stable(round) === stable(json);
      }),
      { numRuns: RUNS },
    );
  });

  it('preserves top-level fields this version does not understand', () => {
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        const round = /** @type {any} */ (toJSON(fromJSON(json)));

        for (const [key, value] of Object.entries(json)) {
          if (key === 'records') continue;
          if (JSON.stringify(round[key]) !== JSON.stringify(value)) return false;
        }

        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('preserves per-record fields this version does not understand', () => {
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        return recordsPreserved(json, /** @type {any} */ (toJSON(fromJSON(json))));
      }),
      { numRuns: RUNS },
    );
  });

  it('is stable across repeated round trips, not just the first', () => {
    // A single round trip can be lossless while the second is not — for
    // instance if unknown fields were collected into a wrapper that then became
    // an unknown field itself, growing the file on every run.
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        const once = toJSON(fromJSON(json));
        const twice = toJSON(fromJSON(once));
        const thrice = toJSON(fromJSON(twice));

        return stable(thrice) === stable(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('never leaks the internal unknown-field wrapper into the file', () => {
    // The mechanism must be invisible on disk. A literal `unknown_fields` key
    // in a ledger would be read as data by the next engine and nested forever.
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        const round = toJSON(fromJSON(json));

        return !Object.hasOwn(round, 'unknown_fields');
      }),
      { numRuns: RUNS },
    );
  });

  it('serialises byte-identically across two runs', () => {
    fc.assert(
      fc.property(ledgerWithUnknowns(), (json) => {
        const ledger = fromJSON(json);

        return serialiseLedger(toJSON(ledger)) === serialiseLedger(toJSON(ledger));
      }),
      { numRuns: RUNS },
    );
  });

  it('shows the generator actually produces unknown fields', () => {
    // Without them the law is a round-trip test of the fields this version
    // already knows about, which is the easy half.
    const samples = fc.sample(ledgerWithUnknowns(), { numRuns: 200, seed: 31 });
    const withUnknowns = samples.filter(hasUnknownTopLevelField);

    expect(withUnknowns.length).toBeGreaterThan(0);
  });

  it('a known field always wins a collision with an unknown one', () => {
    // Spread order matters: if an older engine somehow carried a stale
    // `ledger_version` in its unknown bag, it must not overwrite the real one.
    const round = /** @type {any} */ (
      toJSON(
        /** @type {any} */ ({
          ...fromJSON(toJSON(seedLedger([{ label: 1, state: 'active' }], instantAt(0)))),
          unknown_fields: { ledger_version: 999, future_thing: 'kept' },
        }),
      )
    );

    expect(round.ledger_version).toBe(1);
    expect(round.future_thing).toBe('kept');
  });
});

/**
 * A comparable serialisation with keys ordered.
 *
 * @param {unknown} value
 * @returns {string}
 */
function stable(value) {
  return serialiseLedger(value);
}

/**
 * @param {any} json
 * @param {any} round
 * @returns {boolean}
 */
function recordsPreserved(json, round) {
  for (const [id, record] of Object.entries(json.records)) {
    if (JSON.stringify(round.records[id]) !== JSON.stringify(record)) return false;
  }

  return true;
}

/**
 * @param {Record<string, unknown>} records
 * @param {Record<string, unknown>} extra
 * @returns {Record<string, unknown>}
 */
function withUnknownRecordFields(records, extra) {
  /** @type {Record<string, unknown>} */
  const output = {};

  for (const [id, record] of Object.entries(records)) {
    output[id] = { .../** @type {any} */ (record), ...extra };
  }

  return output;
}

/**
 * @param {Record<string, unknown>} json
 * @returns {boolean}
 */
function hasUnknownTopLevelField(json) {
  return Object.keys(json).some((key) => key.startsWith('sentiment') || key.startsWith('x_'));
}
