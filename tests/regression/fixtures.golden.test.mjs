import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { descendants, parseHtml } from '../../src/core/extract/html.mjs';
import { extractReviews } from '../../src/core/extract/index.mjs';
import { classifySignals, detectSignals } from '../../src/core/extract/signals.mjs';
import { sha256Hex } from '../../src/core/util/hash.mjs';
import { CORPUS_ROOT, caseSlugs, loadFixture } from '../helpers/fixtures.mjs';

const slugs = caseSlugs();

/**
 * @param {string} slug
 * @returns {any}
 */
function run(slug) {
  const fixture = loadFixture(slug);

  return extractReviews(fixture.html, fixture.pack, {
    locale: fixture.meta.locale,
    parse: parseHtml,
  });
}

describe('DEL-98 — the corpus is twenty cases and stays twenty', () => {
  it('has every case the TRD names', () => {
    // A corpus that quietly loses a case keeps passing. §6.7 names all twenty,
    // and the adversarial five are the ones most likely to be dropped because
    // they require constructing a failure rather than capturing a page.
    expect(slugs).toHaveLength(20);
    expect(slugs).toContain('014-partial-load-stalled');
    expect(slugs).toContain('015-structure-changed');
    expect(slugs).toContain('016-challenge-page');
    expect(slugs).toContain('017-consent-interstitial');
    expect(slugs).toContain('019-markup-in-review-text');
  });

  it.each(slugs)('%s declares its provenance and pins a pack', (slug) => {
    const { meta } = loadFixture(slug);

    expect(meta.pack_version).toMatch(/^v\d+$/u);
    expect(meta.locale).toBeTruthy();
    // Origin is asserted because it is the difference between a case that
    // proves the parser handles a real rendering and one that proves it handles
    // markup we wrote. Both are useful; conflating them is not.
    expect(['captured', 'synthetic']).toContain(meta.origin);
    expect(String(meta.exercises).length).toBeGreaterThan(40);
  });

  it.each(slugs)('%s is trimmed, not a full-page capture', (slug) => {
    const bytes = readFileSync(join(CORPUS_ROOT, slug, 'page.html'), 'utf8').length;

    // The rule from fixtures/README.md, enforced rather than reviewed by eye. A
    // megabyte of someone else's application markup per case makes every diff
    // unreviewable and the sanitiser's work unverifiable.
    expect(bytes).toBeLessThan(200_000);
  });

  it.each(slugs)('%s contains no script, style, or inline handler', (slug) => {
    const html = readFileSync(join(CORPUS_ROOT, slug, 'page.html'), 'utf8');
    const elements = descendants(parseHtml(html));

    // Asserted against the parsed tree, not a regex over the raw text. Fixture
    // 019 deliberately contains the string ` onerror=` as *escaped text inside
    // an attribute value* — it is the payload under test. A regex cannot tell
    // that from a live handler, and the version that tried flagged the one
    // fixture whose whole purpose is to carry it.
    expect(elements.map((element) => element.tag)).not.toContain('script');
    expect(elements.map((element) => element.tag)).not.toContain('style');

    for (const element of elements) {
      expect(Object.keys(element.attrs).filter((name) => /^on/u.test(name))).toEqual([]);
    }
  });
});

