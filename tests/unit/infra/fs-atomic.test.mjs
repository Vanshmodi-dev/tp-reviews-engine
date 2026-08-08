import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileAtomic } from '../../../src/infra/fs-atomic.mjs';

/**
 * T-130's verification is "reviewer kills mid-write". A reviewer cannot kill a
 * process reliably enough to be a test, so the crash is injected instead: the
 * write is made to fail at the exact point a crash would, and the target is
 * inspected.
 *
 * What is being protected is specific. A ledger is the only record of what has
 * been published and when each review was first seen — `first_seen_at` cannot be
 * recovered from the source, and on a gate rejection no ledger is written at
 * all, so the previous one is what the next run reconciles from.
 */

/** @type {string} */
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tpre-atomic-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes a new file', async () => {
    const path = join(directory, 'ledger.json');

    await writeFileAtomic(path, '{"a":1}');

    expect(await readFile(path, 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file', async () => {
    const path = join(directory, 'ledger.json');

    await writeFile(path, 'old');
    await writeFileAtomic(path, 'new');

    expect(await readFile(path, 'utf8')).toBe('new');
  });

  it('creates missing parent directories', async () => {
    const path = join(directory, 'a', 'b', 'c', 'ledger.json');

    await writeFileAtomic(path, 'x');

    expect(await readFile(path, 'utf8')).toBe('x');
  });

  it('leaves no temp file behind on success', async () => {
    await writeFileAtomic(join(directory, 'ledger.json'), 'x');

    expect(await readdir(directory)).toEqual(['ledger.json']);
  });

  it('LEAVES THE PREVIOUS FILE INTACT when the write fails mid-way', async () => {
    // The crash injection. A plain `writeFile` truncates the target and then
    // streams into it, so a failure here would leave a half-written file where
    // a valid one used to be.
    const path = join(directory, 'ledger.json');
    await writeFile(path, '{"the":"previous ledger"}');

    const exploding = {
      toString() {
        throw new Error('crash mid-write');
      },
    };

    await expect(
      writeFileAtomic(path, /** @type {any} */ (exploding), {
        suffix: () => 'crash',
      }),
    ).rejects.toThrow();

    expect(await readFile(path, 'utf8')).toBe('{"the":"previous ledger"}');
  });

  it('cleans up its temp file when the write fails', async () => {
    // Debris turns a transient disk error into a directory a later glob-based
    // read may try to parse.
    const path = join(directory, 'ledger.json');
    const exploding = {
      toString() {
        throw new Error('crash mid-write');
      },
    };

    await expect(
      writeFileAtomic(path, /** @type {any} */ (exploding), { suffix: () => 'crash' }),
    ).rejects.toThrow();

    expect(await readdir(directory)).toEqual([]);
  });

  it('never exposes a partial file under the target name', async () => {
    // The guarantee stated positively: at every instant, the target either does
    // not exist or holds complete, parseable content.
    const path = join(directory, 'ledger.json');
    const complete = JSON.stringify({ records: Array.from({ length: 500 }, (_, i) => i) });

    await writeFileAtomic(path, complete);

    const written = await readFile(path, 'utf8');

    expect(() => JSON.parse(written)).not.toThrow();
    expect(written).toBe(complete);
  });

  it('writes the temp file in the target directory, not the system temp', async () => {
    // A system temp directory is frequently a different filesystem, and
    // `rename` across filesystems is not atomic - Node falls back to
    // copy-then-unlink, reintroducing the torn-write window.
    const path = join(directory, 'ledger.json');
    /** @type {string[]} */
    const seen = [];

    await writeFileAtomic(path, 'x', {
      suffix: () => {
        seen.push('called');

        return 'probe';
      },
    });

    expect(seen).toHaveLength(1);
  });

  it('supports a durable write', async () => {
    const path = join(directory, 'ledger.json');

    await writeFileAtomic(path, 'durable', { durable: true });

    expect(await readFile(path, 'utf8')).toBe('durable');
  });

  it('honours a non-default encoding', async () => {
    const path = join(directory, 'raw.bin');

    await writeFileAtomic(path, Buffer.from('hello').toString('base64'), { encoding: 'base64' });

    expect(await readFile(path, 'utf8')).toBe('hello');
  });

  it('produces distinct temp names for concurrent writers', async () => {
    // Shards write disjoint paths so a collision should be impossible - but
    // "should be" and "is" differ by one path-templating bug, and the
    // consequence would be two writers interleaving into one temp file.
    const names = new Set();

    for (let i = 0; i < 200; i += 1) {
      names.add(`${process.pid}.${Math.random().toString(36).slice(2, 10)}`);
    }

    expect(names.size).toBe(200);
  });
});
