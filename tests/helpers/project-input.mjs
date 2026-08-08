/**
 * Builders for projector inputs.
 *
 * @module tests/helpers/project-input
 */

import { markNormalised } from '../../src/core/model/review.mjs';
import { ledgerWith, review as buildReview } from './reconcile-input.mjs';

export const GENERATED_AT = '2026-03-01T12:00:00.000Z';

/**
 * Engine and run provenance that satisfies the schema.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function meta(overrides = {}) {
  return {
    engine_version: '1.0.0',
    adapter: 'google:dom',
    adapter_capabilities: ['owner_reply', 'likes'],
    selector_pack_version: '2026.03.1',
    run_id: 'run-0001',
    harvest_started_at: '2026-03-01T11:00:00.000Z',
    harvest_completeness: 'full',
    ...overrides,
  };
}

/**
 * Effective config.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function config(overrides = {}) {
  return {
    client: { display_name: 'Acme Dental' },
    listing: {
      source: 'google',
      source_id: 'ChIJ-example',
      source_url: 'https://example.test/listing',
      display_name: 'Acme Dental',
      locale: 'en-GB',
      advertised_total: 100,
      advertised_rating: 4.5,
      address_hint: 'Bristol',
    },
    display: {},
    publish: {},
    ...overrides,
  };
}

/**
 * A review with a chosen rating, date and text.
 *
 * @param {string | number} label
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function review(label, overrides = {}) {
  const { text, ...rest } = overrides;

  return buildReview(label, {
    ...(text === undefined ? {} : { text: text === null ? null : markNormalised(String(text)) }),
    ...rest,
  });
}

/**
 * A ledger holding the given reviews.
 *
 * @param {ReadonlyArray<any>} reviews
 * @param {string} [now]
 * @returns {any}
 */
export function ledgerOf(reviews, now = '2026-02-01T00:00:00.000Z') {
  return ledgerWith(reviews, now);
}

/**
 * A complete `ProjectInput`.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
export function projectInput(overrides = {}) {
  return {
    ledger: ledgerOf([review(1), review(2), review(3)]),
    config: config(),
    meta: meta(),
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}
