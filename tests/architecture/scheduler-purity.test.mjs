import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeTargets } from '../../src/app/registry.mjs';
import { planShards, seededOrder } from '../../src/app/shard-planner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * SCHED-01 / TR-APP-030 — the planning half is pure, and `tpre plan` depends
 * on it.
 *
 * An operator reaches for `tpre plan` **during an incident**, to answer "what
 * is due right now, and why is this client stale?". A diagnostic with side
 * effects is a diagnostic nobody dares run at the moment it would help most —
 * so purity here is a requirement rather than a nicety, and it is asserted
 * structurally rather than trusted.
 */

const PURE = ['src/app/registry.mjs', 'src/app/shard-planner.mjs'];

/**
 * @param {string} rel
 * @returns {string}
 */
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe.each(PURE)('%s is pure', (rel) => {
  it('imports nothing at all', () => {
    // Not "imports nothing impure" — nothing. Both modules are arithmetic over
    // their arguments, and the first import is how that stops being true.
    const imports = [...source(rel).matchAll(/^\s*import\s.+$/gmu)].map((match) => match[0].trim());

    expect(imports).toEqual([]);
  });

  it('reads no clock and no randomness', () => {
    // `now` arrives as a parameter and the order is seeded by the run id. A
    // `Date.now()` here would make the due-set matrix untestable and make two
    // `tpre plan` runs disagree.
    const code = source(rel);

    expect(code).not.toMatch(/\bDate\.now\b/u);
    expect(code).not.toMatch(/\bnew Date\b/u);
    expect(code).not.toMatch(/\bMath\.random\b/u);
    expect(code).not.toMatch(/\bperformance\.now\b/u);
  });

  it('touches no filesystem, process, or network surface', () => {
    const code = source(rel);

    for (const forbidden of [
      'readFileSync',
      'writeFileSync',
      'process.env',
      'fetch(',
      'require(',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('purity is observable, not just structural', () => {
  const clients = [
    {
      client_slug: 'acme',
      tier: 'standard',
      enabled: true,
      listings: [{ listing_key: 'main' }, { listing_key: 'second' }],
    },
  ];

  it('returns the same plan for the same inputs, minutes apart', () => {
    // The stated verification is that a reviewer runs `tpre plan` twice and
    // diffs the output. That only works if nothing inside depends on when it
    // ran.
    const input = { clients, now: 1_800_000_000_000, health: {} };
    const first = computeTargets(input);
    const second = computeTargets(input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not mutate its inputs', () => {
    // A planner that sorted its argument in place would reorder the caller's
    // config, and the second call would answer differently.
    const input = { clients, now: 1_800_000_000_000, health: {} };
    const before = JSON.stringify(input);

    const targets = computeTargets(input);

    planShards(targets, 3);
    seededOrder(targets, 'run-1');

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(targets)).toBe(JSON.stringify(computeTargets(input)));
  });

  it('produces a plan with no undefined field, so the output is diffable', () => {
    // `undefined` disappears through JSON.stringify, so a field that is
    // sometimes undefined makes two runs differ in shape rather than in value.
    const targets = computeTargets({ clients, now: 1_800_000_000_000, health: {} });

    for (const target of targets) {
      for (const [key, value] of Object.entries(target)) {
        expect(value, `${target.clientSlug}.${key}`).toBeDefined();
      }
    }
  });
});
