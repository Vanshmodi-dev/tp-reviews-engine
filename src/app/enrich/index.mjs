/**
 * C-20 · Enrichment dispatcher — stage 7 (TRD §80).
 *
 * Optional, always. v1.0 ships `noop.mjs` and nothing else; the module exists
 * so that the seam is real before v2 needs it.
 *
 * ## The dispatcher's actual job is refusal
 *
 * Running an enricher is three lines. The reason this file exists is
 * **TR-FUT-030**: enrichment is additive only and MUST NEVER overwrite or
 * influence `rating`, `text`, `author`, or dates.
 *
 * That guarantee cannot live in the enricher, because the whole point of a
 * seam is that someone else writes the enricher later — plausibly a model with
 * a prompt, plausibly under deadline. A guardrail enforced by the thing being
 * guarded is not a guardrail.
 *
 * So the dispatcher copies nothing from the enricher into the review. It takes
 * the enricher's output, keeps only the fields §80.2 reserves, and attaches it
 * under `ai`. An enricher that returns `{ rating: 5 }` changes nothing, and the
 * attempt is reported.
 *
 * ## Failure is never fatal
 *
 * Stage 7 is optional (TRD §531: "Yes — always optional"). An enrichment that
 * throws, times out, or returns nonsense leaves the review exactly as it was
 * and the harvest continues. Reviews are the product; annotations are a
 * garnish, and a garnish must not be able to fail the meal.
 *
 * @module app/enrich/index
 */

/**
 * The only keys an enricher may contribute (TRD §80.2).
 *
 * Listed rather than inferred. A dispatcher that copied "whatever the enricher
 * returned, minus a denylist" would admit every field a future model invents,
 * and the denylist would be updated one incident late.
 */
export const AI_FIELDS = Object.freeze([
  'summary',
  'sentiment',
  'sentiment_score',
  'topics',
  'keywords',
  'spam_score',
  'language_detected',
  'model',
  'generated_at',
  'content_hash_at_generation',
]);

/**
 * Fields enrichment may never touch, named for the error message.
 *
 * They are already unreachable — the dispatcher builds the `ai` block from
 * `AI_FIELDS` alone, so nothing else can pass through — but naming them makes
 * a rejected attempt legible in a log instead of silently ignored.
 */
const PROTECTED = Object.freeze(['rating', 'text', 'author', 'date', 'author_name', 'owner_reply']);

/**
 * Keeps only the reserved fields.
 *
 * @param {any} produced
 * @returns {{ ai: any, rejected: string[] }}
 */
function sanitise(produced) {
  if (produced === null || produced === undefined || typeof produced !== 'object') {
    return { ai: null, rejected: [] };
  }

  /** @type {Record<string, any>} */
  const ai = {};

  for (const field of AI_FIELDS) {
    if (produced[field] !== undefined) ai[field] = produced[field];
  }

  const rejected = Object.keys(produced).filter((key) => !AI_FIELDS.includes(key));

  return { ai: Object.keys(ai).length === 0 ? null : ai, rejected };
}

/**
 * Builds the dispatcher.
 *
 * @param {object} [deps]
 * @param {ReadonlyArray<{ id: string, enrich: (review: any) => Promise<any> }>} [deps.enrichers]
 * @param {{ warn: (message: string, fields?: any) => void }} [deps.logger]
 * @returns {any}
 */
export function createEnricher(deps = {}) {
  const enrichers = deps.enrichers ?? [];
  const logger = deps.logger ?? { warn: () => {} };

  return {
    /**
     * @param {ReadonlyArray<any>} reviews
     * @returns {Promise<{ reviews: any[], annotated: number, failures: number }>}
     */
    async enrich(reviews) {
      const source = Array.isArray(reviews) ? reviews : [];

      // Nothing configured is the v1.0 path and must cost nothing. Returning
      // the same array rather than a mapped copy keeps `ai` absent rather than
      // present-and-null on every review in every payload.
      if (enrichers.length === 0) {
        return { reviews: [...source], annotated: 0, failures: 0 };
      }

      let annotated = 0;
      let failures = 0;
      /** @type {any[]} */
      const out = [];

      for (const review of source) {
        const outcome = await applyAll(review, enrichers, logger);

        if (outcome.failed) failures += 1;
        if (outcome.ai !== null) annotated += 1;

        out.push(outcome.ai === null ? review : { ...review, ai: outcome.ai });
      }

      return { reviews: out, annotated, failures };
    },
  };
}

/**
 * @param {any} review
 * @param {ReadonlyArray<any>} enrichers
 * @param {any} logger
 * @returns {Promise<{ ai: any, failed: boolean }>}
 */
async function applyAll(review, enrichers, logger) {
  /** @type {Record<string, any>} */
  let merged = {};
  let failed = false;

  for (const enricher of enrichers) {
    try {
      const { ai, rejected } = sanitise(await enricher.enrich(review));

      if (rejected.length > 0) {
        const protectedAttempt = rejected.filter((field) => PROTECTED.includes(field));

        logger.warn('enricher returned fields outside the reserved ai block', {
          enricher: enricher.id,
          rejected,
          // Called out separately: an enricher reaching for `rating` is not a
          // typo, it is a design misunderstanding, and it should read as one.
          ...(protectedAttempt.length > 0 ? { attempted_source_of_truth: protectedAttempt } : {}),
        });
      }

      if (ai !== null) merged = { ...merged, ...ai };
    } catch (error) {
      // Optional means optional. The review survives untouched.
      failed = true;
      logger.warn('enricher failed; the review is unchanged', {
        enricher: enricher.id,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ai: Object.keys(merged).length === 0 ? null : merged, failed };
}
