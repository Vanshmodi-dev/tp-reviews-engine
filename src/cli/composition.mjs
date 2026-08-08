/**
 * THE composition root (T-170, DR-5, TR-CLI-001).
 *
 * ============================================================================
 * THE ONLY FILE IN THE ENGINE THAT CONSTRUCTS A CONCRETE IMPLEMENTATION.
 * ============================================================================
 *
 * ## Why exactly one place, enforced by an architecture test
 *
 * Everything below this file takes its dependencies as arguments. That is what
 * makes the pipeline testable without a browser, a network, or a git remote —
 * and what makes "swap the review source" a change to one adapter rather than a
 * change to the pipeline.
 *
 * The moment a second file constructs an adapter, that property is gone and
 * nobody notices, because the code still works. It stops working later, when
 * somebody tries to test the thing that reached for a real implementation
 * halfway down.
 *
 * ## Boot order is not negotiable (§11.5, LOG-ORD-01)
 *
 * 1. Read the environment.
 * 2. Load and validate configuration.
 * 3. Read secrets into a sealed object, exactly once.
 * 4. **Seed the redaction filter with every secret value.**
 * 5. **Construct the logger.**
 *
 * Step 4 before step 5 is the whole of IR-21: a logger built before the filter
 * is seeded can emit a secret in its own startup event. The signature of
 * `createLogger` enforces it — a redactor is a required argument — but the
 * ordering is written here too, because the next person to add a step will add
 * it wherever it reads naturally.
 *
 * @module cli/composition
 */

import { createFilesystemPublisher } from '../adapters/publisher/filesystem.mjs';
import { createGitState } from '../adapters/state/git-state.mjs';
import { ERROR_CLASSES } from '../core/index.mjs';
import { createSystemClock } from '../infra/clock.mjs';
import { createLogger } from '../infra/logger/jsonl.mjs';
import { createRedactor } from '../infra/logger/redact.mjs';
import { createSystemRandom } from '../infra/random.mjs';
import { createRetryPolicy } from '../infra/retry/policy.mjs';
import { doctorCommand, planCommand, projectCommand, validateConfigCommand } from './commands.mjs';
import { createCli, runAndExit } from './index.mjs';

/** The engine version, reported by `--version` and stamped into provenance. */
export const ENGINE_VERSION = '1.0.0';

/**
 * Secret names read from the environment.
 *
 * Read once into a sealed object (TR-SEC-011) and used to seed redaction. They
 * are deliberately not merged into the config: a secret in the config is a
 * secret in the resolution trace, and the trace goes into diagnostics bundles.
 */
const SECRET_NAMES = Object.freeze([
  'TPRE_GITHUB_TOKEN',
  'TPRE_GOOGLE_API_KEY',
  'TPRE_WEBHOOK_URL',
]);

/**
 * Reads secrets into a frozen object.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Readonly<Record<string, string>>}
 */
export function readSecrets(env) {
  /** @type {Record<string, string>} */
  const secrets = {};

  for (const name of SECRET_NAMES) {
    const value = env[name];

    if (typeof value === 'string' && value !== '') secrets[name] = value;
  }

  return Object.freeze(secrets);
}

/**
 * Builds every concrete dependency.
 *
 * @param {{ env?: Record<string, string | undefined>, stateRoot?: string, dataRoot?: string }} [options]
 * @returns {any}
 */
export function buildDependencies(options = {}) {
  const env = options.env ?? process.env;

  // Step 3 then 4 then 5. See the module header.
  const secrets = readSecrets(env);
  const redactor = createRedactor(secrets);
  const clock = createSystemClock();
  const logger = createLogger({
    redactor,
    clock,
    level: env.TPRE_LOG_LEVEL ?? 'info',
  });

  const state = createGitState({ root: options.stateRoot ?? '.state' });
  const publisher = createFilesystemPublisher({ root: options.dataRoot ?? '.publish' });

  return {
    env,
    clock,
    random: createSystemRandom(),
    logger,
    redactor,
    state,
    publisher,
    // The taxonomy is injected into the retry mechanism here, because `infra/`
    // is domain-ignorant and may not import `core/`.
    retryPolicy: createRetryPolicy(ERROR_CLASSES),
  };
}

/**
 * The command registry.
 *
 * @param {any} deps
 * @returns {any[]}
 */
export function buildCommands(deps) {
  return [
    doctorCommand({ checks: environmentChecks(deps) }),
    validateConfigCommand({ env: deps.env, readClients: deps.readClients ?? (async () => []) }),
    projectCommand({
      state: deps.state,
      publisher: deps.publisher,
      project: deps.project ?? (() => ({ files: {} })),
      resolveTargets: deps.resolveTargets ?? (async () => []),
    }),
    planCommand({ dueSet: deps.dueSet ?? (async () => []) }),
  ];
}

/**
 * The checks `doctor` reports on.
 *
 * @param {any} deps
 * @returns {any[]}
 */
function environmentChecks(deps) {
  return [
    {
      name: 'node version',
      run: async () => ({ ok: true, detail: process.version }),
    },
    {
      name: 'secrets present',
      run: async () => {
        const missing = SECRET_NAMES.filter((name) => deps.env[name] === undefined);

        return {
          ok: missing.length === 0,
          // Names only. A doctor that printed values would be the leak the
          // redactor exists to prevent, in the one command an operator runs
          // while pasting output into an issue.
          detail: missing.length === 0 ? 'all present' : `missing: ${missing.join(', ')}`,
        };
      },
    },
    {
      name: 'redaction seeded',
      run: async () => ({
        ok: deps.redactor.secretCount > 0,
        detail: `${deps.redactor.secretCount} secret value(s) seeded`,
      }),
    },
    {
      name: 'state checkout',
      run: async () => {
        const read = await deps.state.readBudget('doctor-probe');

        // `absent` is healthy: it means the checkout is readable and simply has
        // no budget file yet. `unreadable` means something is wrong with it.
        return { ok: read.outcome !== 'unreadable', detail: read.reason ?? read.outcome };
      },
    },
  ];
}

/**
 * The entry point `bin/tpre.mjs` delegates to.
 *
 * @param {string[]} argv
 * @param {any} [overrides] Injected by tests, so `main` itself stays exercised.
 * @returns {Promise<void>}
 */
export async function main(argv, overrides = {}) {
  const deps = { ...buildDependencies(overrides), ...overrides };
  const cli = createCli({
    commands: overrides.commands ?? buildCommands(deps),
    write: (line) => process.stdout.write(`${line}\n`),
    writeError: (line) => process.stderr.write(`${line}\n`),
    version: ENGINE_VERSION,
  });

  await runAndExit(cli, argv, {
    // TR-CLI-004: flushed before every exit, including failures.
    flush: async () => {
      const buffered = deps.logger.flushBuffered();

      if (buffered.length > 0)
        deps.logger.info('flushed buffered diagnostics', {
          events: buffered.length,
        });
    },
    exit: overrides.exit ?? ((code) => process.exit(code)),
  });
}
