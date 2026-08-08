/**
 * The CLI boundary (T-168, T-169, T-171).
 *
 * ## Two rules that only hold at this exact line
 *
 * **`process.exit()` is called nowhere else** (TR-CLI-003). Every other layer
 * returns a value. A module that exits cannot be tested, cannot be composed,
 * and cannot let a later stage clean up after it — and "just this once, in an
 * error path" is how a run learns to die before flushing its logs.
 *
 * **Everything is flushed before every exit, including failures**
 * (TR-CLI-004). The failures are exactly the runs whose diagnostics matter, and
 * they are exactly the runs where an early exit is most tempting.
 *
 * ## An unknown flag is a usage error (TR-CLI-006)
 *
 * The same failure class as EDR-006's unknown environment variable, and for the
 * same reason: silently tolerating `--max-review` means the operator believes a
 * setting took effect that never did, and every number they read afterwards is
 * measured against an intent the engine never received.
 *
 * ## The argument parser (T-169, OIQ-01)
 *
 * `node:util`'s `parseArgs` is used, and no dependency is added. It covers what
 * this CLI needs — long flags, values, `--` passthrough — and its one gap,
 * `strict: true` throwing rather than returning, is handled by catching once
 * here. A dependency is justified by a documented gap, and there is not one.
 *
 * @module cli/index
 */

import { parseArgs } from 'node:util';

import { EXIT, EXIT_MEANINGS } from './exit-codes.mjs';

/**
 * @typedef {object} Command
 * @property {string} name
 * @property {string} summary
 * @property {import('node:util').ParseArgsConfig['options']} [options]
 * @property {(context: any) => Promise<{ code: number, output?: unknown }>} run
 */

/** How wide the command column is in the usage listing. */
const COMMAND_COLUMN = 18;

/**
 * Flags every command accepts.
 *
 * @type {import('node:util').ParseArgsConfig['options']}
 */
const GLOBAL_OPTIONS = Object.freeze({
  help: { type: 'boolean' },
  version: { type: 'boolean' },
  output: { type: 'string' },
  'log-level': { type: 'string' },
});

/**
 * Builds the CLI.
 *
 * The command registry is injected rather than imported so that this module
 * stays testable without constructing a single adapter — and so `composition.mjs`
 * remains the only place concrete implementations are built (DR-5).
 *
 * @param {{ commands: ReadonlyArray<Command>, write: (line: string) => void, writeError: (line: string) => void, version: string }} deps
 * @returns {{ run: (argv: string[]) => Promise<number> }}
 */
export function createCli({ commands, write, writeError, version }) {
  const byName = new Map(commands.map((command) => [command.name, command]));

  return { run };

  /**
   * The flags that are handled before any command is looked up.
   *
   * @param {string | undefined} name
   * @returns {number | null} A code, or null to continue dispatching.
   */
  function handleGlobal(name) {
    if (name === undefined || name === '--help' || name === '-h') {
      write(usage(commands));

      return EXIT.OK;
    }

    if (name === '--version' || name === '-v') {
      write(version);

      return EXIT.OK;
    }

    return null;
  }

  /**
   * Parses a command's arguments, or reports usage and returns null.
   *
   * `strict: true` means an unknown flag throws rather than being collected and
   * ignored — which is the whole of TR-CLI-006.
   *
   * @param {Command} command
   * @param {string[]} rest
   * @returns {any}
   */
  function parse(command, rest) {
    try {
      return parseArgs({
        args: rest,
        options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      writeError(`${describe(error)}`);
      writeError(usageFor(command));

      return null;
    }
  }

  /**
   * @param {string[]} argv
   * @returns {Promise<number>}
   */
  async function run(argv) {
    const [name, ...rest] = argv;

    const global = handleGlobal(name);
    if (global !== null) return global;

    const command = byName.get(/** @type {string} */ (name));

    if (command === undefined) {
      writeError(`unknown command: ${name}`);
      writeError(usage(commands));

      return EXIT.USAGE;
    }

    const parsed = parse(command, rest);

    if (parsed === null) return EXIT.USAGE;

    if (parsed.values.help === true) {
      write(usageFor(command));

      return EXIT.OK;
    }

    try {
      const result = await command.run({ flags: parsed.values, args: parsed.positionals });

      if (result.output !== undefined) write(formatOutput(result.output, parsed.values.output));

      return result.code;
    } catch (error) {
      // TR-CLI-005. An uncaught exception is a defect, not an expected failure,
      // so it is classified as internal and mapped to exit 1. The stack goes to
      // the error stream and never to stdout, because stdout may be a JSON
      // document something downstream is parsing.
      writeError(`ERR-INTERNAL-UNCLASSIFIED: ${describe(error)}`);

      if (error instanceof Error && typeof error.stack === 'string') writeError(error.stack);

      return EXIT.INTERNAL;
    }
  }
}

/**
 * @param {unknown} output
 * @param {unknown} format
 * @returns {string}
 */
function formatOutput(output, format) {
  if (format === 'json') return JSON.stringify(output, null, 2);

  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {ReadonlyArray<Command>} commands
 * @returns {string}
 */
function usage(commands) {
  const lines = [
    'tpre — TP Reviews Engine',
    '',
    'Usage: tpre <command> [options]',
    '',
    'Commands:',
    ...commands.map((command) => `  ${command.name.padEnd(COMMAND_COLUMN)}${command.summary}`),
    '',
    'Exit codes:',
    ...Object.entries(EXIT_MEANINGS).map(([code, meaning]) => `  ${code}  ${meaning}`),
  ];

  return lines.join('\n');
}

/**
 * @param {Command} command
 * @returns {string}
 */
function usageFor(command) {
  const options = Object.keys({ ...GLOBAL_OPTIONS, ...(command.options ?? {}) });

  return [
    `Usage: tpre ${command.name} [options]`,
    '',
    command.summary,
    '',
    'Options:',
    ...options.map((option) => `  --${option}`),
  ].join('\n');
}

/**
 * Runs the CLI and exits, flushing first.
 *
 * The **only** place in the engine that calls `process.exit`. `flush` runs
 * before the exit for every code, including failures — TR-CLI-004 — because the
 * failing runs are exactly the ones whose logs and diagnostics matter, and
 * exactly the ones where skipping the flush is most tempting.
 *
 * @param {{ run: (argv: string[]) => Promise<number> }} cli
 * @param {string[]} argv
 * @param {{ flush: () => Promise<void>, exit: (code: number) => void }} host
 * @returns {Promise<void>}
 */
export async function runAndExit(cli, argv, host) {
  /** @type {number} */
  let code;

  try {
    code = await cli.run(argv);
  } finally {
    // In a `finally`, so a throw escaping `run` still flushes. A crash that
    // loses its own diagnostics is a crash nobody can explain. The throw then
    // continues, so `host.exit` below is unreachable on that path and the
    // caller sees the original error.
    await host.flush();
  }

  host.exit(code);
}

export { EXIT, EXIT_MEANINGS } from './exit-codes.mjs';
