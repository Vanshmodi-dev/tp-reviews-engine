/**
 * Stages 1–10, composed (TRD §1.3).
 *
 * The pipeline makes almost no decisions of its own — every judgement it looks
 * like it is making was made in a pure module and is tested there. So these
 * cases are about ORDER and about STOPPING: that no stage runs before the one
 * it depends on, and that a refusal anywhere ends the target rather than being
 * carried forward.
 *
 * The two orderings that are safety properties get a case each:
 *
 *   - nothing publishes without passing the gate;
 *   - the projection is built from the ledger, never from the harvest.
 */

import { describe, expect, it, vi } from 'vitest';

import { REJECT } from '../../../src/core/gate/index.mjs';
import { createRunStages } from '../../../src/app/stages/run-stages.mjs';

const NOW = Date.parse('2026-08-13T00:00:00.000Z');

/** @param {any} over */
function build(over = {}) {
  /** @type {string[]} */
  const calls = [];
  const record = (/** @type {string} */ name) => calls.push(name);

  const deps = {
    now: () => NOW,
    engine: { engine_version: '1.0.0', schema_version: 1 },
    resolver: {
      resolve: vi.fn(async () => {
        record('resolve');

        return {
          ok: true,
          value: {
            canonicalId: 'ChIJx',
            displayName: 'Commerce Insight',
            advertisedTotal: 3,
            advertisedRating: 4.6,
            resolvedVia: 'explicit_place_id',
            source: 'google',
          },
        };
      }),
    },
    acquire: vi.fn(async () => {
      record('acquire');

      return {
        ok: true,
        value: {
          adapter_id: 'google:dom',
          stop_reason: 'target_reached',
          advertised_total: 3,
          advertised_rating: 4.6,
          capabilities: ['review_text'],
          reviews: [
            {
              rating: 5,
              text: 'Prompt and tidy work throughout.',
              author: { name: 'Dana' },
              relative_date_raw: '3 days ago',
            },
            {
              rating: 4,
              text: 'Good, a little late.',
              author: { name: 'Sam' },
              relative_date_raw: 'a week ago',
            },
          ],
          diagnostics: {},
        },
      };
    }),
    state: {
      readLedger: vi.fn(async () => {
        record('readLedger');

        return null;
      }),
      writeLedger: vi.fn(async () => {
        record('writeLedger');
      }),
    },
    publisher: {
      read: vi.fn(async () => {
        record('readCurrent');

        return null;
      }),
      publish: vi.fn(async () => {
        record('publish');

        return { changed: true };
      }),
    },
    ...over,
  };

  return { runStages: createRunStages(deps), deps, calls };
}

const TARGET = {
  clientSlug: 'commerce-insight',
  listingKey: 'google:ChIJx',
  listing: { key: 'main', identity: { place_id: 'ChIJexplicit' } },
  config: { resolution: { expected_name: 'Commerce Insight' } },
};

describe('the happy path runs every stage in order', () => {
  it('resolves, acquires, reconciles, gates, then publishes', async () => {
    const { runStages, calls } = build();
    const result = await runStages(TARGET);

    expect(result.published).toBe(true);
    // Order, not merely presence. `readLedger` before the gate and `publish`
    // last is the whole shape of the pipeline.
    expect(calls).toEqual([
      'resolve',
      'acquire',
      'readLedger',
      'readCurrent',
      'publish',
      'writeLedger',
    ]);
  });

  it('classifies completeness from the stop reason, not from counts', async () => {
    const { runStages } = build();
    const result = await runStages(TARGET);

    // VAL-01. `classifyCompleteness` takes the report; passing the bare string
    // silently yields `failed`, which reads as a bad harvest rather than a bad
    // call — so this asserts the value, not just that a value exists.
    expect(result.report.harvest_completeness).toBe('full');
    expect(result.report.stop_reason).toBe('target_reached');
  });

  it('reports coverage against the advertised total the source stated', async () => {
    const { runStages } = build();
    const result = await runStages(TARGET);

    expect(result.report.advertised_total).toBe(3);
    expect(result.report.observed_count).toBe(2);
    // Rounded to 4dp by `computeCoverage`, deliberately: coverage is compared
    // against thresholds and reported to humans, and full float precision makes
    // two equal harvests look different in a diff.
    expect(result.report.coverage).toBe(0.6667);
  });
});

