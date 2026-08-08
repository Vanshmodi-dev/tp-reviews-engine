import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BUFFER_SIZE, createLogger } from '../../../src/infra/logger/jsonl.mjs';
import { createRedactor } from '../../../src/infra/logger/redact.mjs';
import { LOG_LEVELS } from '../../../src/ports/logger.mjs';
import { createFixedClock } from '../../helpers/fixed-clock.mjs';

const SENTINEL = 'ghp_SENTINEL0000000000000000000000000000';

/**
 * @param {Record<string, any>} [options]
 * @returns {{ logger: any, lines: string[] }}
 */
function build(options = {}) {
  /** @type {string[]} */
  const lines = [];
  const logger = createLogger({
    redactor: createRedactor({ GITHUB_TOKEN: SENTINEL }),
    clock: createFixedClock('2026-03-01T00:00:00.000Z'),
    write: (line) => lines.push(line),
    level: 'trace',
    ...options,
  });

  return { logger, lines };
}

describe('construction order is enforced by the signature (LOG-ORD-01, IR-21)', () => {
  it('refuses to build without a redactor', () => {
    // Not defaulted. A logger that quietly supplied its own empty redactor
    // would satisfy every type check and leak every secret - and a logger
    // constructed before the filter is seeded can leak in its own startup event.
    expect(() => createLogger(/** @type {any} */ ({ clock: createFixedClock() }))).toThrow(
      /requires a redactor/u,
    );
  });

  it('refuses to build without a clock', () => {
    expect(() => createLogger(/** @type {any} */ ({ redactor: createRedactor() }))).toThrow(
      /requires a clock/u,
    );
  });
});

describe('there is exactly one write path, and it redacts (LOG-ORD-02)', () => {
  it('redacts a secret at every level', () => {
    const { logger, lines } = build();

    for (const level of LOG_LEVELS) {
      logger[level]('event', { token: SENTINEL, detail: { note: `x ${SENTINEL} y` } });
    }

    logger.flushBuffered();

    expect(lines.join('\n')).not.toContain(SENTINEL);
  });

  it('redacts buffered events too, not only written ones', () => {
    // The buffer is flushed into a diagnostics artifact on failure. An
    // unredacted buffer would put the secret in a file instead of a log line.
    const { logger } = build();

    logger.debug('detail', { token: SENTINEL });

    expect(JSON.stringify(logger.flushBuffered())).not.toContain(SENTINEL);
  });

  it('exposes no raw or bypass write helper', () => {
    // The acceptance criterion is a code search for alternative write helpers.
    const source = readFileSync(
      new URL('../../../src/infra/logger/jsonl.mjs', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/export function (raw|writeRaw|unsafe)/u);
    expect(source.match(/JSON\.stringify\(event\)/gu)).toHaveLength(1);
  });

  it('emits the mandatory field set', () => {
    const { logger, lines } = build();

    logger.info('harvest complete', { reviews: 118 });
    const event = parseLine(lines, 0);

    expect(event).toMatchObject({
      ts: '2026-03-01T00:00:00.000Z',
      level: 'info',
      msg: 'harvest complete',
      reviews: 118,
    });
  });
});

describe('levels and thresholds', () => {
  it('drops events below the configured level', () => {
    const { logger, lines } = build({ level: 'warn' });

    logger.info('ignored');
    logger.warn('kept');
    logger.error('kept too');

    expect(lines).toHaveLength(2);
  });

  it('never writes trace or debug directly, whatever the threshold', () => {
    // They are buffered by definition, not by threshold.
    const { logger, lines } = build({ level: 'trace' });

    logger.trace('t');
    logger.debug('d');

    expect(lines).toEqual([]);
    expect(logger.bufferedCount()).toBe(2);
  });
});

describe('the ring buffer is bounded and flushed only on failure (EDR-032)', () => {
  it('retains only the most recent events', () => {
    // An unbounded buffer in a run over thousands of reviews is a memory leak
    // that presents as a crash hours later in a different component.
    const { logger } = build({ bufferSize: 3 });

    for (let i = 0; i < 10; i += 1) logger.debug('event', { i });

    const flushed = logger.flushBuffered();

    expect(flushed).toHaveLength(3);
    expect(flushed.map((/** @type {any} */ e) => e.i)).toEqual([7, 8, 9]);
  });

  it('defaults to a documented size', () => {
    const { logger } = build();

    for (let i = 0; i < DEFAULT_BUFFER_SIZE + 5; i += 1) logger.debug('e');

    expect(logger.bufferedCount()).toBe(DEFAULT_BUFFER_SIZE);
  });

  it('drains rather than copies, so one failure does not inherit another', () => {
    const { logger } = build();

    logger.debug('first');
    expect(logger.flushBuffered()).toHaveLength(1);
    expect(logger.flushBuffered()).toHaveLength(0);
  });

  it('writes nothing on a healthy run', () => {
    const { logger, lines } = build();

    logger.debug('detail');
    logger.trace('more detail');

    expect(lines).toEqual([]);
  });
});

describe('child loggers carry correlation (T-133)', () => {
  it('adds bindings to every event', () => {
    const { logger, lines } = build();
    const run = logger.child({ run_id: 'run-1' });
    const target = run.child({ client: 'acme', listing: 'main' });

    target.info('started');
    const event = parseLine(lines, 0);

    expect(event).toMatchObject({ run_id: 'run-1', client: 'acme', listing: 'main' });
  });

  it('does not leak bindings back to the parent', () => {
    const { logger, lines } = build();

    logger.child({ client: 'acme' }).info('child');
    logger.info('parent');

    expect(parseLine(lines, 1).client).toBeUndefined();
  });

  it('lets a call-site field override a binding', () => {
    const { logger, lines } = build();

    logger.child({ phase: 'harvest' }).info('e', { phase: 'publish' });

    expect(parseLine(lines, 0).phase).toBe('publish');
  });

  it('shares one buffer across the whole tree', () => {
    // A failure flushes the run's context, not just the deepest logger's.
    const { logger } = build();

    logger.debug('root detail');
    logger.child({ client: 'acme' }).debug('target detail');

    expect(logger.flushBuffered()).toHaveLength(2);
  });
});

describe('console is not used outside the logger and the CLI (TR-LOG-024)', () => {
  it('the sink writes to the stream directly', () => {
    // `console.log` formats and inspects its arguments, which for an object
    // means a second serialisation that does not go through the redactor.
    const source = readFileSync(
      new URL('../../../src/infra/logger/jsonl.mjs', import.meta.url),
      'utf8',
    );

    // Comments are stripped before the search, both forms. The module header
    // explains why `console.log` is not used, and a check that matched its own
    // explanation would fail for the opposite of the reason it exists.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');

    expect(source).toContain('process.stdout.write');
    expect(code).not.toContain('console.');
  });
});

/**
 * @param {string[]} lines
 * @param {number} index
 * @returns {any}
 */
function parseLine(lines, index) {
  const line = lines[index];

  if (line === undefined) throw new Error(`no log line at index ${index}`);

  return JSON.parse(line);
}
