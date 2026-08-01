import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BLOCKED_CODES,
  CRITICAL_CODES,
  ERROR_CLASSES,
  ERROR_CODES,
  RETRY_STRATEGIES,
  SCOPES,
  SEVERITIES,
  getErrorClass,
  isErrorCode,
  isRetryable,
} from '../../../src/core/model/errors.mjs';

/**
 * ERR-02: a test MUST assert that no class is missing a retry policy, a scope,
 * or a severity.
 *
 * The strongest assertion here is the last one: the constant set is compared
 * against SAD Appendix B by parsing the document itself. A hand-maintained
 * expected list would drift from the source in exactly the way this test exists
 * to prevent, and would pass while doing so.
 */

const APPENDIX_B = 'docs/sad/11-appendices.md';
const EXPECTED_CLASS_COUNT = 49;

/** @returns {string[]} Codes parsed from Appendix B's table, in document order. */
function parseAppendixB() {
  const text = readFileSync(new URL(`../../../${APPENDIX_B}`, import.meta.url), 'utf8');
  const start = text.indexOf('# Appendix B');
  const end = text.indexOf('# Appendix C');
  const table = text.slice(start, end);

  const codes = [];
  for (const line of table.split('\n')) {
    // Table rows only: a code inside backticks at the start of a cell.
    const match = /^\|\s*\**`(ERR-[A-Z0-9-]+)`\**\s*\|/u.exec(line);
    if (match?.[1]) codes.push(match[1]);
  }
  return codes;
}

describe('taxonomy completeness (ERR-02)', () => {
  it('defines every class with all four attributes', () => {
    for (const code of ERROR_CODES) {
      const cls = getErrorClass(code);

      expect(cls, `${code} is missing`).toBeDefined();
      expect(cls?.retry, `${code} has no retry policy`).toBeDefined();
      expect(cls?.retry.strategy, `${code} has no retry strategy`).toBeDefined();
      expect(cls?.retry.maxAttempts, `${code} has no maxAttempts`).toBeTypeOf('number');
      expect(cls?.scope, `${code} has no scope`).toBeDefined();
      expect(cls?.severity, `${code} has no severity`).toBeDefined();
      expect(cls?.runbook, `${code} has no runbook`).toBeDefined();
      expect(cls?.opensBreaker, `${code} has no breaker flag`).toBeTypeOf('boolean');
    }
  });

  it('uses only documented values for every enumerated attribute', () => {
    for (const code of ERROR_CODES) {
      const cls = ERROR_CLASSES[code];

      expect(RETRY_STRATEGIES, `${code} strategy`).toContain(cls?.retry.strategy);
      expect(SCOPES, `${code} scope`).toContain(cls?.scope);
      expect(SEVERITIES, `${code} severity`).toContain(cls?.severity);
    }
  });

  it('points every class at a runbook under docs/runbooks/', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CLASSES[code]?.runbook, code).toMatch(/^docs\/runbooks\/[a-z-]+\.md$/u);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('freezes the taxonomy and every entry in it', () => {
    expect(Object.isFrozen(ERROR_CLASSES)).toBe(true);
    for (const code of ERROR_CODES) {
      expect(Object.isFrozen(ERROR_CLASSES[code]), code).toBe(true);
    }
  });
});

describe('taxonomy matches SAD Appendix B exactly', () => {
  it('parses the document rather than trusting a hand-copied list', () => {
    expect(parseAppendixB().length).toBe(EXPECTED_CLASS_COUNT);
  });

  it('defines every class the document defines, and no others', () => {
    const documented = parseAppendixB();

    expect([...ERROR_CODES].sort()).toEqual([...documented].sort());
  });

  it('preserves the document order', () => {
    // Order is how a reviewer diffs the table against the document row by row,
    // which is T-050's stated verification method.
    expect(ERROR_CODES).toEqual(parseAppendixB());
  });

  it('does not define ERR-PARSE-FAILED', () => {
    // IMPL PLAN 26.1 names this as the near-duplicate that appears when a
    // producer invents a class instead of selecting one.
    expect(isErrorCode('ERR-PARSE-FAILED')).toBe(false);
  });
});

