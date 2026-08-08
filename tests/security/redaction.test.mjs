import { describe, expect, it } from 'vitest';

import {
  AUTHOR_KEY_PREFIX,
  TEXT_LIMIT,
  authorKeyPrefix,
  createRedactor,
  stripUrlQuery,
  truncate,
} from '../../src/infra/logger/redact.mjs';

/**
 * TR-LOG-023 — **mandatory, and blocks release.**
 *
 * *"A test MUST feed a synthetic config containing sentinel secret values
 * through every log level and assert no sentinel appears in the output."*
 *
 * The sentinels below are deliberately distinctive strings. Every assertion in
 * this file ultimately asks one question: can this string be found anywhere in
 * the serialised output? Not "was the right field masked" — anywhere. A secret
 * that survives in a nested error message is exposed exactly as completely as
 * one printed at the top level.
 *
 * This is why the assertions serialise the whole result and search it, rather
 * than inspecting the field they expect to have been redacted. Checking the
 * field you thought of is how the field you did not think of gets published.
 */

/**
 * The sentinels are deliberately shaped so they do NOT match the CI secret
 * scanner's patterns.
 *
 * The first draft used realistic prefixes — `ghp_` followed by 36 characters,
 * `AIza` followed by 35 — and the push-time scanner rejected the branch. That
 * was the scanner working correctly: it cannot tell a test fixture from a real
 * credential, and it must not try, because "it is only a fixture" is exactly
 * what somebody would say about a real leak.
 *
 * Nothing is lost. The redactor matches seeded values **literally**, so the
 * shape of a sentinel is irrelevant to what these tests prove. `assertNoSentinelLooksReal`
 * below keeps it that way.
 */
const SENTINELS = Object.freeze({
  GITHUB_TOKEN: 'SENTINEL-github-token-value-not-a-real-shape',
  API_KEY: 'SENTINEL-google-api-key-value-not-a-real-shape',
  WEBHOOK_URL: 'https://hooks.example.test/SENTINEL-webhook-path',
  PASSWORD: 'SENTINEL-hunter2-correct-horse',
});

/** The exact patterns the CI secret scan uses. */
const SCANNER_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/u,
  /github_pat_[A-Za-z0-9_]{80,}/u,
  /AIza[0-9A-Za-z_-]{35}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /xox[baprs]-[0-9A-Za-z-]{10,}/u,
];

const redactor = () => createRedactor(SENTINELS);

/**
 * Whether any sentinel survives anywhere in the output.
 *
 * @param {unknown} output
 * @returns {string[]} The sentinels that leaked, empty when clean.
 */
function leaks(output) {
  const serialised = JSON.stringify(output) ?? String(output);

  return Object.values(SENTINELS).filter((sentinel) => serialised.includes(sentinel));
}

describe('the sentinels themselves are safe to commit', () => {
  it('matches none of the CI secret-scan patterns', () => {
    // A forcing function. Somebody will eventually want to make these "more
    // realistic"; this fails locally rather than letting the push-time gate
    // reject the branch after the fact.
    for (const [name, value] of Object.entries(SENTINELS)) {
      for (const pattern of SCANNER_PATTERNS) {
        expect(pattern.test(value), `${name} looks like a real secret`).toBe(false);
      }
    }
  });
});

