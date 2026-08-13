/**
 * The filesystem publisher (T-151) — the development default.
 *
 * Writes the artifact set to a local directory instead of a `data` checkout, so
 * the whole pipeline can be exercised end to end with no git remote, no
 * credentials, and no possibility of touching a client's live payload.
 *
 * ## It implements hash-gating, and that is not optional here either
 *
 * A development publisher that always wrote would let the hash-gating path go
 * untested until it ran in production against fifty clients (FR-065). The
 * skipped/written split this returns is what the integration tests assert
 * against, so the behaviour is exercised on every run of the suite.
 *
 * ## `readCurrent` returns the same three outcomes as the state port
 *
 * The Publish Gate needs `absent` and `unreadable` kept apart (GATE-03), and
 * that requirement does not weaken because the publisher is a local directory.
 * A development run that treated an unreadable prior as a first publish would
 * teach the pipeline the wrong lesson in the one environment where the mistake
 * is free.
 *
 * @module adapters/publisher/filesystem
 */

import { readFile } from 'node:fs/promises';

import { writeFileAtomic } from '../../infra/fs-atomic.mjs';
import { readJsonFile } from '../../infra/json-file.mjs';
import { dataPaths } from './paths.mjs';
import { artifactUnchanged } from './unchanged.mjs';

/**
 * @param {{ root: string }} options
 * @returns {any}
 */
export function createFilesystemPublisher({ root }) {
  const paths = dataPaths(root);

  return {
    /**
     * Writes the artifacts whose bytes differ from what is already there.
     *
     * @param {{ clientSlug: string, listingKey: string, artifacts: Record<string, { bytes: string }> }} target
     * @returns {Promise<{ written: string[], skipped: string[] }>}
     */
    async stage({ clientSlug, listingKey, artifacts }) {
      /** @type {string[]} */
      const written = [];
      /** @type {string[]} */
      const skipped = [];

      for (const [name, artifact] of Object.entries(artifacts)) {
        const path = paths.artifact(clientSlug, listingKey, kebab(name));

        if (await unchangedOnDisk(path, artifact)) {
          skipped.push(path);
          continue;
        }

        await writeFileAtomic(path, artifact.bytes);
        written.push(path);
      }

      return { written, skipped };
    },

    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @param {string} [artifact]
     * @returns {Promise<import('../../ports/state.mjs').StateRead>}
     */
    readCurrent: (clientSlug, listingKey, artifact = 'reviews') =>
      readJsonFile(paths.artifact(clientSlug, listingKey, artifact)),

    /**
     * There is nothing to commit or push to a directory.
     *
     * Present rather than absent so the composition root can wire this adapter
     * wherever the git publisher goes, without the orchestrator learning which
     * one it has. An orchestrator that branched on publisher type would have two
     * publish paths, and only one of them would be tested.
     *
     * @returns {Promise<{ ok: boolean, commit: null }>}
     */
    commit: async () => ({ ok: true, commit: null }),

    /** @returns {Promise<{ ok: boolean }>} */
    push: async () => ({ ok: true }),

    paths,
  };
}

/**
 * Compares by SEALED CONTENT HASH, not by raw bytes.
 *
 * Raw bytes include `generated_at` and therefore differ on every run, which
 * made the skip unreachable and every run rewrite every artifact (IR-06). See
 * `unchanged.mjs`.
 *
 * @param {string} path
 * @param {{ bytes: string, contentHash?: string }} artifact
 * @returns {Promise<boolean>}
 */
async function unchangedOnDisk(path, artifact) {
  try {
    return artifactUnchanged(await readFile(path, 'utf8'), artifact);
  } catch {
    // Unreadable or absent both mean "we cannot claim it is unchanged", so the
    // write proceeds. Erring towards writing is right here: the cost is a
    // redundant write, and the alternative is skipping a write the payload
    // needed.
    return false;
  }
}

/**
 * `schemaOrg` names an artifact key in code; `schema-org.json` names the file a
 * consumer fetches. Converting here keeps the mapping in one place rather than
 * at every call site that builds a URL.
 *
 * @param {string} name
 * @returns {string}
 */
function kebab(name) {
  return name.replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
}
