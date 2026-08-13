/**
 * The v1.0 enricher: it does nothing, on purpose (TRD §80.1).
 *
 * Stage 7 exists in v1.0 as a no-op so that the seam is real — wired,
 * exercised, and covered by the guardrail in `index.mjs` — before anything
 * needs it. A seam that is only designed and never built is discovered to be
 * the wrong shape on the day it is first used.
 *
 * @module app/enrich/noop
 */

/**
 * @returns {{ id: string, enrich: (review: any) => Promise<null> }}
 */
export function createNoopEnricher() {
  return {
    id: 'noop',

    /**
     * `null`, not `{}`. An empty object would populate the payload's `ai` block
     * with a present-but-empty structure, which a consumer would reasonably
     * read as "analysed, found nothing" rather than "not analysed".
     *
     * @returns {Promise<null>}
     */
    async enrich() {
      return null;
    },
  };
}
