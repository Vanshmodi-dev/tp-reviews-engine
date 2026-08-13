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

import { createEnricher } from '../app/enrich/index.mjs';
import { createRunStages } from '../app/stages/run-stages.mjs';
import { createCsvAdapter } from '../adapters/acquisition/file-csv/index.mjs';
import { createDomAdapter } from '../adapters/acquisition/google-dom/index.mjs';
import { createBusinessProfileAdapter } from '../adapters/acquisition/google-business-profile-api/index.mjs';
import { createPlacesAdapter } from '../adapters/acquisition/google-places-api/index.mjs';
import { createFilesystemPublisher } from '../adapters/publisher/filesystem.mjs';
import { createGitState } from '../adapters/state/git-state.mjs';
import { readFileSync } from 'node:fs';

import { ERROR_CLASSES, SCHEMA_VERSION, loadPack } from '../core/index.mjs';
import { createSystemClock } from '../infra/clock.mjs';
import { createLogger } from '../infra/logger/jsonl.mjs';
import { createRedactor } from '../infra/logger/redact.mjs';
import { createSystemRandom } from '../infra/random.mjs';
import { createRetryPolicy } from '../infra/retry/policy.mjs';
import {
  doctorCommand,
  harvestCommand,
  planCommand,
  projectCommand,
  validateConfigCommand,
} from './commands.mjs';
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
 * @param {{ env?: Record<string, string | undefined>, stateRoot?: string, dataRoot?: string, denylist?: ReadonlySet<string> }} [options]
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
  const adapters = adapterRegistry(options);

  return {
    env,
    clock,
    random: createSystemRandom(),
    logger,
    redactor,
    state,
    publisher,
    // Stages 1–10, wired. This is what retired `notImplemented`: every stage
    // component existed, and nothing threaded them together.
    runStages: createRunStages({
      resolver: staticResolver(),
      acquire: acquireVia(adapters, secrets),
      state: ledgerPort(state),
      publisher: publisherPort(publisher),
      enricher: createEnricher(),
      denylist: options.denylist ?? new Set(),
      now: () => clock.nowMs(),
      engine: { engine_version: ENGINE_VERSION, schema_version: SCHEMA_VERSION },
      logger,
    }),
    // The taxonomy is injected into the retry mechanism here, because `infra/`
    // is domain-ignorant and may not import `core/`.
    retryPolicy: createRetryPolicy(ERROR_CLASSES),
    // Adapters are registered STATICALLY (EDR-038, ADP-03). No dynamic import,
    // no plugin-directory scan: the set of adapters a build contains is visible
    // in this file and in the dependency graph, which is what makes "which
    // adapter produced this payload" answerable from the source alone.
    adapters,
  };
}

/**
 * Every acquisition adapter this build contains.
 *
 * A plain object, populated at module scope. Dynamic loading would make the
 * adapter set depend on what happened to be on disk at run time, and an
 * incident would begin with working out which code actually ran.
 *
 * @returns {Record<string, any>}
 */
function adapterRegistry(options = {}) {
  // Keyed by each adapter's own `id`, so the registry cannot disagree with the
  // string that lands in a payload's provenance block.
  const registered = [
    createCsvAdapter(),
    createDomAdapter({ browser: lazyBrowser(options), pack: packResolver(options) }),
    createPlacesAdapter(),
    createBusinessProfileAdapter(),
  ];

  return Object.fromEntries(registered.map((adapter) => [adapter.id, adapter]));
}

/**
 * A browser that is launched on first use and never before.
 *
 * Registering the DOM adapter must not cost a Chromium launch. Most runs are
 * CSV or API clients and never touch a page; launching eagerly would add
 * seconds and ~200 MB to every `plan`, `doctor` and `validate-config`
 * invocation, and would make a machine with no browser installed unable to run
 * commands that need no browser.
 *
 * One browser per shard, reused across targets (BRW-01) — the launch is the
 * expensive part, the per-target context is not.
 *
 * @param {any} options
 * @returns {{ openTarget: (listing?: any) => Promise<any> }}
 */
