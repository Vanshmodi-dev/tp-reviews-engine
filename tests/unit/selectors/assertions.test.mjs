import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkFixtureShape, parseHtml } from '../../../src/core/extract/html.mjs';
import {
  ASSERTION_SEVERITIES,
  checkAssertionFile,
  evaluateAssertion,
  evaluateAssertions,
} from '../../../src/core/selectors/assertions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = JSON.parse(
  readFileSync(join(ROOT, 'selectors', 'google-maps', 'assertions.json'), 'utf8'),
);

/**
 * @param {string} slug
 * @returns {any}
 */
const corpus = (slug) =>
  parseHtml(readFileSync(join(ROOT, 'fixtures', 'dom', 'google', slug, 'page.html'), 'utf8'));

describe('DEL-92 — the assertion file is well formed', () => {
  it('declares assertions, with ids, selectors, bounds, and notes', () => {
    expect(checkAssertionFile(FILE)).toEqual([]);
  });

  it('REJECTS a file that declares nothing', () => {
    // The failure this whole mechanism exists to avoid: a canary that passes
    // because it checks nothing.
    expect(checkAssertionFile({}).join(' ')).toContain('can never fail');
    expect(checkAssertionFile({ assertions: [] }).join(' ')).toContain('can never fail');
  });

  it('REJECTS an assertion with no bound', () => {
    // Without a min or a max there is nothing to violate, so the assertion is
    // decoration that reads as coverage.
    const problems = checkAssertionFile({
      assertions: [
        {
          id: 'A-X',
          selector: '.x',
          severity: 'error',
          notes: 'long enough notes to satisfy the rule',
        },
      ],
    });

    expect(problems.join(' ')).toContain('neither min nor max');
  });

  it('REJECTS duplicate ids, missing selectors, and unknown severities', () => {
    const problems = checkAssertionFile({
      assertions: [
        { id: 'A-X', selector: '.x', severity: 'error', min: 1, notes: 'a'.repeat(30) },
        { id: 'A-X', selector: '', severity: 'critical', min: 1, notes: 'a'.repeat(30) },
        { selector: '.y', severity: 'warn', min: 1, notes: 'a'.repeat(30) },
      ],
    });

    expect(problems.join(' ')).toContain('duplicate assertion id');
    expect(problems.join(' ')).toContain('has no selector');
    expect(problems.join(' ')).toContain('severity "critical"');
    expect(problems.join(' ')).toContain('has no id');
  });

  it('REJECTS an assertion nobody explained', () => {
    const problems = checkAssertionFile({
      assertions: [{ id: 'A-X', selector: '.x', severity: 'warn', min: 1, notes: 'because' }],
    });

    expect(problems.join(' ')).toContain('no usable notes');
  });

  it('uses only the documented severities', () => {
    for (const assertion of FILE.assertions) {
      expect(ASSERTION_SEVERITIES).toContain(assertion.severity);
    }
  });

  it('is not all one severity', () => {
    // A file where everything is fatal gets muted the first time a warn-level
    // case fires, and then none of it is checked.
    expect(new Set(FILE.assertions.map((/** @type {any} */ a) => a.severity)).size).toBeGreaterThan(
      1,
    );
  });
});

describe('the assertions hold against the corpus they describe', () => {
  it('passes cleanly on the ordinary listing', () => {
    const outcome = evaluateAssertions(corpus('001-standard-120-reviews'), FILE);

    expect(outcome.failed.map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
    expect(outcome.healthy).toBe(true);
  });

  it('FAILS on a listing whose structure changed', () => {
    // Fixture 015 keeps the container and loses the nodes. This is what a
    // canary would report on the morning of a redesign, and it names the
    // element rather than reporting a quarantine rate.
    const outcome = evaluateAssertions(corpus('015-structure-changed'), FILE);

    expect(outcome.healthy).toBe(false);
    expect(outcome.failed.map((f) => f.id)).toContain('A-NODES-PRESENT');
  });

  it('stops after a fatal failure rather than reporting six of them', () => {
    // Once the surface is missing, every other assertion fails for the same
    // reason. Six failures where there is one problem is a report nobody reads
    // to the end.
    const outcome = evaluateAssertions(parseHtml('<div>nothing here</div>'), FILE);

    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.id).toBe('A-SURFACE-PRESENT');
    expect(outcome.results).toHaveLength(1);
  });

  it('catches a challenge page through the max bound', () => {
    // Stated as a maximum because the dangerous direction is presence. A
    // challenge reaching the assertion stage at all means detection did not
    // fire first, which is CHAL-01's failure.
    const challenge = evaluateAssertion(corpus('016-challenge-page'), {
      id: 'A-NO-CHALLENGE',
      severity: 'fatal',
      selector: "form[action*='/sorry/']",
      max: 0,
    });

    expect(challenge.passed).toBe(false);
    expect(challenge.detail).toContain('at most 0');
  });
});

describe('a broken assertion is reported as broken, not as a page failure', () => {
  it('reports an unusable selector without blaming the source', () => {
    // Sending an engineer to look for a source change that never happened is
    // the expensive kind of wrong.
    const outcome = evaluateAssertion(parseHtml('<div></div>'), {
      id: 'A-BAD',
      severity: 'fatal',
      selector: 'div:nth-child(2)',
      min: 1,
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.severity).toBe('error');
    expect(outcome.detail).toContain('unusable');
  });
});

describe('SER-02 / SER-03 — a serialised subtree is fixture-shaped', () => {
  it('accepts a subtree', () => {
    expect(checkFixtureShape('<div role="feed"><div role="article">x</div></div>')).toEqual([]);
  });

  it('REJECTS a whole-page capture', () => {
    // A full-page serialisation on a five-thousand-review listing is a memory
    // event, not a slow function.
    expect(
      checkFixtureShape('<html><body><div role="feed"></div></body></html>').join(' '),
    ).toContain('whole-page capture');
  });

  it('REJECTS a subtree carrying a script', () => {
    expect(checkFixtureShape('<div><script>x()</script></div>').join(' ')).toContain('script');
  });

  it('REJECTS an empty subtree', () => {
    expect(checkFixtureShape('   ').join(' ')).toContain('empty');
  });
});
