/**
 * DEL-193 — the renderer size budget (FE-05, TR-TEST-100, §50.2 step 9).
 *
 * Blocking, because it is deterministic. Most budgets in this project measure a
 * complexity CLASS rather than a wall-clock number, precisely so they cannot
 * fail for being on a busy machine. This one is different: byte count is the
 * same on every machine, so it can be an exact line rather than a trend.
 *
 * The budget exists because this file is downloaded by every visitor to every
 * client site. Size here is not our cost, it is theirs — and it is spent on the
 * part of their page that is not the reason anyone came.
 *
 * ## Half of this file tests the measurement
 *
 * A budget is only as trustworthy as its ruler. If `stripForMeasurement` ever
 * removed something it should have kept — a string containing `//`, say — it
 * would report a smaller file, the budget would silently stop binding, and
 * nothing would fail. That is the one direction this must not be wrong in, so
 * the stripper is tested directly rather than trusted.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RENDERER_BUDGET_BYTES, report, stripForMeasurement } from '../../scripts/size-report.mjs';

describe('FE-05 — the shipped renderer is under budget', () => {
  const measured = report();

  it(`is at most ${RENDERER_BUDGET_BYTES} bytes`, () => {
    expect(measured.total).toBeLessThanOrEqual(RENDERER_BUDGET_BYTES);
  });

  it('measured a file that actually exists and is not empty', () => {
    // A budget over a missing file passes trivially. This is the same failure
    // as an empty security scan, and it fails the same way: silently.
    expect(measured.files).toHaveLength(1);
    expect(measured.files[0]?.raw).toBeGreaterThan(1000);
  });

  it('reports a stripped size well below the raw size, proving stripping happened', () => {
    const file = measured.files[0];

    expect(file?.stripped).toBeLessThan(Number(file?.raw));
  });
});

describe('the ruler — stripForMeasurement never under-reports', () => {
  it('removes line and block comments', () => {
    expect(stripForMeasurement('const a = 1; // note\n/* block */ const b = 2;')).not.toContain(
      'note',
    );
  });

  it('keeps a // that lives inside a string', () => {
    // The classic bug. A regex stripper deletes the rest of this line and
    // reports a file smaller than it is.
    const stripped = stripForMeasurement(`const url = 'https://example.test/x';\nconst a = 1;`);

    expect(stripped).toContain('https://example.test/x');
    expect(stripped).toContain('const a = 1');
  });

  it('keeps a /* that lives inside a string', () => {
    const stripped = stripForMeasurement(`const s = '/* not a comment */';\nconst a = 1;`);

    expect(stripped).toContain('/* not a comment */');
    expect(stripped).toContain('const a = 1');
  });

  it('keeps an escaped quote from ending the string early', () => {
    const stripped = stripForMeasurement(`const s = 'it\\'s // fine';\nconst a = 1;`);

    expect(stripped).toContain('// fine');
    expect(stripped).toContain('const a = 1');
  });

  it('preserves spaces inside string literals', () => {
    // These are user-visible text. Collapsing them would under-report AND
    // would misrepresent what the browser downloads.
    expect(stripForMeasurement(`const s = 'Page 1 of 2';`)).toContain('Page 1 of 2');
  });

  it('preserves template literal contents', () => {
    expect(stripForMeasurement('const s = `Rated ${n} out of 5`;')).toContain(
      'Rated ${n} out of 5',
    );
  });

  it('collapses only whitespace that cannot merge two tokens', () => {
    const stripped = stripForMeasurement('function f( a, b ) {\n  return a + b;\n}');

    // `(`, `,`, `)`, `{`, `}` and `;` cannot form part of an identifier, so
    // hugging them is safe. The space in `a + b` is left alone, because
    // removing spaces around operators is where `a - -b` becomes `a--b`.
    expect(stripped).toContain('function f(a,b)');
    expect(stripped).toContain('a + b');
  });

  it('never merges two identifiers', () => {
    // The failure that would make this ruler dangerous: a stripper that turns
    // `const x` into `constx` reports a smaller, and invalid, file.
    const stripped = stripForMeasurement('const value = other;\nlet x = new Thing();');

    expect(stripped).toContain('const value');
    expect(stripped).toContain('new Thing');
  });

  it('leaves a file that is already minimal unchanged in size', () => {
    const minimal = 'const a=1;';

    expect(stripForMeasurement(minimal)).toBe(minimal);
  });

  it('produces source that still parses', async () => {
    // The strongest check available without a real minifier: whatever this
    // reports as the measured file must still be valid JavaScript. A stripper
    // that produced garbage of the right length would pass every test above.
    const stripped = stripForMeasurement(readFileSync('frontend/renderer/tp-reviews.mjs', 'utf8'));
    const encoded = `data:text/javascript;base64,${Buffer.from(stripped, 'utf8').toString('base64')}`;

    await expect(import(encoded)).resolves.toHaveProperty('render');
  });
});