function lazyBrowser(options) {
  // The PROMISE is memoised, not the resolved browser. Two targets opening
  // concurrently would both see a null browser and both launch one — the
  // second silently orphaning the first, which then never closes and holds its
  // memory for the life of the shard. Storing the in-flight promise makes the
  // second caller await the first launch instead of starting another.
  /** @type {Promise<any> | null} */
  let launching = null;

  const launch = async () => {
    const { launchBrowser } = await import('../adapters/browser/playwright-chromium.mjs');

    return launchBrowser({
      allowedHosts: options.allowedHosts ?? ['google.com', 'gstatic.com', 'googleapis.com'],
      ...(options.env?.TPRE_ENV === undefined ? {} : { environment: options.env.TPRE_ENV }),
    });
  };

  return {
    async openTarget(listing) {
      launching ??= launch();

      return (await launching).openTarget(listing);
    },
  };
}

/**
 * Resolves the pinned selector pack for a source.
 *
 * Pinning lives in `profiles/` and nowhere else (TR-SEL-004) — not in a client
 * config and not in code. This reads the pin and loads the named pack; it does
 * not choose one, because "which selectors does this client use" must be
 * answerable by reading one profile file.
 *
 * @param {any} options
 * @returns {(source: string) => any}
 */
function packResolver(options) {
  /** @type {Map<string, any>} */
  const cache = new Map();

  return (source) => {
    if (cache.has(source)) return cache.get(source);

    const version = options.selectorPacks?.[source];

    if (typeof version !== 'string' || version === '') return null;

    const loaded = loadPack(readFileSync(`selectors/${source}-maps/${version}.json`, 'utf8'), {
      source,
    });
    const pack = loaded.ok === true ? loaded.value : null;

    cache.set(source, pack);

    return pack;
  };
}

/**
 * Resolution for adapters that have nothing to resolve.
 *
 * A CSV file is not a listing that can be renamed, merged, or repointed — the
 * operator supplied the path and that IS the identity. Running the DOM
 * resolver against it would demand an `expected_name` and a browser for no
 * gain, and would fail closed on both.
 *
 * `google:dom` gets `createListingResolver` instead, wired with a browser, when
 * that adapter is built. Keeping the choice here rather than inside
 * `runStages` is DR-5: the pipeline should not know which adapter it is
 * running.
 *
 * @returns {{ resolve: (input: any) => Promise<any> }}
 */
function staticResolver() {
  return {
    async resolve(input) {
      return { ok: true, value: staticIdentity(input) };
    },
  };
}

/**
 * @param {any} input
 * @returns {any}
 */
function staticIdentity({ listing, config }) {
  const identity = listing?.identity ?? {};

  return {
    canonicalId: firstString([identity.place_id, identity.source_file, listing?.key, 'static']),
    canonicalUrl: identity.url ?? null,
    displayName: firstString([config?.resolution?.expected_name, listing?.expected_name, '']),
    // Null, never derived. A CSV advertises no total, and inventing one from
    // the row count would make coverage permanently 1.0 and G-08 permanently
    // silent.
    advertisedTotal: null,
    advertisedRating: null,
    resolvedVia: 'static',
    source: firstString([listing?.source, 'csv']),
  };
}

/**
 * The first non-empty string in a preference order.
 *
 * @param {ReadonlyArray<unknown>} candidates
 * @returns {string}
 */
function firstString(candidates) {
  const found = candidates.find((value) => typeof value === 'string' && value !== '');

  return typeof found === 'string' ? found : '';
}

/**
 * Stage 2, dispatched by the listing's declared adapter.
 *
 * An unknown adapter id is a refusal, not a default. Falling back to any
 * adapter would harvest a client by a method their authorisation record does
 * not cover — which is the one failure V-3 exists to make impossible.
 *
 * @param {Record<string, any>} adapters
 * @param {Readonly<Record<string, string>>} secrets
 * @returns {(request: any) => Promise<any>}
 */
