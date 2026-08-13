/**
 * The `data` branch publisher (DEL-147).
 *
 * ## Hash-gating is the whole economy of this system (PUB-02, IR-06)
 *
 * Most harvests change nothing. A listing with 120 reviews that gained no new
 * ones produces byte-identical artifacts, and writing them anyway costs a
 * commit per shard per run — roughly fifty times the commit volume, for zero
 * information. The `data` branch then grows without bound, `git log` stops
 * answering "when did this actually change", and clone times climb for a
 * repository whose whole premise is that it is cheap to host.
 *
 * So identical bytes are not written. Not written and then discarded — **not
 * written**, so git has nothing staged and the commit does not happen either.
 *
 * ## Payload first, then state (PUB-01, EDR-025)
 *
 * The ordering is normative and the reasoning is asymmetric failure. Consider a
 * crash between the two writes:
 *
 * | Order | Result |
 * | --- | --- |
 * | **payload → state** | The payload is ahead of state. The next run re-reconciles, produces identical bytes, hash-gates them, and does nothing. **Self-healing.** |
 * | state → payload | State claims reviews the payload does not contain. The next run sees nothing to change and the payload stays wrong. **Silently permanent.** |
 *
 * The self-healing property depends entirely on this order and on
 * reconciliation being idempotent (PT-01). Neither is optional.
 *
 * ## One commit per shard, never per target (PUB-03, CON-13)
 *
 * Staging accumulates across every target in the shard and the commit happens
 * once at the end. Thirty targets that each committed would be thirty commits
 * describing one run.
 *
 * @module adapters/publisher/git-data
 */

import { readFile } from 'node:fs/promises';
import { relative as relativeTo } from 'node:path';

import { writeFileAtomic } from '../../infra/fs-atomic.mjs';
import { commitMessage, createGit } from '../../infra/git.mjs';
import { dataPaths } from './paths.mjs';
import { artifactUnchanged } from './unchanged.mjs';

/**
 * @param {object} options
 * @param {string} options.root        The `data` checkout.
 * @param {string} [options.remote]
 * @param {string} [options.branch]
 * @param {any} [options.logger]
 * @param {any} [options.git]          Injected for tests.
 * @returns {any}
 */
export function createGitDataPublisher({ root, remote = 'origin', branch = 'data', logger, git }) {
  const client = git ?? createGit({ cwd: root, logger });
  const paths = dataPaths(root);
  /** @type {Set<string>} */
  const staged = new Set();

  return {
    /**
     * Writes one target's artifacts, skipping any whose bytes are unchanged.
     *
     * @param {any} target
     * @returns {Promise<{ written: string[], skipped: string[] }>}
     */
    async stage(target) {
      /** @type {string[]} */
      const written = [];
      /** @type {string[]} */
      const skipped = [];

      for (const [name, artifact] of Object.entries(target.artifacts ?? {})) {
        const absolute = paths.artifact(target.clientSlug, target.listingKey, name);
        // Staged and reported by repository-relative path: an absolute path in
        // a commit is machine-specific, and the manifest is read on a different
        // machine from the one that wrote it.
        const path = relativeTo(root, absolute).replaceAll('\\', '/');
        const bytes = /** @type {any} */ (artifact).bytes;

        if (await unchanged(absolute, artifact)) {
          skipped.push(path);
          continue;
        }

        await writeFileAtomic(absolute, bytes);
        written.push(path);
        staged.add(path);
      }

      return { written, skipped };
    },

    /**
     * Commits everything staged so far, once (PUB-03).
     *
     * @param {object} input
     * @param {string} input.runId
     * @param {number} [input.listings]
     * @returns {Promise<{ committed: boolean, sha: string | null, files: number }>}
     */
    async commit({ runId, listings }) {
      const files = [...staged];

      if (files.length === 0) {
        // Nothing was written, so nothing is staged, so there is no commit.
        // This is the hash-gated no-op, and it is the common case.
        logger?.info?.('publish.no_changes', { branch });

        return { committed: false, sha: null, files: 0 };
      }

      await client.stage(files);

      const result = await client.commit(
        commitMessage({ branch, listings: listings ?? files.length, runId }),
      );

      staged.clear();

      return { ...result, files: files.length };
    },

    /**
     * @returns {Promise<any>}
     */
    push: () => client.push({ remote, branch }),

    /**
     * The bytes currently published, for hash comparison and for LKG.
     *
     * @param {string} clientSlug
     * @param {string} listingKey
     * @param {string} [name]
     * @returns {Promise<string | null>}
     */
    readCurrent: (clientSlug, listingKey, name = 'reviews') =>
      readOrNull(paths.artifact(clientSlug, listingKey, name)),

    /** @returns {string[]} */
    pending: () => [...staged],
  };
}

/**
 * Whether the candidate bytes match what is already on disk.
 *
 * Compared as bytes rather than by re-hashing, because the question PUB-02 asks
 * is literally "are these the same bytes" — and a hash comparison introduces a
 * second definition of sameness that can drift from the first.
 *
 * @param {string} absolute
 * @param {{ bytes: string, contentHash?: string }} artifact
 * @returns {Promise<boolean>}
 */
async function unchanged(absolute, artifact) {
  // By sealed content hash, not raw bytes: raw bytes carry `generated_at` and
  // differ on every run, so this comparison was never true and hash gating
  // never skipped anything (IR-06). See `unchanged.mjs`.
  return artifactUnchanged(await readOrNull(absolute), artifact);
}

/**
 * @param {string} absolute
 * @returns {Promise<string | null>}
 */
async function readOrNull(absolute) {
  try {
    return await readFile(absolute, 'utf8');
  } catch {
    // A missing file is a first publish, not an error. Distinguishing the two
    // matters elsewhere (IR-25) but not here: either way the bytes differ.
    return null;
  }
}

/**
 * Publishes payload then state, in that order (PUB-01).
 *
 * Written as one function rather than left to the caller precisely because the
 * ordering is the requirement. A caller that had to remember it would
 * eventually forget, and the failure is invisible until a crash lands between
 * the two writes.
 *
 * @param {object} input
 * @param {any} input.payload   The data-branch publisher.
 * @param {any} input.state     The state-branch publisher.
 * @param {string} input.runId
 * @param {number} input.listings
 * @returns {Promise<any>}
 */
export async function publishInOrder({ payload, state, runId, listings }) {
  const payloadResult = await payload.commit({ runId, listings });
  const payloadPush = payloadResult.committed
    ? await payload.push()
    : { pushed: true, attempts: 0 };

  // State only after the payload has actually landed. Committing state against
  // a payload that failed to push is exactly the inversion EDR-025 forbids —
  // state would claim reviews no published payload contains.
  if (!payloadPush.pushed) {
    return { order: 'payload-then-state', payload: payloadResult, push: payloadPush, state: null };
  }

  const stateResult = await state.commit({ runId, listings });
  const statePush = stateResult.committed ? await state.push() : { pushed: true, attempts: 0 };

  return {
    order: 'payload-then-state',
    payload: payloadResult,
    push: payloadPush,
    state: stateResult,
    statePush,
  };
}
