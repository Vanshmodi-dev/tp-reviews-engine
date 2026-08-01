import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * NODE-01: `.nvmrc` is the only place the Node version is written as a literal.
 *
 * The composite CI action reads `.nvmrc`; `engines.node` is checked against it
 * here. Three literals is how a CI upgrade silently diverges from local, and
 * the divergence is invisible until byte-determinism breaks on one of them.
 *
 * Specified by IMPL PLAN 17.1 and TR-BLD-004.
 */

/** @returns {string} The Node major version pinned in `.nvmrc`. */
function readPinnedMajor() {
  return readFileSync(new URL('../../../.nvmrc', import.meta.url), 'utf8').trim();
}

/** @returns {{ engines?: { node?: string } }} The parsed root manifest. */
function readManifest() {
  const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

describe('Node version consistency (NODE-01)', () => {
  it('pins a bare major version in .nvmrc', () => {
    expect(readPinnedMajor()).toMatch(/^\d+$/u);
  });

  it('declares an engines.node range in package.json', () => {
    const engines = readManifest().engines;
    expect(engines?.node).toBeDefined();
  });

  it('opens the engines.node range at the .nvmrc major', () => {
    const pinned = readPinnedMajor();
    const range = readManifest().engines?.node ?? '';
    const lower = /^>=(\d+)/u.exec(range);

    expect(lower, `engines.node "${range}" must open with >=<major>`).not.toBeNull();
    expect(lower?.[1]).toBe(pinned);
  });

  it('closes the engines.node range at the next major', () => {
    const pinned = Number(readPinnedMajor());
    const range = readManifest().engines?.node ?? '';
    const upper = /<(\d+)/u.exec(range);

    expect(upper, `engines.node "${range}" must close with <<next major>`).not.toBeNull();
    expect(Number(upper?.[1])).toBe(pinned + 1);
  });

  it('satisfies TRD 11: the pinned major is an LTS at or above 20', () => {
    const pinned = Number(readPinnedMajor());

    expect(pinned).toBeGreaterThanOrEqual(20);
    expect(pinned % 2, 'Node LTS majors are even-numbered').toBe(0);
  });
});
