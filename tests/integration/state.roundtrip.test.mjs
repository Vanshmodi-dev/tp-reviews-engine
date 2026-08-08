import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toJSON } from '../../src/core/model/ledger.mjs';
import { serialiseLedger } from '../../src/core/project/serialise.mjs';
import { createFilesystemPublisher } from '../../src/adapters/publisher/filesystem.mjs';
import { createGitState } from '../../src/adapters/state/git-state.mjs';
import { assertSafeSegment } from '../../src/infra/path-segment.mjs';
import { instantAt, seedLedger } from '../helpers/reconcile-generators.mjs';
import { identity } from '../helpers/reconcile-input.mjs';

/**
 * MS-3's demo (T-152): write a ledger, read it back, re-serialise it, and get
 * the same bytes — through the real adapter, on a real filesystem.
 */

/** @type {string} */
let root;
/** @type {any} */
let state;
/** @type {any} */
let publisher;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tpre-state-'));
  state = createGitState({ root: join(root, 'state') });
  publisher = createFilesystemPublisher({ root: join(root, 'data') });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ledgerOf = () =>
  seedLedger(
    [
      { label: 1, state: 'active' },
      { label: 2, state: 'tombstoned' },
    ],
    instantAt(0),
  );

describe('the ledger survives a real write and read', () => {
  it('round-trips byte-identically', async () => {
    const before = ledgerOf();

    await state.writeLedger('acme-dental', 'main', before);
    const read = await state.readLedger('acme-dental', 'main');

    expect(read.outcome).toBe('found');
    // Canonical bytes on both sides. Reading back yields key-sorted objects
    // because that is what was written; comparing raw `JSON.stringify` would
    // compare insertion order, which is not what the file records.
    expect(serialiseLedger(toJSON(read.value))).toBe(serialiseLedger(toJSON(before)));
  });

  it('writes a pretty-printed file with a trailing newline (TR-PROJ-011)', async () => {
    await state.writeLedger('acme-dental', 'main', ledgerOf());
    const text = await readFile(state.paths.ledger('acme-dental', 'main'), 'utf8');

    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "client_slug"');
  });

  it('produces identical bytes on a second write of the same ledger', async () => {
    // What hash-gating depends on. Different bytes for the same data means
    // every run commits.
    const ledger = ledgerOf();
    const path = state.paths.ledger('acme-dental', 'main');

    await state.writeLedger('acme-dental', 'main', ledger);
    const first = await readFile(path, 'utf8');

    await state.writeLedger('acme-dental', 'main', ledger);

    expect(await readFile(path, 'utf8')).toBe(first);
  });

  it('leaves no temp file behind', async () => {
    await state.writeLedger('acme-dental', 'main', ledgerOf());
    const entries = await readdir(join(root, 'state', 'ledgers', 'acme-dental'));

    expect(entries).toEqual(['main.json']);
  });

  it('preserves a field written by a newer engine version (TR-STOR-003)', async () => {
    // The rollback case: `state` is a git branch, so running an older engine
    // against a newer ledger is expected, not exceptional.
    const path = state.paths.ledger('acme-dental', 'main');
    const base = /** @type {any} */ (toJSON(ledgerOf()));

    // Records are frozen, so the newer-engine fields are added by building new
    // objects rather than by mutating the ones the ledger handed back.
    const asJson = {
      ...base,
      sentiment_model_version: 'v7',
      records: Object.fromEntries(
        Object.entries(base.records).map(([id, record]) => [
          id,
          { .../** @type {any} */ (record), moderation_flag: 'reviewed' },
        ]),
      ),
    };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(asJson, null, 2)}\n`);

    const read = await state.readLedger('acme-dental', 'main');
    await state.writeLedger('acme-dental', 'main', read.value);

    const after = JSON.parse(await readFile(path, 'utf8'));

    expect(after.sentiment_model_version).toBe('v7');
    expect(after.records[identity(1)].moderation_flag).toBe('reviewed');
  });
});

describe('the three read outcomes are kept apart (IR-25)', () => {
  it('reports absent when there is genuinely no ledger', async () => {
    const read = await state.readLedger('acme-dental', 'main');

    expect(read.outcome).toBe('absent');
    expect(read.value).toBeNull();
  });

  it('reports unreadable for invalid JSON, NOT absent', async () => {
    // The distinction the whole module exists to preserve. Collapsing these
    // makes a corrupt ledger read as a first run, and the gate's first-publish
    // exception then waves an empty payload over a healthy one.
    const path = state.paths.ledger('acme-dental', 'main');

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"records": {', 'utf8');
    const read = await state.readLedger('acme-dental', 'main');

    expect(read.outcome).toBe('unreadable');
    expect(read.reason).toContain('could not parse');
  });

  it('reports unreadable for valid JSON that is not a ledger', async () => {
    // A truncated write can leave parseable JSON missing everything that
    // matters. Treating it as a ledger reconciles against an invented shape.
    const path = state.paths.ledger('acme-dental', 'main');

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"hello":"world"}', 'utf8');
    const read = await state.readLedger('acme-dental', 'main');

    expect(read.outcome).toBe('unreadable');
    expect(read.reason).toContain('not a usable ledger');
  });

  it('reports unreadable for a JSON array', async () => {
    const path = state.paths.ledger('acme-dental', 'main');

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '[]', 'utf8');

    expect((await state.readLedger('acme-dental', 'main')).outcome).toBe('unreadable');
  });
});

describe('health records are append-only (HLTH-01, EDR-033)', () => {
  it('appends rather than rewriting', async () => {
    // A read-modify-write of a shared file loses whichever concurrent record
    // lost the race, silently, for the runs most likely to be interesting.
    for (let run = 1; run <= 3; run += 1) {
      await state.appendHealth('acme-dental', 'main', { run, ok: true });
    }

    const records = await state.readHealth('acme-dental', 'main');

    expect(records.map((/** @type {any} */ r) => r.run)).toEqual([1, 2, 3]);
  });

  it('survives concurrent appends without losing a record', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        state.appendHealth('acme-dental', 'main', { run: i, ok: true }),
      ),
    );

    expect(await state.readHealth('acme-dental', 'main')).toHaveLength(20);
  });

  it('drops a truncated final line rather than failing the whole read', async () => {
    // Health records are diagnostics. Losing the last one to a crash is
    // acceptable; refusing to read any of them because of it is not.
    await state.appendHealth('acme-dental', 'main', { run: 1 });
    await writeFile(state.paths.health('acme-dental', 'main'), '{"run":1}\n{"run":2', {
      flag: 'w',
    });

    expect(await state.readHealth('acme-dental', 'main')).toEqual([{ run: 1 }]);
  });

  it('returns an empty list when no health file exists', async () => {
    expect(await state.readHealth('nobody', 'main')).toEqual([]);
  });
});

describe('budgets and breakers persist', () => {
  it('round-trips a budget durably', async () => {
    await state.writeBudget('google', { hourKey: '2026-03-01T12', hourCount: 4 });
    const read = await state.readBudget('google');

    expect(read.outcome).toBe('found');
    expect(read.value.hourCount).toBe(4);
  });

  it('round-trips breaker state per source-access pair', async () => {
    await state.writeBreaker('google', 'api', { state: 'open', trips: 2 });
    await state.writeBreaker('google', 'dom', { state: 'closed', trips: 0 });

    expect((await state.readBreaker('google', 'api')).value.state).toBe('open');
    expect((await state.readBreaker('google', 'dom')).value.state).toBe('closed');
  });
});

describe('path templates refuse unsafe segments', () => {
  it('rejects traversal rather than sanitising it', () => {
    // Silently rewriting `../../etc` into `etc` produces a path that works and
    // is not the one anybody asked for.
    expect(() => assertSafeSegment('../../etc', 'client slug')).toThrow(/unsafe/u);
    expect(() => assertSafeSegment('a/b', 'client slug')).toThrow(/unsafe/u);
    expect(() => assertSafeSegment('', 'client slug')).toThrow(/unsafe/u);
    expect(() => assertSafeSegment('UPPER', 'client slug')).toThrow(/unsafe/u);
  });

  it('accepts an ordinary slug', () => {
    expect(assertSafeSegment('acme-dental', 'client slug')).toBe('acme-dental');
    expect(assertSafeSegment('main', 'listing key')).toBe('main');
  });

  it('refuses to write a ledger for an unsafe slug', async () => {
    await expect(state.writeLedger('../escape', 'main', ledgerOf())).rejects.toThrow(/unsafe/u);
  });
});

describe('the filesystem publisher hash-gates its writes (FR-065)', () => {
  const artifacts = () => ({
    reviews: { bytes: '{"a":1}', contentHash: 'h1' },
    schemaOrg: { bytes: '{"b":2}', contentHash: 'h2' },
  });

  it('writes on the first publish', async () => {
    const result = await publisher.stage({
      clientSlug: 'acme-dental',
      listingKey: 'main',
      artifacts: artifacts(),
    });

    expect(result.written).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it('SKIPS a second publish of identical bytes', async () => {
    // Without this every run commits every artifact for every client, and the
    // git history stops being an audit log.
    const target = { clientSlug: 'acme-dental', listingKey: 'main', artifacts: artifacts() };

    await publisher.stage(target);
    const second = await publisher.stage(target);

    expect(second.written).toEqual([]);
    expect(second.skipped).toHaveLength(2);
  });

  it('writes again when the bytes change', async () => {
    await publisher.stage({
      clientSlug: 'acme-dental',
      listingKey: 'main',
      artifacts: artifacts(),
    });

    const changed = await publisher.stage({
      clientSlug: 'acme-dental',
      listingKey: 'main',
      artifacts: { reviews: { bytes: '{"a":2}', contentHash: 'h3' } },
    });

    expect(changed.written).toHaveLength(1);
  });

  it('maps a camelCase artifact key to a kebab-case filename', async () => {
    await publisher.stage({
      clientSlug: 'acme-dental',
      listingKey: 'main',
      artifacts: artifacts(),
    });

    const files = await readdir(join(root, 'data', 'acme-dental', 'main'));

    expect(files.sort()).toEqual(['reviews.json', 'schema-org.json']);
  });

  it('keeps absent and unreadable apart when reading the current payload', async () => {
    expect((await publisher.readCurrent('acme-dental', 'main')).outcome).toBe('absent');

    await publisher.stage({
      clientSlug: 'acme-dental',
      listingKey: 'main',
      artifacts: { reviews: { bytes: 'not json', contentHash: 'h' } },
    });

    expect((await publisher.readCurrent('acme-dental', 'main')).outcome).toBe('unreadable');
  });
});
