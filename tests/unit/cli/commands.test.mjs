import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  doctorCommand,
  planCommand,
  projectCommand,
  validateConfigCommand,
} from '../../../src/cli/commands.mjs';
import { EXIT } from '../../../src/cli/exit-codes.mjs';
import { readSecrets } from '../../../src/cli/composition.mjs';

describe('tpre doctor — reports everything, fixes nothing (REC-03)', () => {
  it('reports passes as well as failures', async () => {
    // "What does a healthy environment look like" is the question an operator
    // has when the output is unfamiliar.
    const result = await doctorCommand({
      checks: [
        { name: 'a', run: async () => ({ ok: true, detail: 'fine' }) },
        { name: 'b', run: async () => ({ ok: false, detail: 'missing' }) },
      ],
    }).run({});

    expect(result.output.checks).toEqual([
      { name: 'a', status: 'pass', detail: 'fine' },
      { name: 'b', status: 'fail', detail: 'missing' },
    ]);
    expect(result.output.healthy).toBe(false);
    expect(result.code).toBe(EXIT.USAGE);
  });

  it('exits 0 when every check passes', async () => {
    const result = await doctorCommand({
      checks: [{ name: 'a', run: async () => ({ ok: true, detail: 'fine' }) }],
    }).run({});

    expect(result.code).toBe(EXIT.OK);
    expect(result.output.healthy).toBe(true);
  });

  it('treats a throwing check as a failed check, not a failed doctor', async () => {
    // The whole point is to report on a broken environment, and a broken
    // environment is exactly where a check is most likely to throw.
    const result = await doctorCommand({
      checks: [
        {
          name: 'explodes',
          run: async () => {
            throw new Error('no checkout');
          },
        },
        { name: 'fine', run: async () => ({ ok: true, detail: 'ok' }) },
      ],
    }).run({});

    expect(result.output.checks[0]).toEqual({
      name: 'explodes',
      status: 'fail',
      detail: 'no checkout',
    });
    expect(result.output.checks[1].status).toBe('pass');
  });
});

describe('tpre validate-config', () => {
  const clientFile = (
    /** @type {any} */ config,
    /** @type {string} */ filename = 'acme-dental.config.json',
  ) => ({ filename, config });
  const valid = {
    slug: 'acme-dental',
    listings: [
      { key: 'main', adapter: 'csv', expected_name: 'Acme', identity: { url: 'https://x.test' } },
    ],
  };

  /**
   * @param {any[]} clients
   * @param {any} [flags]
   * @returns {Promise<any>}
   */
  const run = (clients, flags = {}) =>
    validateConfigCommand({ env: {}, readClients: async () => clients }).run({ flags });

  it('accepts a valid config', async () => {
    const result = await run([clientFile(valid)]);

    expect(result.code).toBe(EXIT.OK);
    expect(result.output.blocked).toEqual([]);
  });

  it('blocks a config with an error-severity finding', async () => {
    const result = await run([clientFile({ ...valid, slug: 'mismatched' })]);

    expect(result.code).toBe(EXIT.USAGE);
    expect(result.output.blocked).toEqual(['mismatched']);
  });

  it('fails only the offending client (TR-CFG-042)', async () => {
    // One invalid config must not take down the whole run. The second client
    // here is genuinely broken - its slug does not match its filename - and the
    // first must still be reported as fine.
    const result = await run([
      clientFile(valid),
      clientFile({ ...valid, slug: 'wrong-slug' }, 'other-client.config.json'),
    ]);

    expect(result.output.blocked).toEqual(['wrong-slug']);
    expect(result.output.clients).toHaveLength(2);
    expect(result.output.clients[0].blocked).toBe(false);
  });

  it('accepts several valid clients together', async () => {
    const result = await run([
      clientFile(valid),
      clientFile({ ...valid, slug: 'other-client' }, 'other-client.config.json'),
    ]);

    expect(result.code).toBe(EXIT.OK);
    expect(result.output.blocked).toEqual([]);
  });

  it('omits the trace unless --explain is passed', async () => {
    const plain = await run([clientFile(valid)]);
    const explained = await run([clientFile(valid)], { explain: true });

    expect(Object.hasOwn(plain.output.clients[0], 'trace')).toBe(false);
    expect(explained.output.clients[0].trace['nav.max_reviews'].layer).toBe('defaults');
  });

  it('reports load errors apart from semantic findings', async () => {
    // A load failure means the config cannot be used; a semantic failure means
    // it should not be merged. They are different answers.
    const result = await run([clientFile({ ...valid, nav: { max_reviews: 99_999 } })]);

    expect(result.output.clients[0].load_errors[0]).toContain('ceiling');
    expect(result.output.clients[0].blocked).toBe(true);
  });
});

