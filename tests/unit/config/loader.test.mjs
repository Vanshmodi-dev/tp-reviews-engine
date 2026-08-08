import { describe, expect, it } from 'vitest';

import {
  CONFIG_VERSION,
  DEFAULTS,
  LAYERS,
  coerce,
  defaultKeyPaths,
  loadConfig,
  mergeLayer,
  migrate,
  nearestVariable,
  readEnvironment,
  readPath,
  variableNameFor,
} from '../../../src/app/config/index.mjs';
import { LIMITS, checkLimits } from '../../../src/app/config/limits.mjs';

/**
 * Loads and asserts success, returning the result.
 *
 * `loadConfig` returns a discriminated union and `expect(result.ok)` does not
 * narrow it. Asserting here rather than casting at every call site means a test
 * whose load unexpectedly fails says so — instead of reading `undefined` off an
 * error result and failing somewhere less obvious.
 *
 * @param {any} [input]
 * @returns {any}
 */
function loadOk(input = {}) {
  const result = loadConfig(input);

  if (result.ok !== true) {
    throw new Error(`expected a valid config, got: ${result.errors.join('; ')}`);
  }

  return result;
}

/**
 * Loads and asserts failure, returning the errors.
 *
 * @param {any} [input]
 * @returns {string[]}
 */
function loadErrors(input = {}) {
  const result = loadConfig(input);

  if (result.ok === true) throw new Error('expected the config to be rejected');

  return result.errors;
}

describe('T-156 — every schema key has a code default (TR-APP-031)', () => {
  it('enumerates a non-trivial surface, so the check is not vacuous', () => {
    expect(defaultKeyPaths().length).toBeGreaterThan(30);
  });

  it('gives every default a concrete value, never undefined', () => {
    // A key with no default has an undefined value until somebody sets it, and
    // the engine's behaviour then depends on a file that may not exist.
    for (const path of defaultKeyPaths()) {
      expect(readPath(DEFAULTS, path), path).not.toBeUndefined();
    }
  });

  it('gives every bounded key a default inside its own bounds', () => {
    // A default violating its own ceiling would fail validation on a config
    // that set nothing at all.
    expect(checkLimits(DEFAULTS)).toEqual([]);
  });

  it('treats null as a value rather than a missing key', () => {
    // `display.min_rating: null` means "do not filter" and
    // `display.languages: null` means "all languages". Both are decisions.
    expect(defaultKeyPaths()).toContain('display.min_rating');
    expect(defaultKeyPaths()).toContain('display.languages');
    expect(DEFAULTS.display.min_rating).toBeNull();
  });

  it('keeps the product defaults the documents insist on', () => {
    expect(DEFAULTS.display.min_rating).toBeNull();
    expect(DEFAULTS.publish.schema_org).toBe(false);
    expect(DEFAULTS.reconcile.keep_tombstones).toBe(true);
  });
});

describe('T-162 — the precedence matrix', () => {
  const layered = (/** @type {any} */ overrides) => loadOk({ env: {}, ...overrides });

  it('orders the six layers weakest first', () => {
    expect(LAYERS).toEqual(['defaults', 'profile', 'client', 'listing', 'environment', 'flags']);
  });

  it('uses the default when nothing overrides it', () => {
    const result = layered({});

    expect(result.value.nav.max_reviews).toBe(1000);
    expect(result.trace['nav.max_reviews'].layer).toBe('defaults');
  });

  it('lets a profile beat a default', () => {
    const result = layered({ profile: { nav: { max_reviews: 500 } } });

    expect(result.value.nav.max_reviews).toBe(500);
    expect(result.trace['nav.max_reviews'].layer).toBe('profile');
  });

  it('lets a client beat a profile', () => {
    const result = layered({
      profile: { nav: { max_reviews: 500 } },
      client: { nav: { max_reviews: 600 } },
    });

    expect(result.value.nav.max_reviews).toBe(600);
    expect(result.trace['nav.max_reviews'].layer).toBe('client');
  });

  it('lets a listing override beat a client', () => {
    const result = layered({
      client: { nav: { max_reviews: 600 } },
      listing: { nav: { max_reviews: 700 } },
    });

    expect(result.value.nav.max_reviews).toBe(700);
    expect(result.trace['nav.max_reviews'].layer).toBe('listing');
  });

  it('lets the environment beat a listing override', () => {
    const result = loadOk({
      listing: { nav: { max_reviews: 700 } },
      env: { TPRE_NAV_MAX_REVIEWS: '800' },
    });

    expect(result.value.nav.max_reviews).toBe(800);
    expect(result.trace['nav.max_reviews'].layer).toBe('environment');
  });

  it('lets a CLI flag beat the environment', () => {
    const result = loadOk({
      env: { TPRE_NAV_MAX_REVIEWS: '800' },
      flags: { nav: { max_reviews: 900 } },
    });

    expect(result.value.nav.max_reviews).toBe(900);
    expect(result.trace['nav.max_reviews'].layer).toBe('flags');
  });

  it('merges objects deeply rather than replacing them', () => {
    const result = layered({ client: { nav: { max_reviews: 600 } } });

    expect(result.value.nav.max_reviews).toBe(600);
    expect(result.value.nav.stall_threshold).toBe(3);
  });

  it('REPLACES arrays rather than merging them (TR-CFG-020)', () => {
    // An operator writing `languages: ["en"]` means "publish English reviews",
    // not "add English to whatever the profile listed". A partially merged
    // array appears in no configuration file and nobody chose it.
    const result = layered({
      profile: { display: { languages: ['en', 'fr', 'de'] } },
      client: { display: { languages: ['en'] } },
    });

    expect(result.value.display.languages).toEqual(['en']);
  });

  it('lets a layer choose null explicitly', () => {
    const result = layered({
      profile: { display: { min_rating: 4 } },
      client: { display: { min_rating: null } },
    });

    expect(result.value.display.min_rating).toBeNull();
  });

  it('ignores undefined, which means the layer said nothing', () => {
    const result = layered({ client: { nav: { max_reviews: undefined } } });

    expect(result.value.nav.max_reviews).toBe(1000);
  });
});

