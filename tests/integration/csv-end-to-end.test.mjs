/**
 * `tpre harvest` end to end, over the CSV adapter.
 *
 * MS-5's exit criterion was "the CSV path works end to end", and until SP-8 it
 * could not be run: every stage component existed, and nothing composed them.
 * This is that claim, executed — real files, real ledger, real artifacts, no
 * stubs anywhere below the composition root.
 *
 * It uses the CSV adapter deliberately. `google:dom` has not been built (it is
 * the next piece), and the API adapters need credentials. CSV needs neither a
 * browser nor a network, so this can be a blocking test rather than an opt-in
 * one — which is the difference between a claim that is checked on every push
 * and a claim somebody remembers to verify.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildDependencies } from '../../src/cli/composition.mjs';

const CSV = `author_name,rating,date,text
Dana R.,5,2026-07-28,Turned up on time and cleared the blockage in twenty minutes.
Michael O'Brien,5,2026-06-15,Second time we have used them. Fair price and no upselling.
Priya N.,4,2026-02-19,Good quick work on a boiler that three other people had seen.
`;

/** @type {string} */
let root;
/** @type {any} */
let deps;
/** @type {any} */
let target;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tpre-e2e-'));
  mkdirSync(join(root, 'in'), { recursive: true });

  const source = join(root, 'in', 'reviews.csv');

  writeFileSync(source, CSV, 'utf8');

  deps = buildDependencies({
    env: {},
    stateRoot: join(root, 'state'),
    dataRoot: join(root, 'data'),
  });

  target = {
    clientSlug: 'e2e-client',
    listingKey: 'main',
    listing: { key: 'main', adapter: 'csv:file', source: 'csv', source_file: source },
    config: { resolution: { expected_name: 'E2E Client' } },
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a target goes through every stage and reaches disk', () => {
  /** @type {any} */
  let first;

  it('publishes', async () => {
    first = await deps.runStages(target);

    expect(first.published).toBe(true);
    expect(first.verdict.decision).toBe('ACCEPT');
  });

  it('harvested every row, quarantining none', async () => {
    expect(first.report.observed_count).toBe(3);
    expect(first.report.quarantined).toEqual([]);
  });

  it('classified completeness from the stop reason', async () => {
    // VAL-01. `target_reached` is the navigator's word, not a count comparison.
    expect(first.report.stop_reason).toBe('target_reached');
    expect(first.report.harvest_completeness).toBe('full');
  });

  it('reports coverage as null, because a CSV advertises no total', async () => {
    // Deriving it from the row count would make coverage permanently 1.0 and
    // G-08 — the rule that catches a truncated harvest — permanently silent.
    expect(first.report.advertised_total).toBeNull();
    expect(first.report.coverage).toBeNull();
  });

  it('wrote the four artifacts', async () => {
    expect(
      first.publish.written.map((/** @type {string} */ p) => p.split(/[\\/]/).pop()).sort(),
    ).toEqual(['index.json', 'latest.json', 'reviews.json', 'stats.json']);
  });

  it('produced a schema-valid payload with real reviews in it', async () => {
    const written = first.publish.written.find((/** @type {string} */ p) =>
      p.endsWith('reviews.json'),
    );
    const payload = JSON.parse(readFileSync(written, 'utf8'));

    expect(payload.schema_version).toBe(1);
    expect(payload.reviews).toHaveLength(3);
    expect(payload.stats.total_count).toBe(3);

    // Selected by author, not by position. Publication ORDER is
    // `core/project/order.mjs`'s decision and is tested there; asserting it
    // here would couple this test to a rule it is not about.
    const review = payload.reviews.find((/** @type {any} */ r) => r.author_name === 'Dana R.');

    // Every one of these is the output of a different stage: identity from
    // stage 4, the date from the pinner, the text from the normalizer.
    expect(review.id).toMatch(/^[0-9a-f]{32}$/u);
    expect(review.rating).toBe(5);
    expect(review.date).toBe('2026-07-28');
    expect(review.text).toContain('cleared the blockage');
  });

  it('never publishes the author key (TR-HASH-020)', async () => {
    const written = first.publish.written.find((/** @type {string} */ p) =>
      p.endsWith('reviews.json'),
    );
    const bytes = readFileSync(written, 'utf8');

    // It is an internal matching key. Publishing it would put a stable
    // cross-listing identifier for a real person on a client's website.
    expect(bytes).not.toContain('author_key');
  });

  it('wrote a ledger that reads back', async () => {
    const read = await deps.state.readLedger('e2e-client', 'main');

    expect(read.outcome).toBe('found');
    expect(read.value.records.size).toBe(3);
  });
});

describe('MS-7 — a second identical run writes nothing (FR-065, IR-06)', () => {
  /** @type {any} */
  let second;

  it('skips every artifact', async () => {
    second = await deps.runStages(target);

    // The headline exit criterion of PH-18, and it did not hold until the hash
    // gating was fixed: both publishers compared RAW bytes, which carry
    // `generated_at` and `stats.last_full_harvest_at`. Both advance every run
    // by construction, so nothing was ever equal and every run rewrote every
    // artifact for every client — the `data` branch growing with traffic
    // rather than with change.
    expect(second.publish.written).toEqual([]);
    expect(second.publish.skipped).toHaveLength(4);
  });

  it('still reconciles to the same three records', async () => {
    const read = await deps.state.readLedger('e2e-client', 'main');

    // Identity is content-derived, so an unchanged source must reconcile to
    // exactly the same records. Growth here would mean the same reviews were
    // being seen as new every run.
    expect(read.value.records.size).toBe(3);
  });
});

describe('a run with a real change still publishes', () => {
  it('writes when a review is added', async () => {
    // The other half of the guarantee, and the one that makes the test above
    // meaningful: a gate that skips everything would also pass it.
    writeFileSync(
      join(root, 'in', 'reviews.csv'),
      `${CSV}Nia K.,5,2026-08-01,Excellent and very tidy work throughout.
`,
      'utf8',
    );

    const third = await deps.runStages(target);

    expect(third.publish.written).toHaveLength(4);
    expect(third.report.observed_count).toBe(4);
  });
});
