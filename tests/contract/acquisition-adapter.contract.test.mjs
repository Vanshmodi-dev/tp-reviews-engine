import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCsvAdapter } from '../../src/adapters/acquisition/file-csv/index.mjs';
import { STOP_REASONS, classifyCompleteness } from '../../src/core/index.mjs';

/**
 * The `AcquisitionPort` contract suite (T-179, TR-EXT-P-021).
 *
 * ## Written before the DOM adapter exists, and reusable unchanged
 *
 * `runAcquisitionContract` takes a factory and a small set of scenarios. Every
 * adapter — CSV now, DOM and the two APIs later — is expected to pass it
 * without a single source-specific assertion being added.
 *
 * That constraint is the point. An adapter suite written against one
 * implementation encodes that implementation's quirks as requirements, and the
 * second adapter then "fails the contract" for reasons that are really the
 * first adapter's habits. Writing it first, against the interface, is what
 * makes it a contract rather than a description.
 *
 * ## A note on the plan's cross-reference
 *
 * IMPL-PLAN T-179 cites "the nine assertions of §52.2". TRD §52.2 is the schema
 * inventory and contains no such list, so the assertions below are derived from
 * the port's own documented guarantees in `ports/acquisition.mjs` and from
 * TR-EXT-P-021. The discrepancy is recorded rather than guessed around.
 */

/**
 * Runs the contract against one adapter.
 *
 * @param {string} name
 * @param {() => Promise<{ adapter: any, scenarios: any }>} setup
 * @returns {void}
 */
export function runAcquisitionContract(name, setup) {
  describe(`AcquisitionPort contract — ${name}`, () => {
    /** @type {any} */
    let adapter;
    /** @type {any} */
    let scenarios;

    beforeAll(async () => {
      ({ adapter, scenarios } = await setup());
    });

    it('1. declares a stable id', () => {
      // The id lands in every payload's provenance block, so it is part of the
      // published contract, not an internal label.
      expect(adapter.id).toEqual(expect.any(String));
      expect(adapter.id).not.toBe('');
    });

    it('2. declares its capabilities honestly', () => {
      // What the adapter COULD supply. This is what explains a null: "this
      // adapter cannot see owner replies" is a different fact from "this review
      // has no owner reply".
      const capabilities = adapter.capabilities();

      expect(Array.isArray(capabilities)).toBe(true);
      expect(capabilities.length).toBeGreaterThan(0);
      expect(new Set(capabilities).size).toBe(capabilities.length);
    });

    it('3. returns a Result rather than throwing on an expected failure', async () => {
      // A blocked source, a missing file, a bad config: all values. An adapter
      // that threw would take down the whole run instead of failing one target.
      const result = await adapter.harvest(scenarios.misconfigured);

      expect(result.ok).toBe(false);
      expect(result.error.code).toMatch(/^ERR-/u);
      expect(result.error.message).toEqual(expect.any(String));
    });

    it('4. reports a stop reason from the documented vocabulary', async () => {
      const result = await adapter.harvest(scenarios.healthy);

      expect(result.ok).toBe(true);
      expect(STOP_REASONS).toContain(result.value.stop_reason);
    });

    it('5. NEVER reports completeness itself (VAL-01)', async () => {
      // The adapter reports why it stopped; completeness is derived from that
      // and nowhere else. An adapter that reported completeness would be making
      // a judgement it has no standing to make - and the tempting judgement,
      // comparing counts, is wrong in both directions and silently so.
      const result = await adapter.harvest(scenarios.healthy);

      expect(Object.hasOwn(result.value, 'completeness')).toBe(false);
      expect(['full', 'full_capped', 'partial', 'failed']).not.toContain(result.value.stop_reason);
    });

    it('6. yields reviews the pipeline can normalise', async () => {
      const result = await adapter.harvest(scenarios.healthy);

      expect(result.value.reviews.length).toBeGreaterThan(0);

      for (const review of result.value.reviews) {
        // The shape every downstream stage assumes. Not the full normalised
        // record - that is the normaliser's job - but the fields it needs.
        expect(review).toHaveProperty('author');
        expect(review).toHaveProperty('rating');
        expect(review).toHaveProperty('source');
      }
    });

    it('7. reports advertised figures as the source stated them, or null', async () => {
      // Never invented. Deriving `advertised_total` from the observed count
      // would make coverage permanently 1.0 and G-08 permanently silent.
      const result = await adapter.harvest(scenarios.healthy);

      for (const field of ['advertised_total', 'advertised_rating']) {
        const value = result.value[field];

        expect(value === null || typeof value === 'number').toBe(true);
      }
    });

    it('8. reports a cap it was given as cap_reached, not as completion', async () => {
      // Stopping at OUR ceiling is a different fact from reaching the end of
      // the data, and conflating them makes a capped harvest look complete -
      // after which absence below the cap starts counting toward deletion.
      const result = await adapter.harvest(scenarios.capped);

      expect(result.value.stop_reason).toBe('cap_reached');
      expect(classifyCompleteness({ stop_reason: result.value.stop_reason })).toBe('full_capped');
      expect(result.value.reviews.length).toBeLessThanOrEqual(scenarios.capped.cap);
    });

    it('9. isolates a bad record rather than failing the whole harvest', async () => {
      // The rest of the data is still worth having. An all-or-nothing adapter
      // means one malformed record removes a client's entire review set, and it
      // recurs every run until a human finds it.
      const result = await adapter.harvest(scenarios.partiallyInvalid);

      expect(result.ok).toBe(true);
      expect(result.value.reviews.length).toBeGreaterThan(0);
      expect(result.value.diagnostics.rejected_rows.length).toBeGreaterThan(0);
    });

    it('10. is deterministic: the same input yields the same output', async () => {
      // Everything downstream assumes this. A non-deterministic adapter makes
      // PT-12 unprovable and every payload hash unstable.
      const first = await adapter.harvest(scenarios.healthy);
      const second = await adapter.harvest(scenarios.healthy);

      expect(JSON.stringify(second.value.reviews)).toBe(JSON.stringify(first.value.reviews));
    });
  });
}

// ---------------------------------------------------------------------------
// The CSV adapter, run against the contract.
// ---------------------------------------------------------------------------

/** @type {string} */
let directory;

const VALID = [
  'author_name,rating,date,text',
  'Dana Smith,5,2026-01-15,"Lovely, quick service"',
  'Alex Jones,4,2026-01-20,Good',
  'Sam Patel,3,2026-02-01,"Fine, but slow"',
].join('\n');

const PARTIALLY_INVALID = [
  'author_name,rating,date,text',
  'Dana Smith,5,2026-01-15,Good',
  'Broken Row,9,2026-01-16,Rating out of range',
  ',4,2026-01-17,Missing author',
  'Alex Jones,4,2026-01-20,Also good',
].join('\n');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tpre-csv-'));

  await writeFile(join(directory, 'valid.csv'), VALID, 'utf8');
  await writeFile(join(directory, 'partially-invalid.csv'), PARTIALLY_INVALID, 'utf8');
  await writeFile(join(directory, 'malformed.csv'), 'not,a,review\nfile,at,all', 'utf8');
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

runAcquisitionContract('csv:file', async () => ({
  adapter: createCsvAdapter(),
  scenarios: {
    healthy: { listing: { source_file: join(directory, 'valid.csv') }, cap: 100 },
    capped: { listing: { source_file: join(directory, 'valid.csv') }, cap: 2 },
    partiallyInvalid: {
      listing: { source_file: join(directory, 'partially-invalid.csv') },
      cap: 100,
    },
    misconfigured: { listing: {}, cap: 100 },
  },
}));
