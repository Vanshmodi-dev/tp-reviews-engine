/**
 * Reading a JSON file with **three** outcomes, not two.
 *
 * ## The distinction this module exists to preserve (IR-25)
 *
 * `found`, `absent`, and `unreadable` are different facts, and the conventional
 * `try { return JSON.parse(...) } catch { return null }` destroys the
 * difference between the last two.
 *
 * That collapse is rated `Critical` in this system. A corrupt ledger returning
 * "no ledger" reads as a first run: the engine reconciles from an empty ledger,
 * every existing review looks new, the Publish Gate's first-publish exception
 * skips every change-based rule, and the result is published over a healthy
 * payload. The engine deletes a client's reviews because it could not read a
 * file.
 *
 * So the outcome is a value the caller must handle, and there is no shape of
 * this function that returns `null` for both.
 *
 * Lives in `infra/` rather than in an adapter because both the state adapter
 * and the publisher need it, and an adapter importing another adapter is
 * forbidden (DR-3) for good reasons.
 *
 * @module infra/json-file
 */

import { readFile } from 'node:fs/promises';

/** The three outcomes. Two of them are not interchangeable. */
export const READ_OUTCOMES = Object.freeze(['found', 'absent', 'unreadable']);

/**
 * @param {string} outcome
 * @param {unknown} value
 * @param {string | null} reason
 * @returns {{ outcome: string, value: any, reason: string | null }}
 */
function result(outcome, value, reason) {
  return Object.freeze({ outcome, value: /** @type {any} */ (value), reason });
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} path
 * @returns {Promise<{ outcome: string, value: any, reason: string | null }>}
 */
export async function readJsonFile(path) {
  let text;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    // ENOENT is the ONLY error that means "absent". A permissions failure, a
    // directory where a file should be, or an I/O error all mean the state is
    // unknown — and unknown is not the same as empty.
    if (/** @type {any} */ (error)?.code === 'ENOENT') return result('absent', null, null);

    return result('unreadable', null, `could not read ${path}: ${describe(error)}`);
  }

  try {
    return result('found', JSON.parse(text), null);
  } catch (error) {
    return result('unreadable', null, `could not parse ${path}: ${describe(error)}`);
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