describe('mergeLayer', () => {
  it('replaces an array with a shorter one', () => {
    expect(mergeLayer({ xs: [1, 2, 3] }, { xs: [9] })).toEqual({ xs: [9] });
  });

  it('replaces a scalar with an object and vice versa', () => {
    expect(mergeLayer({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
    expect(mergeLayer({ a: { b: 2 } }, { a: 1 })).toEqual({ a: 1 });
  });

  it('does not mutate its inputs', () => {
    const base = { nav: { max_reviews: 1 } };

    mergeLayer(base, { nav: { max_reviews: 2 } });

    expect(base.nav.max_reviews).toBe(1);
  });
});

describe('T-160 — an unknown TPRE_ variable is a startup error (EDR-006)', () => {
  it('rejects a typo rather than ignoring it', () => {
    // The failure this prevents: the run succeeds, reports success, and uses
    // the default. Nothing in the output is wrong, and the operator believes a
    // setting took effect that never did.
    expect(loadErrors({ env: { TPRE_MAX_REVIEW: '2000' } })[0]).toContain(
      'unknown environment variable TPRE_MAX_REVIEW',
    );
  });

  it('suggests the nearest valid name', () => {
    expect(loadErrors({ env: { TPRE_NAV_MAX_REVIEW: '2000' } })[0]).toContain(
      'did you mean TPRE_NAV_MAX_REVIEWS',
    );
  });

  it('accepts run variables without merging them into the config', () => {
    // Force flags must reach the gate as an explicit request, not as a
    // threshold somebody quietly lowered.
    const result = loadOk({
      env: { TPRE_FORCE_PUBLISH: 'true', TPRE_FORCE_REASON: 'verified manually' },
    });

    expect(result.run.TPRE_FORCE_PUBLISH).toBe('true');
    expect(Object.hasOwn(result.value, 'TPRE_FORCE_PUBLISH')).toBe(false);
  });

  it('ignores variables that are not ours', () => {
    expect(loadOk({ env: { PATH: '/usr/bin', HOME: '/root' } }).value.nav.max_reviews).toBe(1000);
  });

  it('reports every unknown variable, not just the first', () => {
    expect(loadErrors({ env: { TPRE_NOPE: '1', TPRE_ALSO_NOPE: '2' } })).toHaveLength(2);
  });

  it('derives the variable name from the config path', () => {
    expect(variableNameFor('nav.max_reviews')).toBe('TPRE_NAV_MAX_REVIEWS');
    expect(variableNameFor('budget_run_ms')).toBe('TPRE_BUDGET_RUN_MS');
  });

  it('offers no suggestion when nothing is close', () => {
    expect(nearestVariable('TPRE_ZZZZZZZZZZZZZZZZZZZZ', ['TPRE_NAV_MAX_REVIEWS'])).toBeNull();
  });
});

describe('environment coercion', () => {
  it('coerces to the type the default implies', () => {
    expect(coerce('42', 0)).toEqual({ ok: true, value: 42 });
    expect(coerce('true', false)).toEqual({ ok: true, value: true });
    expect(coerce('off', true)).toEqual({ ok: true, value: false });
    expect(coerce('newest', 'oldest')).toEqual({ ok: true, value: 'newest' });
  });

  it('rejects a non-numeric value for a numeric key', () => {
    // `Number('')` is 0 and `Number('abc')` is NaN; both would otherwise become
    // a configured value nobody typed.
    expect(coerce('abc', 0).ok).toBe(false);
    expect(coerce('', 0).ok).toBe(false);
  });

  it('rejects an ambiguous boolean', () => {
    expect(coerce('maybe', false).ok).toBe(false);
  });

  it('splits a comma-separated list, replacing rather than extending', () => {
    expect(coerce('en, fr ,de', [])).toEqual({ ok: true, value: ['en', 'fr', 'de'] });
  });

  it('reports a coercion failure with the variable name', () => {
    expect(loadErrors({ env: { TPRE_NAV_MAX_REVIEWS: 'lots' } })[0]).toContain(
      'TPRE_NAV_MAX_REVIEWS must be a number',
    );
  });

  it('reads a nested path into the right place', () => {
    const { values } = readEnvironment({ TPRE_GATE_QUARANTINE_MAX: '0.1' }, DEFAULTS);

    expect(values.gate.quarantine_max).toBe(0.1);
  });
});

describe('T-163 — a bound breach is an error, never a clamp (TR-CFG-030)', () => {
  it('rejects a value above a ceiling', () => {
    // Clamping hides operator intent, which is exactly what must be visible
    // during an incident.
    expect(loadErrors({ client: { nav: { max_reviews: 6000 } } })[0]).toContain(
      'exceeds the ceiling of 5000',
    );
  });

  it('rejects a value below a floor', () => {
    expect(loadErrors({ client: { min_request_delay_ms: 10 } })[0]).toContain(
      'below the floor of 250',
    );
  });

  it('explains WHY the bound exists', () => {
    // A message saying only "exceeds maximum" tells an operator they are wrong
    // without telling them what they misunderstood.
    expect(loadErrors({ client: { min_request_delay_ms: 10 } })[0]).toContain('abuse');
  });

  it('reports every violation, not the first', () => {
    const errors = loadErrors({
      client: { nav: { max_reviews: 6000 }, max_parallel: 99, min_request_delay_ms: 1 },
    });

    expect(errors).toHaveLength(3);
  });

  it('accepts a value exactly at the bound', () => {
    expect(loadOk({ client: { nav: { max_reviews: 5000 } } }).value.nav.max_reviews).toBe(5000);
    expect(loadOk({ client: { min_request_delay_ms: 250 } }).value.min_request_delay_ms).toBe(250);
  });

  it('never clamps: a rejected config yields no value at all', () => {
    const result = loadConfig({ client: { nav: { max_reviews: 6000 } } });

    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, 'value')).toBe(false);
  });

  it('bounds every key it claims to bound', () => {
    for (const [path, bound] of Object.entries(LIMITS)) {
      expect(bound.why, path).toEqual(expect.any(String));
      expect(bound.ceiling ?? bound.floor, path).toEqual(expect.any(Number));
    }
  });
});

describe('T-164 — the resolution trace', () => {
  it('records the winning layer and value for every key', () => {
    const result = loadOk({ client: { nav: { max_reviews: 600 } } });

    expect(result.trace['nav.max_reviews']).toEqual({ layer: 'client', value: 600 });
    expect(result.trace['gate.quarantine_max'].layer).toBe('defaults');
  });

  it('NEVER records a secret value (TR-CFG-024)', () => {
    // The trace goes into the diagnostics bundle, and the bundle is attached to
    // issues.
    const result = loadOk({
      client: { credentials: { api_key: 'super-secret-value', token: '' } },
    });

    expect(result.trace['credentials.api_key']).toEqual({ layer: 'client', value: '«set»' });
    expect(result.trace['credentials.token'].value).toBe('«unset»');
    expect(JSON.stringify(result.trace)).not.toContain('super-secret-value');
  });

  it('is frozen along with the config', () => {
    expect(Object.isFrozen(loadOk().trace)).toBe(true);
  });
});

describe('T-165 — the config is deeply frozen (TR-CFG-023, EDR-005)', () => {
  it('refuses mutation at every depth', () => {
    const { value } = loadOk();

    expect(() => {
      value.nav.max_reviews = 99;
    }).toThrow();
    expect(() => {
      value.display.order = 'oldest';
    }).toThrow();
    expect(value.nav.max_reviews).toBe(1000);
  });
});

describe('T-165 — the migration framework', () => {
  it('accepts a config already at the current version', () => {
    const result = migrate({ config_version: CONFIG_VERSION, nav: { max_reviews: 10 } });

    expect(result.ok).toBe(true);
    expect(/** @type {any} */ (result).applied).toEqual([]);
  });

  it('assumes version 1 when none is stated', () => {
    expect(migrate({ nav: {} }).ok).toBe(true);
  });

  it('REFUSES a config from the future rather than guessing', () => {
    // This engine cannot know what a later version means, and guessing would
    // silently discard whatever it did not understand.
    const result = migrate({ config_version: CONFIG_VERSION + 5 });

    expect(result.ok).toBe(false);
    expect(/** @type {any} */ (result).error).toContain('newer than this engine understands');
  });

  it('surfaces a future-version config as a load error', () => {
    expect(loadErrors({ client: { config_version: 99 } })[0]).toContain('upgrade the engine');
  });

  it('stamps the current version onto the result', () => {
    expect(/** @type {any} */ (migrate({})).value.config_version).toBe(CONFIG_VERSION);
  });
});