function acquireVia(adapters, secrets) {
  return async (request) => {
    const id = request.listing?.adapter;
    const adapter = adapters[id];

    if (adapter === undefined) {
      return {
        ok: false,
        error: {
          code: 'ERR-CONFIG-INVALID',
          message: `no adapter registered for "${id}". Registered: ${Object.keys(adapters).join(', ')}`,
        },
      };
    }

    const result = await adapter.harvest({
      ...request,
      secrets: { ...secrets, ...request.secrets },
    });

    // Adapters report their own id; the pipeline stamps it into provenance so
    // "which adapter produced this payload" is answerable from the data alone.
    return result.ok === false
      ? result
      : { ok: true, value: { adapter_id: adapter.id, ...result.value } };
  };
}

/**
 * The ledger port `runStages` expects, over the state adapter's two-key API.
 *
 * @param {any} state
 * @returns {any}
 */
function ledgerPort(state) {
  return {
    /**
     * Three outcomes, and the third is the one that matters.
     *
     * `found` returns the ledger. `absent` returns null, and the pipeline
     * creates an empty one — genuinely no history, so every absence rule
     * applies normally.
     *
     * `unreadable` THROWS. It means the file exists and could not be parsed,
     * which is not the same as "no history" and must never be flattened into
     * it: reconciling against an empty ledger would see every existing review
     * as absent and start tombstoning a client's entire corpus (INV-04).
     * Refusing the target leaves the last good payload published.
     *
     * @param {string} listingKey
     * @param {string} clientSlug
     * @returns {Promise<any>}
     */
    async readLedger(listingKey, clientSlug) {
      const read = await state.readLedger(clientSlug, listingKey);

      if (read.outcome === 'unreadable') {
        const error = new Error(`the ledger exists but could not be read: ${read.reason}`);

        /** @type {any} */ (error).code = 'ERR-STATE-UNREADABLE';

        throw error;
      }

      return read.outcome === 'found' ? read.value : null;
    },
    writeLedger: (
      /** @type {string} */ listingKey,
      /** @type {any} */ ledger,
      /** @type {string} */ clientSlug,
    ) => state.writeLedger(clientSlug, listingKey, ledger),
  };
}

/**
 * The publisher port `runStages` expects.
 *
 * `publish` STAGES rather than commits. Commits are one per shard per branch,
 * not one per target (CON-13, PUB-03) — the harvest command commits once after
 * every target has run. A commit here would produce one commit per client and
 * make the repository grow with traffic rather than with change.
 *
 * `read` parses, because the gate compares payload objects while the adapter
 * stores bytes.
 *
 * @param {any} publisher
 * @returns {any}
 */
function publisherPort(publisher) {
  return {
    async read(/** @type {string} */ listingKey, /** @type {string} */ clientSlug) {
      const bytes = await publisher.readCurrent(clientSlug, listingKey);

      if (bytes === null) return null;

      try {
        return JSON.parse(bytes);
      } catch {
        // Unreadable is NOT absent. Returning null would tell the gate there is
        // no prior payload, and every count-drop rule would pass against
        // nothing (INV-04).
        return { __unreadable: true };
      }
    },
    publish: (/** @type {any} */ input) => publisher.stage(input),
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
    planCommand(
      // `clients` is the PH-17 path — real configs through the pure registry.
      // `dueSet` is the pre-PH-17 shape, kept so a caller supplying only that
      // still works rather than silently planning nothing.
      defined({
        clients: deps.clients,
        health: deps.health,
        now: deps.now,
        dueSet: deps.dueSet ?? (async () => []),
      }),
    ),
    harvestCommand(
      defined({
        runId: deps.runId ?? 'local',
        clients: deps.clients ?? (async () => []),
        health: deps.health ?? (async () => ({})),
        // The eleven stages arrive from here, not from the command. Wired in
        // SP-8; `notImplemented` is gone. A caller may still override this —
        // the tests do — but the default is now a real pipeline.
        runStages: deps.runStages,
        gate: deps.gate,
        now: deps.now,
        budgets: deps.budgets,
        writeManifest: deps.writeManifest,
        engine: deps.engine,
      }),
    ),
  ];
}

/**
 * Drops keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` distinguishes "absent" from "present and
 * undefined", so passing an unset dependency through would be a type error —
 * and spreading a conditional per key turns a wiring list into a thicket of
 * ternaries that hides which dependencies actually exist.
 *
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 */
function defined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
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
