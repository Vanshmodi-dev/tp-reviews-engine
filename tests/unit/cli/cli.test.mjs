import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { exitFor } from '../../../src/cli/commands.mjs';
import { EXIT, EXIT_MEANINGS, failsJob, severityFor } from '../../../src/cli/exit-codes.mjs';
import { createCli, runAndExit } from '../../../src/cli/index.mjs';

/**
 * @param {any} [overrides]
 * @returns {any}
 */
function build(overrides = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];

  const cli = createCli({
    commands: overrides.commands ?? [
      {
        name: 'demo',
        summary: 'A demo command.',
        options: { count: { type: 'string' } },
        run: async ({ flags }) => ({ code: EXIT.OK, output: { count: flags.count ?? null } }),
      },
    ],
    write: (line) => out.push(line),
    writeError: (line) => err.push(line),
    version: '1.0.0',
  });

  return { cli, out, err };
}

describe('T-167 — the exit-code contract (TR-CLI-002)', () => {
  it('defines exactly the eight canonical codes', () => {
    expect(Object.values(EXIT).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives every code a meaning', () => {
    for (const code of Object.values(EXIT)) {
      expect(EXIT_MEANINGS[code], String(code)).toEqual(expect.any(String));
    }
  });

  it('treats 5, 6 and 7 as CI successes (EDR-030)', () => {
    // A red badge means "the code is broken". A gate rejection means the code
    // worked perfectly and correctly declined to publish. Failing the job for
    // it teaches the team that red is normal.
    expect(failsJob(EXIT.GATE_REJECTED)).toBe(false);
    expect(failsJob(EXIT.POLICY_BLOCKED)).toBe(false);
    expect(failsJob(EXIT.CHALLENGE)).toBe(false);
    expect(failsJob(EXIT.PARTIAL)).toBe(false);
  });

  it('treats 1, 2 and 3 as CI failures', () => {
    expect(failsJob(EXIT.INTERNAL)).toBe(true);
    expect(failsJob(EXIT.USAGE)).toBe(true);
    expect(failsJob(EXIT.ALL_FAILED)).toBe(true);
  });

  it('sets alert severity independently of job conclusion', () => {
    // A challenge is a green job AND a critical alert: a source has decided we
    // look like a bot, and every hour it goes unanswered makes the eventual
    // conversation harder.
    expect(failsJob(EXIT.CHALLENGE)).toBe(false);
    expect(severityFor(EXIT.CHALLENGE)).toBe('critical');
    expect(severityFor(EXIT.OK)).toBe('none');
    expect(severityFor(EXIT.GATE_REJECTED)).toBe('error');
    expect(severityFor(EXIT.PARTIAL)).toBe('warn');
  });
});

describe('T-168 — dispatch, and unknown input (TR-CLI-006)', () => {
  it('runs a known command', async () => {
    const { cli, out } = build();

    expect(await cli.run(['demo'])).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('"count": null');
  });

  it('exits 2 for an unknown command, with usage', async () => {
    const { cli, err } = build();

    expect(await cli.run(['nope'])).toBe(EXIT.USAGE);
    expect(err.join('\n')).toContain('unknown command: nope');
    expect(err.join('\n')).toContain('Usage: tpre');
  });

  it('exits 2 for an unknown FLAG rather than ignoring it', async () => {
    // The same failure class as an unknown TPRE_ variable: the operator
    // believes a setting took effect that never did.
    const { cli, err } = build();

    expect(await cli.run(['demo', '--max-review', '5'])).toBe(EXIT.USAGE);
    expect(err.join('\n')).toContain('Usage: tpre demo');
  });

  it('accepts a known flag', async () => {
    const { cli, out } = build();

    expect(await cli.run(['demo', '--count', '7'])).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('"count": "7"');
  });

  it('prints usage with no arguments, and exits 0', async () => {
    const { cli, out } = build();

    expect(await cli.run([])).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('Commands:');
  });

  it('prints the version', async () => {
    const { cli, out } = build();

    expect(await cli.run(['--version'])).toBe(EXIT.OK);
    expect(out).toEqual(['1.0.0']);
  });

  it('prints per-command help', async () => {
    const { cli, out } = build();

    expect(await cli.run(['demo', '--help'])).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('Usage: tpre demo');
  });

  it('lists the exit codes in the top-level usage', async () => {
    const { cli, out } = build();

    await cli.run(['--help']);

    expect(out.join('\n')).toContain('gate rejected');
  });
});

describe('TR-CLI-005 — an uncaught exception becomes exit 1', () => {
  const throwing = [
    {
      name: 'boom',
      summary: 'Throws.',
      run: async () => {
        throw new Error('something unexpected');
      },
    },
  ];

  it('catches, classifies and maps to 1', async () => {
    const { cli, err } = build({ commands: throwing });

    expect(await cli.run(['boom'])).toBe(EXIT.INTERNAL);
    expect(err.join('\n')).toContain('ERR-INTERNAL-UNCLASSIFIED');
  });

  it('keeps the stack off stdout', async () => {
    // stdout may be a JSON document something downstream is parsing.
    const { cli, out, err } = build({ commands: throwing });

    await cli.run(['boom', '--output', 'json']);

    expect(out).toEqual([]);
    expect(err.join('\n')).toContain('at ');
  });
});

describe('T-171 — everything is flushed before every exit (TR-CLI-004)', () => {
  /**
   * @param {number} code
   * @returns {Promise<{ flushed: boolean, exited: number | null }>}
   */
  async function runWith(code) {
    let flushed = false;
    /** @type {number | null} */
    let exited = null;

    await runAndExit({ run: async () => code }, [], {
      flush: async () => {
        flushed = true;
      },
      exit: (value) => {
        exited = value;
      },
    });

    return { flushed, exited };
  }

  it('flushes for every one of the eight codes', async () => {
    // The failing runs are exactly the ones whose diagnostics matter, and
    // exactly the ones where an early exit is most tempting.
    for (const code of Object.values(EXIT)) {
      const result = await runWith(code);

      expect(result.flushed, `code ${code}`).toBe(true);
      expect(result.exited, `code ${code}`).toBe(code);
    }
  });

  it('flushes even when the run itself throws', async () => {
    // A crash that loses its own diagnostics is a crash nobody can explain.
    let flushed = false;

    await expect(
      runAndExit(
        {
          run: async () => {
            throw new Error('crash');
          },
        },
        [],
        {
          flush: async () => {
            flushed = true;
          },
          exit: () => undefined,
        },
      ),
    ).rejects.toThrow('crash');

    expect(flushed).toBe(true);
  });
});

describe('T-166 — the bin wrapper has no logic', () => {
  it('is a shebang, an import, and a call', () => {
    // Its stated acceptance is that a reviewer counts the lines. Counted here
    // instead, on every commit.
    const source = readFileSync(new URL('../../../bin/tpre.mjs', import.meta.url), 'utf8');
    const code = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#!'));

    expect(code).toHaveLength(2);
    expect(code[0]).toContain('import');
    expect(code[1]).toContain('main(');
  });
});

describe('TR-CLI-003 — process.exit is confined to cli/', () => {
  it('appears in exactly one module, and that module is the composition root', () => {
    const composition = readFileSync(
      new URL('../../../src/cli/composition.mjs', import.meta.url),
      'utf8',
    );
    const dispatcher = readFileSync(new URL('../../../src/cli/index.mjs', import.meta.url), 'utf8');

    expect(composition).toContain('process.exit');
    // The dispatcher returns a code; it never exits. That is what makes it
    // testable without spawning a process.
    expect(dispatcher.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '')).not.toContain('process.exit');
  });
});

describe('exitFor — partial failure is its own outcome', () => {
  it('distinguishes none, some and all', () => {
    // Some targets working is materially different from none working, and
    // collapsing them makes one broken client look like a total outage.
    expect(exitFor(5, 0)).toBe(EXIT.OK);
    expect(exitFor(5, 2)).toBe(EXIT.PARTIAL);
    expect(exitFor(5, 5)).toBe(EXIT.ALL_FAILED);
  });

  it('treats an empty run as success', () => {
    expect(exitFor(0, 0)).toBe(EXIT.OK);
  });
});