describe('tpre project — the recovery tool (RB-01)', () => {
  const target = { clientSlug: 'acme-dental', listingKey: 'main' };

  /**
   * @param {any} read
   * @returns {any}
   */
  const build = (read) => {
    /** @type {any[]} */
    const staged = [];

    const command = projectCommand({
      state: { readLedger: async () => read },
      publisher: {
        stage: async (/** @type {any} */ input) => {
          staged.push(input);

          return { written: ['reviews.json'], skipped: [] };
        },
      },
      project: () => ({ files: { reviews: { bytes: '{}', contentHash: 'h' } } }),
      resolveTargets: async () => [target],
    });

    return { command, staged };
  };

  it('rebuilds from a found ledger', async () => {
    const { command, staged } = build({ outcome: 'found', value: { records: new Map() } });
    const result = await command.run({ flags: {} });

    expect(result.code).toBe(EXIT.OK);
    expect(staged).toHaveLength(1);
  });

  it('REFUSES to invent a payload from an unreadable ledger', async () => {
    // An unreadable ledger is not a first publish, and `project` must not treat
    // it as one — that is the IR-25 collapse, arriving through the recovery
    // tool instead of the pipeline.
    const { command, staged } = build({
      outcome: 'unreadable',
      value: null,
      reason: 'could not parse',
    });
    const result = await command.run({ flags: {} });

    expect(result.code).toBe(EXIT.ALL_FAILED);
    expect(staged).toEqual([]);
    expect(result.output.targets[0].reason).toContain('could not parse');
  });

  it('reports an absent ledger without publishing', async () => {
    const { command, staged } = build({ outcome: 'absent', value: null, reason: null });
    const result = await command.run({ flags: {} });

    expect(result.output.targets[0].ok).toBe(false);
    expect(staged).toEqual([]);
  });

  it('imports no acquisition adapter', async () => {
    // The structural guarantee: `project` cannot reach a source because there
    // is nothing in its closure that could.
    const source = readFileSync(new URL('../../../src/cli/commands.mjs', import.meta.url), 'utf8');

    expect(source).not.toContain('adapters/acquisition');
    expect(source).not.toContain('adapters/browser');
  });
});

describe('tpre plan — zero side effects (TR-APP-030)', () => {
  const due = ['a', 'b', 'c', 'd', 'e'];

  it('prints the whole due set by default', async () => {
    const result = await planCommand({ dueSet: async () => due }).run({ flags: {} });

    expect(result.output.total).toBe(5);
    expect(result.output.targets).toEqual(due);
  });

  it('assigns a disjoint slice per shard', async () => {
    // Shards write disjoint paths, and the assignment is what makes that true.
    // Overlapping shards would have two runners writing one client directory.
    const command = planCommand({ dueSet: async () => due });
    const first = await command.run({ flags: { shard: '0', shards: '2' } });
    const second = await command.run({ flags: { shard: '1', shards: '2' } });

    expect(first.output.targets).toEqual(['a', 'c', 'e']);
    expect(second.output.targets).toEqual(['b', 'd']);
    expect([...first.output.targets, ...second.output.targets].sort()).toEqual([...due].sort());
  });

  it('is identical run twice', async () => {
    // Its stated verification is that a reviewer runs it twice and diffs. That
    // only works if it writes nothing at all.
    const command = planCommand({ dueSet: async () => due });
    const first = await command.run({ flags: {} });
    const second = await command.run({ flags: {} });

    expect(JSON.stringify(second.output)).toBe(JSON.stringify(first.output));
  });

  it('always exits 0, because planning cannot fail', async () => {
    const result = await planCommand({ dueSet: async () => [] }).run({ flags: {} });

    expect(result.code).toBe(EXIT.OK);
  });
});

describe('readSecrets — read once, into a sealed object (TR-SEC-011)', () => {
  it('collects only the declared names', () => {
    const secrets = readSecrets({
      TPRE_GITHUB_TOKEN: 'value',
      TPRE_SOMETHING_ELSE: 'ignored',
      PATH: '/usr/bin',
    });

    expect(Object.keys(secrets)).toEqual(['TPRE_GITHUB_TOKEN']);
  });

  it('skips an empty value rather than seeding the redactor with one', () => {
    // Seeding an empty string would make the redactor replace every empty
    // string in every log line.
    expect(Object.keys(readSecrets({ TPRE_GITHUB_TOKEN: '' }))).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(readSecrets({}))).toBe(true);
  });
});