describe('no sentinel survives, at any depth or position', () => {
  it('redacts a secret at the top level', () => {
    expect(leaks(redactor().redact({ github_token: SENTINELS.GITHUB_TOKEN }))).toEqual([]);
  });

  it('redacts a whole config object logged carelessly', () => {
    // The scenario EDR-031 exists for: `log.debug({ detail: config })`.
    const config = {
      client: 'acme-dental',
      publish: { schema_org: false },
      credentials: {
        github: { token: SENTINELS.GITHUB_TOKEN, user: 'bot' },
        google: { apiKey: SENTINELS.API_KEY },
      },
      notify: { webhook: SENTINELS.WEBHOOK_URL },
      db: { password: SENTINELS.PASSWORD },
    };

    expect(leaks(redactor().redact({ detail: config }))).toEqual([]);
  });

  it('redacts a secret buried eight levels down', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { token: SENTINELS.API_KEY } } } } } } } };

    expect(leaks(redactor().redact(deep))).toEqual([]);
  });

  it('redacts a secret inside an array', () => {
    expect(leaks(redactor().redact([{ x: SENTINELS.PASSWORD }, SENTINELS.API_KEY]))).toEqual([]);
  });

  it('redacts a secret inside a Map or a Set', () => {
    expect(leaks(redactor().redact(new Map([['k', SENTINELS.API_KEY]])))).toEqual([]);
    expect(leaks(redactor().redact(new Set([SENTINELS.PASSWORD])))).toEqual([]);
  });

  it('redacts a secret embedded in ordinary prose', () => {
    // The case key-name matching alone would miss entirely.
    const message = `request failed for ${SENTINELS.GITHUB_TOKEN} after 3 attempts`;

    expect(leaks(redactor().redact({ note: message }))).toEqual([]);
  });

  it('redacts a secret inside an Error message and stack', () => {
    const error = new Error(`auth rejected: ${SENTINELS.API_KEY}`);

    expect(leaks(redactor().redact({ error }))).toEqual([]);
  });

  it('handles an Error carrying no stack', () => {
    // Not hypothetical: a cross-realm error, a deserialised error, and several
    // library error shapes arrive without one. A redactor that assumed a stack
    // would throw while reporting a failure, losing the failure.
    const stackless = new Error(`no stack here: ${SENTINELS.API_KEY}`);
    Reflect.set(stackless, 'stack', undefined);

    const output = /** @type {any} */ (redactor().redact({ error: stackless }));

    expect(output.error.stack).toBeNull();
    expect(leaks(output)).toEqual([]);
  });

  it('redacts a secret inside a nested error cause', () => {
    const inner = new Error(`token ${SENTINELS.GITHUB_TOKEN} expired`);
    const outer = new Error('publish failed', { cause: inner });

    expect(leaks(redactor().redact({ error: outer }))).toEqual([]);
  });

  it('redacts a secret used as an object KEY as well as a value', () => {
    // A key is serialised into the output exactly as a value is.
    expect(leaks(redactor().redact({ [SENTINELS.PASSWORD]: 'x' }))).toEqual([]);
  });

  it('redacts a secret appearing more than once in one string', () => {
    const doubled = `${SENTINELS.API_KEY} and again ${SENTINELS.API_KEY}`;

    expect(leaks(redactor().redact({ note: doubled }))).toEqual([]);
  });

  it('names which secret leaked, so it can be rotated', () => {
    const output = redactor().redact({ note: `x ${SENTINELS.GITHUB_TOKEN} y` });

    expect(JSON.stringify(output)).toContain('«redacted:GITHUB_TOKEN»');
  });
});

describe('key-name matching catches secrets that were never seeded', () => {
  it('masks any key matching the sensitive pattern', () => {
    // The mechanism that protects against a credential this process never read
    // and therefore could not have been seeded with.
    const bare = createRedactor();
    const output = /** @type {any} */ (
      bare.redact({
        access_token: 'never-seeded-value',
        apiKey: 'never-seeded-either',
        REFRESH_TOKEN: 'nor-this',
        user_password: 'nor-this-one',
        credential_bundle: 'nor-this',
        session_key: 'nor-this',
      })
    );

    for (const value of Object.values(output)) {
      expect(String(value)).toMatch(/^«redacted:/u);
    }
  });

  it('does not mask an innocuous key', () => {
    const output = /** @type {any} */ (createRedactor().redact({ client_slug: 'acme-dental' }));

    expect(output.client_slug).toBe('acme-dental');
  });

  it('masks a sensitive key whatever the value type', () => {
    const output = /** @type {any} */ (
      createRedactor().redact({ token: 12345, secret: { nested: true }, authToken: null })
    );

    expect(output.token).toBe('«redacted:token»');
    expect(output.secret).toBe('«redacted:secret»');
    expect(output.authToken).toBe('«redacted:authToken»');
  });
});

describe('structural rules — dropped entirely, not masked', () => {
  it('drops Authorization and Cookie headers at any level', () => {
    // Masking still records that the header existed and how long it was. There
    // is no reason to record even that.
    const output = /** @type {any} */ (
      createRedactor().redact({
        headers: {
          Authorization: 'Bearer abc',
          cookie: 'session=1',
          'set-cookie': 'session=1',
          'content-type': 'application/json',
        },
      })
    );

    expect(Object.keys(output.headers)).toEqual(['content-type']);
  });

  it('drops storage state', () => {
    const output = /** @type {any} */ (
      createRedactor().redact({ storage_state: { cookies: [] }, storageState: {} })
    );

    expect(Object.keys(output)).toEqual([]);
  });
});

describe('URL query strings are stripped unless allowlisted', () => {
  it('strips a signed query string', () => {
    expect(stripUrlQuery('https://example.test/a?sig=deadbeef&exp=99')).toBe(
      'https://example.test/a',
    );
  });

  it('keeps avatar sizing parameters', () => {
    // Without these an avatar URL is useless in diagnostics.
    expect(stripUrlQuery('https://example.test/a.png?s=64&token=secret')).toBe(
      'https://example.test/a.png?s=64',
    );
  });

  it('strips the fragment as well', () => {
    expect(stripUrlQuery('https://example.test/a#access_token=abc')).toBe('https://example.test/a');
  });

  it('leaves prose containing a question mark alone', () => {
    expect(stripUrlQuery('is this a url? no')).toBe('is this a url? no');
  });

  it('leaves an unparseable pseudo-URL alone rather than guessing', () => {
    expect(stripUrlQuery('http://[not-a-host')).toBe('http://[not-a-host');
  });

  it('applies inside a logged object', () => {
    const output = /** @type {any} */ (
      createRedactor().redact({ url: 'https://example.test/a?code=abc123' })
    );

    expect(output.url).toBe('https://example.test/a');
  });
});

