/**
 * C-20 · Enrichment dispatcher — stage 7 (TRD §80).
 *
 * v1.0 ships a no-op, so it would be easy to test that nothing happens and move
 * on. The tests that matter are the ones about what happens when something DOES
 * happen — because the enricher that eventually runs here will be written
 * against a model's output, later, by someone reading §80 rather than this file.
 *
 * TR-FUT-030 is the whole point: enrichment is additive only and must never
 * influence `rating`, `text`, `author`, or dates. A guarantee enforced by the
 * enricher is not a guarantee; these cases pin it to the dispatcher.
 */

import { describe, expect, it, vi } from 'vitest';

import { AI_FIELDS, createEnricher } from '../../../src/app/enrich/index.mjs';
import { createNoopEnricher } from '../../../src/app/enrich/noop.mjs';

const REVIEW = Object.freeze({
  id: 'abc',
  rating: 2,
  text: 'Slow to arrive and the invoice was wrong.',
  author_name: 'Dana',
  date: '2026-01-02',
  owner_reply: null,
});

/** @param {any} produced */
const enricherReturning = (produced) => ({ id: 'test', enrich: async () => produced });

describe('the v1.0 default does nothing, visibly', () => {
  it('leaves reviews untouched when nothing is configured', async () => {
    const { reviews, annotated } = await createEnricher().enrich([REVIEW]);

    expect(reviews[0]).toEqual(REVIEW);
    expect(annotated).toBe(0);
  });

  it('does not add an empty ai block to every review', async () => {
    // `ai: null` on every review in every payload would be bytes on every
    // client's site forever, and a consumer would read "analysed, found
    // nothing" rather than "not analysed".
    const { reviews } = await createEnricher().enrich([REVIEW]);

    expect('ai' in reviews[0]).toBe(false);
  });

  it('the noop enricher returns null rather than an empty object', async () => {
    expect(await createNoopEnricher().enrich(REVIEW)).toBeNull();
  });

  it('handles a non-array input without throwing', async () => {
    const { reviews } = await createEnricher().enrich(/** @type {any} */ (undefined));

    expect(reviews).toEqual([]);
  });
});

describe('TR-FUT-030 — enrichment is additive only', () => {
  it('attaches reserved fields under ai', async () => {
    const enricher = createEnricher({
      enrichers: [enricherReturning({ sentiment: 'negative', sentiment_score: -0.7 })],
    });

    const { reviews, annotated } = await enricher.enrich([REVIEW]);

    expect(reviews[0].ai).toEqual({ sentiment: 'negative', sentiment_score: -0.7 });
    expect(annotated).toBe(1);
  });

  it('IGNORES an attempt to change the rating', async () => {
    // The failure this component exists to prevent. A model asked to "correct"
    // a rating from the text would be doing exactly what it was asked, and the
    // published payload would misrepresent what a customer actually said.
    const enricher = createEnricher({
      enrichers: [enricherReturning({ rating: 5, sentiment: 'negative' })],
    });

    const { reviews } = await enricher.enrich([REVIEW]);

    expect(reviews[0].rating).toBe(2);
    expect(reviews[0].ai.rating).toBeUndefined();
  });

  it.each(['text', 'author_name', 'date', 'owner_reply'])(
    'ignores an attempt to change %s',
    async (field) => {
      const enricher = createEnricher({
        enrichers: [enricherReturning({ [field]: 'REWRITTEN', summary: 'ok' })],
      });

      const { reviews } = await enricher.enrich([REVIEW]);

      expect(reviews[0][field]).toEqual(/** @type {any} */ (REVIEW)[field]);
    },
  );

  it('reports a source-of-truth attempt as more than a stray field', async () => {
    const logger = { warn: vi.fn() };
    const enricher = createEnricher({
      enrichers: [enricherReturning({ rating: 5 })],
      logger,
    });

    await enricher.enrich([REVIEW]);

    const fields = logger.warn.mock.calls[0]?.[1];

    // An enricher reaching for `rating` is a design misunderstanding, not a
    // typo, and the log should let someone tell the difference.
    expect(fields.attempted_source_of_truth).toContain('rating');
  });

  it('drops an unreserved field an enricher invents', async () => {
    const enricher = createEnricher({
      enrichers: [enricherReturning({ vibe: 'chaotic', summary: 'fine' })],
    });

    const { reviews } = await enricher.enrich([REVIEW]);

    // Allowlist, not denylist: a field nobody anticipated is refused by
    // default rather than admitted until someone notices.
    expect(reviews[0].ai).toEqual({ summary: 'fine' });
  });

  it('accepts every field §80.2 reserves', async () => {
    const produced = Object.fromEntries(AI_FIELDS.map((field) => [field, 'x']));
    const enricher = createEnricher({ enrichers: [enricherReturning(produced)] });

    const { reviews } = await enricher.enrich([REVIEW]);

    expect(Object.keys(reviews[0].ai).sort()).toEqual([...AI_FIELDS].sort());
  });
});

describe('stage 7 is optional, so it can never fail a harvest', () => {
  it('leaves the review unchanged when an enricher throws', async () => {
    const enricher = createEnricher({
      enrichers: [
        {
          id: 'boom',
          enrich: async () => {
            throw new Error('model timeout');
          },
        },
      ],
    });

    const { reviews, failures } = await enricher.enrich([REVIEW]);

    // Reviews are the product; annotations are a garnish. A garnish must not
    // be able to fail the meal.
    expect(reviews[0]).toEqual(REVIEW);
    expect(failures).toBe(1);
  });

  it('still applies the enrichers that did work', async () => {
    const enricher = createEnricher({
      enrichers: [
        {
          id: 'boom',
          enrich: async () => {
            throw new Error('nope');
          },
        },
        enricherReturning({ summary: 'survived' }),
      ],
    });

    const { reviews, failures } = await enricher.enrich([REVIEW]);

    expect(reviews[0].ai).toEqual({ summary: 'survived' });
    expect(failures).toBe(1);
  });

  it('tolerates an enricher returning a non-object', async () => {
    const enricher = createEnricher({ enrichers: [enricherReturning('a summary, as a string')] });
    const { reviews } = await enricher.enrich([REVIEW]);

    expect(reviews[0]).toEqual(REVIEW);
  });

  it('merges the output of several enrichers', async () => {
    const enricher = createEnricher({
      enrichers: [
        enricherReturning({ sentiment: 'negative' }),
        enricherReturning({ topics: ['delivery', 'billing'] }),
      ],
    });

    const { reviews } = await enricher.enrich([REVIEW]);

    expect(reviews[0].ai).toEqual({ sentiment: 'negative', topics: ['delivery', 'billing'] });
  });
});
