#!/usr/bin/env node
/**
 * Regenerates every fixture's `expected.json` from the engine.
 *
 * ## Why goldens are generated and never hand-written
 *
 * A hand-written golden file asserts what someone *believed* the engine
 * produces. When it disagrees with reality the natural response is to edit the
 * golden until the test is green, which converts a regression suite into a
 * transcription exercise — and a transcription exercise catches nothing.
 *
 * Generating them means a diff in `expected.json` is always a real behavioural
 * change, and always deserves the review it gets. That is the whole mechanism:
 * **run this, then read the diff.** A diff you did not expect is the finding.
 *
 * ## The scale case stores a digest
 *
 * Case 018 runs five thousand nodes. Inlining five thousand records would make
 * its `expected.json` several megabytes of unreviewable repetition, which is
 * the same problem trimming exists to prevent. It stores counts, a rating
 * histogram, and a hash of the serialised records instead — all of which change
 * when behaviour changes, and none of which anybody would read line by line.
 *
 * Usage: `node scripts/regenerate-expected.mjs [slug …]`
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHtml } from '../src/core/extract/html.mjs';
import { extractReviews } from '../src/core/extract/index.mjs';
import { sha256Hex } from '../src/core/util/hash.mjs';
import { CORPUS_ROOT, caseSlugs, loadFixture } from '../tests/helpers/fixtures.mjs';

/** Above this many records the golden becomes a digest. */
const DIGEST_THRESHOLD = 500;

/**
 * @param {any} outcome
 * @returns {any}
 */
function digest(outcome) {
  /** @type {Record<string, number>} */
  const ratings = {};

  for (const review of outcome.reviews) {
    const key = String(review.rating);

    ratings[key] = (ratings[key] ?? 0) + 1;
  }

  return {
    shape: 'digest',
    review_count: outcome.reviews.length,
    quarantined_count: outcome.quarantined.length,
    rating_histogram: ratings,
    records_sha256: sha256Hex(JSON.stringify(outcome.reviews)),
    first: outcome.reviews[0] ?? null,
    last: outcome.reviews[outcome.reviews.length - 1] ?? null,
  };
}

const requested = process.argv.slice(2);
const slugs = requested.length > 0 ? requested : caseSlugs();

for (const slug of slugs) {
  const fixture = loadFixture(slug);
  const result = extractReviews(fixture.html, fixture.pack, {
    locale: fixture.meta.locale,
    emptyStateSignal: fixture.meta.empty_state_signal === true,
    parse: parseHtml,
  });

  const expected = result.ok
    ? result.value.reviews.length > DIGEST_THRESHOLD
      ? digest(result.value)
      : { shape: 'records', ...result.value }
    : { shape: 'error', error: result.error };

  writeFileSync(
    join(CORPUS_ROOT, slug, 'expected.json'),
    `${JSON.stringify(expected, null, 2)}\n`,
    'utf8',
  );

  const summary = result.ok
    ? `${result.value.reviews.length} review(s), ${result.value.quarantined.length} quarantined`
    : result.error.code;

  process.stdout.write(`${slug}: ${summary}\n`);
}