describe('DEL-99 — every fixture reproduces its golden output', () => {
  it.each(slugs)('%s matches expected.json', (slug) => {
    const fixture = loadFixture(slug);

    expect(fixture.expected, `${slug} has no expected.json`).not.toBeNull();

    const result = run(slug);

    if (fixture.expected.shape === 'error') {
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe(fixture.expected.error.code);

      return;
    }

    expect(result.ok, `${slug} failed: ${JSON.stringify(result.error)}`).toBe(true);

    if (fixture.expected.shape === 'digest') {
      expect(result.value.reviews).toHaveLength(fixture.expected.review_count);
      expect(result.value.quarantined).toHaveLength(fixture.expected.quarantined_count);
      expect(sha256Hex(JSON.stringify(result.value.reviews))).toBe(fixture.expected.records_sha256);

      return;
    }

    expect(result.value.reviews).toEqual(fixture.expected.reviews);
    expect(result.value.quarantined).toEqual(fixture.expected.quarantined);
  });

  it('goldens are generated, never hand-written', () => {
    // The regenerator is the mechanism: run it, read the diff. If it is missing,
    // the only way to update a golden is to edit it by hand — which turns a
    // regression suite into a transcription exercise.
    expect(existsSync(join(CORPUS_ROOT, '..', '..', '..', 'scripts', 'regenerate-expected.mjs')));
    expect(existsSync('scripts/regenerate-expected.mjs')).toBe(true);
  });
});

describe('EDR-016 / FR-033 — fixture 004: replies never become reviews', () => {
  const outcome = run('004-owner-replies');

  it('extracts two reviews, not four', () => {
    // The reply subtree contains its own date and its own text. A reply that is
    // still attached is a review that does not exist.
    expect(outcome.value.reviews).toHaveLength(2);
  });

  it('keeps the reply out of the review body', () => {
    const [first] = outcome.value.reviews;

    expect(first.text).toBe('The appointment was rescheduled twice before anyone arrived.');
    expect(first.text).not.toContain('Thank you');
    expect(first.text).not.toContain('delighted');
  });

  it('does not let the reply inflate the rating', () => {
    // The reply says "Thank you for the five star review" on a two-star review.
    // This is the observed failure FR-033 exists for: it silently inflates the
    // business's displayed rating and every value looks plausible.
    expect(outcome.value.reviews[0].rating).toBe(2);
  });

  it('captures the reply as its own field with its own date', () => {
    expect(outcome.value.reviews[0].owner_reply).toEqual({
      text: 'Thank you for the five star review! We are delighted you were happy with our excellent service.',
      relative_date_raw: '1 week ago',
    });
  });
});

