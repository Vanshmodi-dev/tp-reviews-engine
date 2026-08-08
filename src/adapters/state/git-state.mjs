/**
 * The `state`-branch adapter (T-147, T-148, T-149, T-150).
 *
 * Ledgers, the identity cache, rate budgets, breaker state, and health records,
 * rooted at a checkout of the `state` branch.
 *
 * ## Three read outcomes, never two
 *
 * `found`, `absent`, and `unreadable` are kept apart everywhere in this module,
 * and the distinction is the single most consequential thing in it (IR-25).
 *
 * Collapsing `unreadable` into `absent` — which is what `catch { return null }`
 * does — means a corrupt ledger reads as a first run. The engine would then
 * reconcile from an empty ledger, every existing review would look new, the
 * Publish Gate's first-publish exception would skip every change-based rule,
 * and the result would be published over a healthy payload.
 *
 * So a parse failure is `unreadable`, the caller aborts that target, and the
 * last known good payload stays up. A stale payload is visible and recoverable;
 * a wiped one is neither.
 *
 * ## Every write goes through `fs-atomic`
 *
 * There is no other write path in this module. A torn ledger is not merely a
 * corrupt file — it is the *only* record of `first_seen_at` for every review in
 * that listing, and that value cannot be recovered from the source.
 *
 * @module adapters/state/git-state
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  ledgerFromJSON as fromJSON,
  ledgerToJSON as toJSON,
  serialiseLedger,
} from '../../core/index.mjs';
import { writeFileAtomic } from '../../infra/fs-atomic.mjs';
import { readJsonFile } from '../../infra/json-file.mjs';
import { statePaths } from './paths.mjs';

/**
 * Builds the state adapter.
 *
 * @param {{ root: string }} options
 * @returns {any}
 */
export function createGitState({ root }) {
  const paths = statePaths(root);

  return {
    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @returns {Promise<import('../../ports/state.mjs').StateRead>}
     */
    async readLedger(clientSlug, listingKey) {
      const result = await readJsonFile(paths.ledger(clientSlug, listingKey));

      if (result.outcome !== 'found') return result;

      // A file that parses as JSON is not necessarily a ledger. A truncated
      // write can leave valid JSON that is missing everything that matters, and
      // treating that as a ledger would reconcile against a shape the engine
      // invented.
      const problems = checkLedgerShape(result.value);

      if (problems.length > 0) {
        return Object.freeze({
          outcome: 'unreadable',
          value: null,
          reason: `not a usable ledger: ${problems.join('; ')}`,
        });
      }

      return Object.freeze({ outcome: 'found', value: fromJSON(result.value), reason: null });
    },

    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @param {any} ledger
     * @returns {Promise<{ ok: boolean, path: string }>}
     */
    async writeLedger(clientSlug, listingKey, ledger) {
      const path = paths.ledger(clientSlug, listingKey);

      await writeFileAtomic(path, serialiseLedger(toJSON(ledger)));

      return { ok: true, path };
    },

    /**
     * @param {string} clientSlug
     * @returns {Promise<import('../../ports/state.mjs').StateRead>}
     */
    readIdentityCache: (clientSlug) => readJsonFile(paths.identityCache(clientSlug)),

    /**
     * @param {string} clientSlug
     * @param {any} cache
     * @returns {Promise<{ ok: boolean }>}
     */
    async writeIdentityCache(clientSlug, cache) {
      await writeFileAtomic(paths.identityCache(clientSlug), serialiseLedger(cache));

      return { ok: true };
    },

    /**
     * @param {string} source
     * @returns {Promise<import('../../ports/state.mjs').StateRead>}
     */
    readBudget: (source) => readJsonFile(paths.budget(source)),

    /**
     * Budget writes are durable.
     *
     * This is the one place the extra `fsync` is worth its cost: the counter is
     * written BEFORE the request it authorises (EDR-034), and the whole value
     * of that ordering is lost if the write is still sitting in a page cache
     * when the runner is killed.
     *
     * @param {string} source
     * @param {any} budget
     * @returns {Promise<{ ok: boolean }>}
     */
    async writeBudget(source, budget) {
      await writeFileAtomic(paths.budget(source), serialiseLedger(budget), { durable: true });

      return { ok: true };
    },

    /**
     * @param {string} source
     * @param {string} access
     * @returns {Promise<import('../../ports/state.mjs').StateRead>}
     */
    readBreaker: (source, access) => readJsonFile(paths.breaker(source, access)),

    /**
     * @param {string} source
     * @param {string} access
     * @param {any} state
     * @returns {Promise<{ ok: boolean }>}
     */
    async writeBreaker(source, access, state) {
      await writeFileAtomic(paths.breaker(source, access), serialiseLedger(state));

      return { ok: true };
    },

    /**
     * Appends one health record (HLTH-01, EDR-033).
     *
     * **Append, never read-modify-write.** Shards run in parallel, and a
     * read-modify-write of a shared file loses whichever record lost the race —
     * silently, and precisely for the runs most likely to be interesting.
     * `appendFile` with a single `write` of a complete line is atomic for the
     * sizes involved here, which is why the record is serialised first and
     * written once.
     *
     * @param {string} clientSlug
     * @param {string} listingKey
     * @param {any} record
     * @returns {Promise<{ ok: boolean }>}
     */
    async appendHealth(clientSlug, listingKey, record) {
      const path = paths.health(clientSlug, listingKey);

      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');

      return { ok: true };
    },

    /**
     * @param {string} clientSlug
     * @param {string} listingKey
     * @returns {Promise<any[]>}
     */
    async readHealth(clientSlug, listingKey) {
      const path = paths.health(clientSlug, listingKey);

      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return [];
      }

      // A truncated final line is dropped rather than failing the read. Health
      // records are diagnostics: losing the last one to a crash is acceptable,
      // and refusing to read any of them because of it is not.
      return text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => parseLineOrNull(line))
        .filter((entry) => entry !== null);
    },

    paths,
  };
}

/**
 * @param {string} line
 * @returns {any}
 */
function parseLineOrNull(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Whether a parsed object is usable as a ledger.
 *
 * Deliberately checks structure rather than validating every field: this is the
 * difference between "this file is a ledger" and "this ledger is correct", and
 * only the first belongs at a read boundary. `checkLedgerInvariants` answers
 * the second.
 *
 * @param {any} value
 * @returns {string[]}
 */
export function checkLedgerShape(value) {
  const problems = [];

  if (value === null || typeof value !== 'object') return ['not an object'];
  if (!Number.isInteger(value.ledger_version)) problems.push('missing ledger_version');
  if (typeof value.client_slug !== 'string') problems.push('missing client_slug');
  if (typeof value.listing_key !== 'string') problems.push('missing listing_key');
  if (value.records === null || typeof value.records !== 'object') problems.push('missing records');

  return problems;
}
