/**
 * The configuration loader — six layers to one frozen, traced result.
 *
 * ```
 * 1 defaults  →  2 profile  →  3 client  →  4 listing  →  5 environment  →  6 flags
 * ```
 *
 * Later layers win key by key, objects merge deeply, **arrays replace**
 * (TR-CFG-020). Everything about why is in `merge.mjs`.
 *
 * ## The loader returns a Result; it does not throw
 *
 * A malformed config is expected input, not a programmer error. `app/` is
 * orchestration, and an orchestrator that throws on bad configuration cannot
 * report *which* client was misconfigured while continuing with the others —
 * which is the whole point of per-target isolation (INV-09).
 *
 * @module app/config
 */

import { DEFAULTS } from './defaults.mjs';
import { readEnvironment } from './environment.mjs';
import { checkLimits, describeViolation } from './limits.mjs';
import { deepFreeze, resolveLayers } from './merge.mjs';

/**
 * The `config_version` this engine writes and understands.
 *
 * Bumping it requires a migration in {@link MIGRATIONS}. That is enforced by
 * test rather than by convention: a version with no path from the previous one
 * is a config file nobody can load.
 */
export const CONFIG_VERSION = 1;

/**
 * Ordered N → N+1 migrations (EDR-005).
 *
 * Ordered and incremental rather than "read any old shape": each migration only
 * has to know about the version immediately before it, so adding version 4 does
 * not require re-reading how version 1 worked. A loader with one big
 * compatibility branch accumulates every past shape forever and is never
 * finished.
 *
 * @type {Readonly<Record<number, (config: any) => any>>}
 */
export const MIGRATIONS = Object.freeze({
  // Version 1 is the first published shape, so there is nothing before it. The
  // table exists now so the first real migration is an entry rather than an
  // architecture change under time pressure.
});

/**
 * Applies every migration needed to bring a config to {@link CONFIG_VERSION}.
 *
 * @param {any} config
 * @returns {{ ok: true, value: any, applied: number[] } | { ok: false, error: string }}
 */
export function migrate(config) {
  let current = config;
  const applied = [];
  let version = typeof current?.config_version === 'number' ? current.config_version : 1;

  if (version > CONFIG_VERSION) {
    // A config from the future. Refusing is the only safe answer: this engine
    // cannot know what a later version means, and guessing would silently
    // discard whatever it did not understand.
    return {
      ok: false,
      error: `config_version ${version} is newer than this engine understands (${CONFIG_VERSION}); upgrade the engine`,
    };
  }

  while (version < CONFIG_VERSION) {
    const step = MIGRATIONS[version];

    if (step === undefined) {
      return { ok: false, error: `no migration from config_version ${version} to ${version + 1}` };
    }

    current = step(current);
    applied.push(version);
    version += 1;
  }

  return { ok: true, value: { ...current, config_version: CONFIG_VERSION }, applied };
}

/**
 * @typedef {object} LoadInput
 * @property {Record<string, any>} [profile]   Layer 2.
 * @property {Record<string, any>} [client]    Layer 3.
 * @property {Record<string, any>} [listing]   Layer 4.
 * @property {Record<string, string | undefined>} [env]  Layer 5.
 * @property {Record<string, any>} [flags]     Layer 6.
 */

/**
 * Resolves the effective configuration.
 *
 * @param {LoadInput} [input]
 * @returns {{ ok: true, value: any, trace: any, run: Record<string, string> } | { ok: false, errors: string[] }}
 */
export function loadConfig(input = {}) {
  const environment = readEnvironment(input.env ?? {}, DEFAULTS);

  if (environment.errors.length > 0) {
    // Reported before anything else is resolved. An unknown variable means the
    // operator's intent and the engine's understanding have already diverged,
    // and every value computed after that point is answering a question nobody
    // asked.
    return { ok: false, errors: environment.errors };
  }

  const migratedClient = migrateLayer(input.client);

  if (migratedClient.ok === false) return { ok: false, errors: [migratedClient.error] };

  const { config, trace } = resolveLayers([
    { layer: 'defaults', values: DEFAULTS },
    { layer: 'profile', values: input.profile ?? {} },
    { layer: 'client', values: migratedClient.value },
    { layer: 'listing', values: input.listing ?? {} },
    { layer: 'environment', values: environment.values },
    { layer: 'flags', values: input.flags ?? {} },
  ]);

  const violations = checkLimits(config);

  if (violations.length > 0) {
    // Every violation, not the first. An operator fixing one rejection per
    // validation run spends a morning on what one message could have said.
    return { ok: false, errors: violations.map((violation) => describeViolation(violation)) };
  }

  return {
    ok: true,
    value: deepFreeze(config),
    trace: deepFreeze(trace),
    run: environment.run,
  };
}

/**
 * @param {Record<string, any> | undefined} client
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
function migrateLayer(client) {
  if (client === undefined) return { ok: true, value: {} };

  const result = migrate(client);

  return result.ok ? { ok: true, value: result.value } : result;
}

export { DEFAULTS, defaultKeyPaths } from './defaults.mjs';
export { LIMITS, checkLimits, describeViolation, readPath } from './limits.mjs';
export { LAYERS, deepFreeze, leafPaths, mergeLayer, resolveLayers } from './merge.mjs';
export {
  PREFIX,
  RUN_VARIABLES,
  coerce,
  knownVariables,
  nearestVariable,
  readEnvironment,
  variableNameFor,
} from './environment.mjs';