describe('§21.9 — the adversarial five assert correct failure', () => {
  it('014: a stalled partial load yields three reviews and one quarantine', () => {
    const outcome = run('014-partial-load-stalled');

    // Not four reviews with invented fields, and not zero because one node was
    // broken. The half-rendered node is quarantined and the three complete ones
    // are kept.
    expect(outcome.ok).toBe(true);
    expect(outcome.value.reviews).toHaveLength(3);
    expect(outcome.value.quarantined).toHaveLength(1);
    expect(outcome.value.quarantined[0].code).toBe('ERR-PARSE-FIELD-REQUIRED');
  });

  it('015: changed structure raises ERR-PARSE-EMPTY-UNEXPECTED, not silent success', () => {
    const outcome = run('015-structure-changed');

    // The container resolved and the nodes did not. Two reviews are plainly
    // present in the markup; reporting zero and publishing it would wipe a
    // client site over a vendor restyle.
    expect(outcome.ok).toBe(false);
    expect(outcome.error.code).toBe('ERR-PARSE-EMPTY-UNEXPECTED');
  });

  it('016: a challenge is a BLOCK, never a parse failure (TR-NAV-043)', () => {
    const outcome = run('016-challenge-page');

    // ERR-PARSE-STRUCTURE here would send an engineer to the selector-repair
    // runbook for markup that is not broken, and would trigger a retry that
    // escalates a soft block into a hard one.
    expect(outcome.ok).toBe(false);
    expect(outcome.error.code).toBe('ERR-BLOCKED-CHALLENGE');
  });

  it('017: a consent wall has its own code, not the challenge code', () => {
    const outcome = run('017-consent-interstitial');

    // A consent interstitial is a page state a navigator can dismiss. Calling
    // it a block would open a breaker over something that is not an access
    // decision by the source.
    expect(outcome.ok).toBe(false);
    expect(/** @type {any} */ (outcome).error.code).toBe('ERR-NAV-CONSENT-WALL');
  });

  it('019: markup in review text reaches the normaliser intact', () => {
    const outcome = run('019-markup-in-review-text');
    const [first] = outcome.value.reviews;

    // Extraction lifts text nodes. It does NOT strip markup — that is step 2 of
    // the normaliser, which is the security boundary for every client website
    // simultaneously (§23.3, INV-05). Cleaning here would mean text reaching the
    // payload had been cleaned by an implementation never reviewed as a
    // security control.
    expect(first.text).toContain('<scr<script>ipt>');
    expect(first.author.name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('003 vs 015 — the empty-state signal is what separates them', () => {
  it('003 publishes zero reviews legitimately', () => {
    const outcome = run('003-zero-reviews');

    expect(outcome.ok).toBe(true);
    expect(outcome.value.reviews).toHaveLength(0);
  });

  it('the same markup without the signal is an error, not a zero', () => {
    const fixture = loadFixture('003-zero-reviews');
    const stripped = fixture.html
      .replace('No reviews yet', '')
      .replace('Be the first to review', '');

    // This is the whole point of the signal being declared pack data. Without
    // it, "the listing has no reviews" and "the page failed to render them" are
    // the same observation — and one of those is a reason to publish nothing
    // while the other is a reason to stop.
    const outcome = /** @type {any} */ (
      extractReviews(stripped, fixture.pack, { parse: parseHtml })
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error.code).toBe('ERR-PARSE-EMPTY-UNEXPECTED');
  });
});

describe('the strategy histogram is recorded for every field', () => {
  it('names every field that resolved, and marks the ones that did not', () => {
    const outcome = run('004-owner-replies');
    const indices = outcome.value.reviews[0].strategy_indices;

    expect(indices['rating']).toBe(0);
    expect(indices['author_name']).toBe(0);
    // -1 is a field that resolved from no strategy at all. Recording it is the
    // difference between "the pack has no photo_count here" and "we never
    // looked", and only the first is a fact about the source.
    expect(indices['photo_count']).toBe(-1);
    expect(indices['reply_text']).toBe(0);
  });

  it('001 resolves every field at strategy 0, which is the baseline', () => {
    const outcome = run('001-standard-120-reviews');

    for (const review of outcome.value.reviews) {
      expect(review.strategy_indices['rating']).toBe(0);
      expect(review.strategy_indices['author_name']).toBe(0);
    }
  });
});

describe('signal classification follows §21.8.1 exactly', () => {
  const pack = loadFixture('016-challenge-page').pack;

  it('one high-confidence signal is a challenge', () => {
    expect(classifySignals([{ name: 'challenge', confidence: 'high', pattern: 'x' }])?.code).toBe(
      'ERR-BLOCKED-CHALLENGE',
    );
  });

  it('two medium signals are a challenge', () => {
    const hits = /** @type {any} */ ([
      { name: 'a', confidence: 'medium', pattern: 'x' },
      { name: 'b', confidence: 'medium', pattern: 'y' },
    ]);

    expect(classifySignals(hits)?.code).toBe('ERR-BLOCKED-CHALLENGE');
  });

  it('one medium signal is a surface problem, not a block', () => {
    const hits = /** @type {any} */ ([{ name: 'a', confidence: 'medium', pattern: 'x' }]);

    expect(classifySignals(hits)?.code).toBe('ERR-NAV-SURFACE-NOT-FOUND');
  });

  it('low signals alone classify as nothing', () => {
    const hits = /** @type {any} */ ([{ name: 'a', confidence: 'low', pattern: 'x' }]);

    expect(classifySignals(hits)).toBeNull();
  });

  it('an ordinary review page trips no signal', () => {
    // The check that matters: a detector that fires on healthy pages would stop
    // every harvest, which is a louder failure than missing a challenge but a
    // failure all the same.
    expect(
      classifySignals(detectSignals(loadFixture('001-standard-120-reviews').html, pack)),
    ).toBeNull();
  });
});
