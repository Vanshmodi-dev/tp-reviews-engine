/**
 * The CSV acquisition adapter (T-182).
 *
 * ## Why this exists before any browser code (X-8)
 *
 * An interface validated against a single implementation is a rename, not an
 * interface. This adapter and the DOM adapter differ in kind — one reads a file,
 * one drives a rendered page — and that difference is what forces
 * `AcquisitionPort` to be honest while changing it is still free.
 *
 * It is also useful on its own: a client can be onboarded from a previous
 * vendor's export before any browser automation is authorised, which is exactly
 * the situation V-3 creates by requiring written authorisation first.
 *
 * ## It reports why it stopped, never how complete it was
 *
 * `target_reached` when the file ends, `cap_reached` when the ceiling comes
 * first. Completeness is derived from the stop reason by
 * `core/validate/completeness.mjs` and nowhere else (VAL-01) — an adapter that
 * reported completeness itself would be making a judgement it has no standing
 * to make.
 *
 * ## It declares only what the format can carry
 *
 * A CSV cannot express a verified-purchase flag or local-guide status, so this
 * adapter does not claim them. The declaration is what turns a `null` in the
 * payload from "this review has no owner reply" into "this adapter cannot see
 * owner replies" — two facts a consumer cannot otherwise tell apart.
 *
 * @module adapters/acquisition/file-csv
 */

import { readFile } from 'node:fs/promises';

import { parseCsv } from './parse.mjs';

/**
 * What a CSV export can carry.
 *
 * Deliberately shorter than the DOM adapter's list. Claiming a capability the
 * format cannot express would make every affected field look like missing data
 * rather than an unavailable one.
 */
export const CSV_CAPABILITIES = Object.freeze([
  'author_name',
  'author_avatar_url',
  'author_profile_url',
  'rating',
  'text',
  'date',
  'owner_reply',
  'likes',
  'photo_count',
  'source_url',
]);

/**
 * @param {{ readSource?: (path: string) => Promise<string> }} [options]
 * @returns {any}
 */
export function createCsvAdapter(options = {}) {
  const read = options.readSource ?? ((path) => readFile(path, 'utf8'));

  return {
    id: 'csv:file',

    capabilities: () => CSV_CAPABILITIES,

    /**
     * @param {any} request
     * @returns {Promise<any>}
     */
    async harvest(request) {
      const path = request.listing?.source_file;

      if (typeof path !== 'string' || path === '') {
        // A `Result`, not a throw. A misconfigured listing is expected input,
        // and an adapter that threw would take down the whole run rather than
        // failing one target (INV-09).
        return failure('ERR-CONFIG-INVALID', 'listing.source_file is not set');
      }

      let text;

      try {
        text = await read(path);
      } catch (error) {
        return failure(
          'ERR-SOURCE-UNAVAILABLE',
          `could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const cap = request.cap ?? Number.POSITIVE_INFINITY;
      const parsed = parseCsv(text, { cap });

      if (parsed.rows.length === 0 && parsed.rejected.length > 0) {
        // Every row rejected is a file-level problem, not a harvest that found
        // nothing. Reporting it as an empty success would let the gate see an
        // empty payload with a `full` completeness and reason about it as a
        // genuine removal of every review.
        return failure('ERR-PARSE-STRUCTURE', parsed.rejected[0].reason);
      }

      return {
        ok: true,
        value: {
          reviews: parsed.rows,
          // Reached the cap first, or reached the end of the file.
          stop_reason: parsed.rows.length >= cap ? 'cap_reached' : 'target_reached',
          // A CSV carries no source-advertised totals. Null is the honest
          // answer; inventing `reviews.length` would make coverage always 1.0
          // and G-08 permanently silent.
          advertised_total: null,
          advertised_rating: null,
          capabilities: CSV_CAPABILITIES,
          diagnostics: {
            rejected_rows: parsed.rejected,
            considered: parsed.rows.length + parsed.rejected.length,
            columns: parsed.columns,
          },
        },
      };
    },
  };
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {any}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