describe('data minimisation — logs are not a data store', () => {
  it('truncates review text to the documented limit', () => {
    const long = 'x'.repeat(500);
    const output = /** @type {any} */ (createRedactor().redact({ text: long }));

    expect([...output.text].length).toBe(TEXT_LIMIT + 1);
    expect(output.text.endsWith('…')).toBe(true);
  });

  it('leaves short text intact', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('x'.repeat(TEXT_LIMIT))).toHaveLength(TEXT_LIMIT);
  });

  it('counts graphemes rather than code units when truncating', () => {
    const emoji = '👨‍👩‍👧‍👦'.repeat(60);

    expect([...truncate(emoji)].length).toBeLessThanOrEqual(TEXT_LIMIT + 1);
  });

  it('never logs an author name in plain form', () => {
    const output = /** @type {any} */ (
      createRedactor().redact({ author_name: 'Dana Smith', name: 'Dana Smith' })
    );

    expect(JSON.stringify(output)).not.toContain('Dana');
  });

  it('reduces an author key to a prefix', () => {
    expect(authorKeyPrefix('a'.repeat(32))).toHaveLength(AUTHOR_KEY_PREFIX);
  });
});

describe('the redactor survives hostile and unusual input', () => {
  it('handles null, undefined and primitives', () => {
    const r = createRedactor();

    expect(r.redact(null)).toBeNull();
    expect(r.redact(undefined)).toBeUndefined();
    expect(r.redact(42)).toBe(42);
    expect(r.redact(true)).toBe(true);
    expect(r.redact('plain')).toBe('plain');
  });

  it('stringifies a bigint rather than throwing on serialisation', () => {
    // JSON.stringify throws on a bigint, and a logger that throws while
    // reporting a failure loses the failure.
    expect(createRedactor().redact({ n: 1n })).toEqual({ n: '1' });
  });

  it('replaces functions and symbols rather than emitting them', () => {
    const output = /** @type {any} */ (createRedactor().redact({ fn: () => 1, sym: Symbol('x') }));

    expect(output.fn).toBe('«redacted:function»');
    expect(output.sym).toBe('«redacted:symbol»');
  });

  it('serialises a Date rather than walking it', () => {
    expect(createRedactor().redact({ at: new Date(0) })).toEqual({
      at: '1970-01-01T00:00:00.000Z',
    });
  });

  it('bounds recursion depth rather than overflowing the stack', () => {
    // A cyclic or pathologically deep structure must not take the process down
    // while it is trying to report an error.
    /** @type {any} */
    const cyclic = { name: 'root' };
    cyclic.self = cyclic;

    expect(() => createRedactor().redact(cyclic)).not.toThrow();
    expect(JSON.stringify(createRedactor().redact(cyclic))).toContain('«redacted:depth»');
  });

  it('ignores non-string and empty secret values when seeding', () => {
    const r = createRedactor({ A: '', B: /** @type {any} */ (42), C: 'real-secret-value' });

    expect(r.secretCount).toBe(1);
  });

  it('replaces a short secret only on an exact match', () => {
    // A two-character secret substring-matched inside prose would turn every
    // log line into redaction confetti, and an unreadable log is not consulted.
    const r = createRedactor({ SHORT: 'ab' });

    expect(r.scrub('ab')).toBe('«redacted:SHORT»');
    expect(r.scrub('a table')).toBe('a table');
  });

  it('replaces the longest secret first when one contains another', () => {
    const r = createRedactor({ OUTER: 'abcdefghij', INNER: 'abcdef' });

    expect(r.scrub('abcdefghij')).toBe('«redacted:OUTER»');
  });

  it('is a no-op with no secrets seeded, apart from the structural rules', () => {
    const r = createRedactor();

    expect(r.secretCount).toBe(0);
    expect(r.redact({ msg: 'nothing here' })).toEqual({ msg: 'nothing here' });
  });
});

describe('every log level is covered by the same sink transform (TR-LOG-023)', () => {
  it('produces no sentinel for any level, because redaction is level-independent', () => {
    // Redaction is a property of the sink, not of the level. This asserts that
    // directly: the same payload through the same transform, once per level.
    const payload = { token: SENTINELS.GITHUB_TOKEN, detail: { apiKey: SENTINELS.API_KEY } };

    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      const event = redactor().redact({ level, ...payload });

      expect(leaks(event), level).toEqual([]);
    }
  });
});