describe('the critical set is deliberately narrow (§26.3)', () => {
  it('contains exactly the eight documented classes', () => {
    expect([...CRITICAL_CODES].sort()).toEqual([
      'ERR-BLOCKED-CHALLENGE',
      'ERR-BLOCKED-UNUSUAL-TRAFFIC',
      'ERR-CLEAN-MARKUP-SURVIVED',
      'ERR-GATE-REJECT-EMPTY',
      'ERR-GATE-REJECT-SCHEMA',
      'ERR-INTERNAL-INVARIANT',
      'ERR-INTERNAL-UNCLASSIFIED',
      'ERR-PUBLISH-AUTH',
    ]);
  });
});

describe('X-10 / INV-07: a challenge is terminal', () => {
  it('finds the blocked classes', () => {
    expect(BLOCKED_CODES).toEqual([
      'ERR-BLOCKED-CHALLENGE',
      'ERR-BLOCKED-UNUSUAL-TRAFFIC',
      'ERR-BLOCKED-GEO',
    ]);
  });

  it('gives no ERR-BLOCKED-* class any retry path at all', () => {
    // Not "few attempts". None. Adding one is on the plan's list of the three
    // unrecoverable classes of defect.
    for (const code of BLOCKED_CODES) {
      expect(ERROR_CLASSES[code]?.retry.strategy, code).toBe('never');
      expect(ERROR_CLASSES[code]?.retry.maxAttempts, code).toBe(0);
      expect(isRetryable(code), code).toBe(false);
    }
  });

  it('opens the breaker for the two source-blocking classes', () => {
    expect(ERROR_CLASSES['ERR-BLOCKED-CHALLENGE']?.opensBreaker).toBe(true);
    expect(ERROR_CLASSES['ERR-BLOCKED-UNUSUAL-TRAFFIC']?.opensBreaker).toBe(true);
  });

  it('opens the breaker for those two only', () => {
    const opening = ERROR_CODES.filter((c) => ERROR_CLASSES[c]?.opensBreaker);

    expect(opening).toEqual(['ERR-BLOCKED-CHALLENGE', 'ERR-BLOCKED-UNUSUAL-TRAFFIC']);
  });
});

describe('retry policy expansion', () => {
  it('encodes never as zero attempts, not one', () => {
    expect(ERROR_CLASSES['ERR-POLICY-KILLSWITCH']?.retry).toEqual({
      strategy: 'never',
      maxAttempts: 0,
    });
  });

  it('expands backoff counts from the document shorthand', () => {
    expect(ERROR_CLASSES['ERR-NET-DNS']?.retry.maxAttempts).toBe(3);
    expect(ERROR_CLASSES['ERR-NET-TLS']?.retry.maxAttempts).toBe(2);
    expect(ERROR_CLASSES['ERR-BROWSER-CRASH']?.retry.maxAttempts).toBe(1);
  });

  it('expands the one immediate-retry class', () => {
    expect(ERROR_CLASSES['ERR-BROWSER-LAUNCH']?.retry).toEqual({
      strategy: 'immediate',
      maxAttempts: 1,
    });
  });

  it('carries the 60-second base delay ERR-HTTP-429 asks for', () => {
    // Backing off in milliseconds against a source that asked for a minute is
    // how a rate limit becomes a block.
    expect(ERROR_CLASSES['ERR-HTTP-429']?.retry.baseDelayMs).toBe(60_000);
  });

  it('gives no other class a base delay', () => {
    const withDelay = ERROR_CODES.filter((c) => ERROR_CLASSES[c]?.retry.baseDelayMs !== undefined);

    expect(withDelay).toEqual(['ERR-HTTP-429']);
  });
});

describe('lookup helpers', () => {
  it('recognises a real code and rejects an invented one', () => {
    expect(isErrorCode('ERR-GATE-REJECT-EMPTY')).toBe(true);
    expect(isErrorCode('ERR-MADE-UP')).toBe(false);
  });

  it('returns undefined for an unknown code rather than synthesising one', () => {
    // A caller reaching here with an unknown code has invented it. The correct
    // response is ERR-INTERNAL-UNCLASSIFIED, not a fabricated entry.
    expect(getErrorClass('ERR-MADE-UP')).toBeUndefined();
  });

  it('reports retryability from the policy', () => {
    expect(isRetryable('ERR-NET-DNS')).toBe(true);
    expect(isRetryable('ERR-CONFIG-INVALID')).toBe(false);
  });
});
