/**
 * Atomic file writes (T-130, LEDG-06, TR-STOR-001).
 *
 * ============================================================================
 * THE ONLY PERMITTED WRITE PATH. Nothing else in the engine may call
 * `writeFile` against a real artifact or state file.
 * ============================================================================
 *
 * ## Why a plain write is not acceptable here
 *
 * `writeFile` truncates the target and then streams into it. A crash, an OOM
 * kill, or a runner timeout part-way through leaves a **half-written file where
 * a valid one used to be** — and in this system the previous file is frequently
 * the only surviving copy of something that matters:
 *
 * - A ledger is the only record of what has been published and when each review
 *   was first seen. `first_seen_at` cannot be recovered from the source.
 * - On a gate rejection the run writes no ledger at all, so the previous one is
 *   what the next run reconciles from.
 * - A truncated ledger reads as `unreadable`, which the gate correctly refuses
 *   to treat as a first publish — so a torn write does not silently wipe a
 *   payload, but it does halt that client until a human intervenes.
 *
 * Write-temp-then-rename makes the exposure impossible instead of unlikely.
 * `rename` within a filesystem is atomic: an observer sees either the whole old
 * file or the whole new one, never a mixture.
 *
 * ## Durability, and its cost
 *
 * `fsync` on the temp file before the rename is what makes the guarantee
 * survive a power loss rather than only a process crash. On the CI runners this
 * engine targets, a process crash is the realistic failure and an `fsync` per
 * file costs real time across thousands of writes — so it is available and
 * **off by default**, with the trade-off stated rather than buried.
 *
 * The parent directory is synced after the rename when durability is requested,
 * because on several filesystems the rename itself is only durable once the
 * directory entry is flushed.
 *
 * @module infra/fs-atomic
 */

import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * @typedef {object} AtomicWriteOptions
 * @property {boolean} [durable]   fsync before rename. Default false. See above.
 * @property {string} [encoding]   Default `utf8`.
 * @property {() => string} [suffix] Temp-name suffix source. Injected for testing.
 */

/**
 * Writes a file atomically.
 *
 * The temp file is created **in the target's own directory**, deliberately. A
 * system temp directory is frequently a different filesystem, and `rename`
 * across filesystems is not atomic — Node falls back to copy-then-unlink, which
 * reintroduces exactly the torn-write window this function exists to close.
 *
 * @param {string} path
 * @param {string} contents
 * @param {AtomicWriteOptions} [options]
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(path, contents, options = {}) {
  const directory = dirname(path);
  const encoding = /** @type {BufferEncoding} */ (options.encoding ?? 'utf8');
  const temporary = join(directory, tempName(path, options.suffix));

  await mkdir(directory, { recursive: true });

  try {
    if (options.durable === true) {
      await writeDurable(temporary, contents, encoding);
    } else {
      await writeFile(temporary, contents, encoding);
    }

    await rename(temporary, path);

    if (options.durable === true) await syncDirectory(directory);
  } catch (error) {
    // The temp file must not outlive a failed write. Leaving them behind turns
    // a transient disk error into a directory full of debris that a later
    // glob-based read may try to parse.
    await unlink(temporary).catch(() => undefined);

    throw error;
  }
}

/**
 * @param {string} path
 * @param {string} contents
 * @param {BufferEncoding} encoding
 * @returns {Promise<void>}
 */
async function writeDurable(path, contents, encoding) {
  const handle = await open(path, 'w');

  try {
    await handle.writeFile(contents, encoding);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} directory
 * @returns {Promise<void>}
 */
async function syncDirectory(directory) {
  let handle;

  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform - notably it fails on
    // Windows. The write itself already succeeded; failing the whole operation
    // because the extra durability step is unavailable would be worse than
    // proceeding without it.
  } finally {
    await handle?.close();
  }
}

/**
 * A temp name that cannot collide between concurrent writers.
 *
 * Shards run in parallel and write disjoint client paths (EDR-035), so a
 * collision should be impossible by construction — but "should be impossible"
 * and "is impossible" differ by one path-templating bug, and the consequence
 * would be two writers interleaving into one temp file.
 *
 * @param {string} path
 * @param {(() => string)} [suffix]
 * @returns {string}
 */
function tempName(path, suffix) {
  // `basename`, not a manual split on '/'. This engine develops on Windows and
  // runs on Linux; hand-rolling the separator produced a temp path with the
  // whole absolute path embedded in the filename, which failed with ENOENT on
  // Windows and would have worked everywhere else.
  const base = basename(path);
  const unique = suffix === undefined ? `${process.pid}.${randomSuffix()}` : suffix();

  return `.${base}.${unique}.tmp`;
}

/** Base-36 gives the most entropy per character from `Number.toString`. */
const BASE36 = 36;

/** Eight characters of base-36 is ~41 bits: ample for a per-process temp name. */
const SUFFIX_LENGTH = 10;

/**
 * @returns {string}
 */
function randomSuffix() {
  return Math.random().toString(BASE36).slice(2, SUFFIX_LENGTH);
}