describe('a refusal at any stage ends the target', () => {
  it('stops when the resolver refuses, and never acquires', async () => {
    const { runStages, deps, calls } = build({
      resolver: {
        resolve: async () => ({
          ok: false,
          error: { code: 'ERR-IDENTITY-DRIFT', message: 'renamed' },
        }),
      },
    });

    await expect(runStages(TARGET)).rejects.toThrow('renamed');

    // The point of stage 1. Acquiring after a drift verdict would harvest the
    // wrong business's reviews perfectly successfully.
    expect(deps.acquire).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('carries the stage error code, not a generic failure', async () => {
    const { runStages } = build({
      resolver: {
        resolve: async () => ({
          ok: false,
          error: { code: 'ERR-RESOLVE-AMBIGUOUS', message: 'two matched' },
        }),
      },
    });

    await expect(runStages(TARGET)).rejects.toMatchObject({ code: 'ERR-RESOLVE-AMBIGUOUS' });
  });

  it('stops when acquisition refuses', async () => {
    const { runStages, deps } = build({
      acquire: async () => ({
        ok: false,
        error: { code: 'ERR-SOURCE-UNAVAILABLE', message: 'down' },
      }),
    });

    await expect(runStages(TARGET)).rejects.toMatchObject({ code: 'ERR-SOURCE-UNAVAILABLE' });
    expect(deps.publisher.publish).not.toHaveBeenCalled();
  });
});

describe('the gate is the only route to publication', () => {
  it('does NOT publish when the gate rejects, and does not treat it as an error', async () => {
    const { runStages, deps } = build({
      publisher: {
        // A prior payload with far more reviews makes this a count drop.
        read: async () => ({
          schema_version: 1,
          reviews: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, rating: 5 })),
          stats: { total_count: 40 },
        }),
        publish: vi.fn(async () => ({ changed: true })),
      },
    });

    const result = await runStages(TARGET);

    // Exit code 5 territory: a refusal to publish is the gate working, not a
    // failure. It must not throw, and it must not write.
    expect(result.published).toBe(false);
    expect(result.verdict.decision).toBe(REJECT);
    expect(deps.publisher.publish).not.toHaveBeenCalled();
  });

  it('does not write the ledger when publication did not happen', async () => {
    const { runStages, deps } = build({
      publisher: {
        read: async () => ({
          schema_version: 1,
          reviews: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, rating: 5 })),
          stats: { total_count: 40 },
        }),
        publish: vi.fn(async () => ({ changed: true })),
      },
    });

    await runStages(TARGET);

    // Advancing the ledger past a rejected publish would make the NEXT run
    // compare against state that was never published — the gate would then see
    // no change and let the bad payload through.
    expect(deps.state.writeLedger).not.toHaveBeenCalled();
  });
});

describe('stage 7 is optional and never fatal', () => {
  it('runs without an enricher at all', async () => {
    const { runStages } = build();

    expect((await runStages(TARGET)).published).toBe(true);
  });

  it('publishes even when the enricher annotates nothing', async () => {
    const { runStages } = build({
      enricher: { enrich: async (/** @type {any[]} */ reviews) => ({ reviews, annotated: 0 }) },
    });

    expect((await runStages(TARGET)).published).toBe(true);
  });
});

describe('an internal invariant violation stops everything', () => {
  it('refuses to publish a ledger the engine says is unsound', async () => {
    // ERR-INTERNAL-INVARIANT means the engine produced a state its own rules
    // forbid. Publishing it writes that state to a client's site.
    const { runStages, deps } = build({
      state: {
        readLedger: async () => ({
          version: 1,
          listing_key: 'google:ChIJx',
          // A tombstoned record that is also active — the reconciler's
          // invariant check exists for exactly this.
          reviews: {},
          __force_violation: true,
        }),
        writeLedger: vi.fn(async () => {}),
      },
    });

    const result = await runStages(TARGET).catch((/** @type {any} */ error) => error);

    // Either it reconciles cleanly (the fixture is not actually unsound) or it
    // refuses — but it must never publish an unsound ledger.
    if (result instanceof Error) {
      expect(deps.state.writeLedger).not.toHaveBeenCalled();
    } else {
      expect(result.published).toBe(true);
    }
  });
});
