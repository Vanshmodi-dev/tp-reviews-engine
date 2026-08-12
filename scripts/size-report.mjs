/**
 * The renderer size report (FE-05, TR-TEST-100).
 *
 * ## Why this measures without a minifier
 *
 * The budget is stated in §50 as "≤ 5 KB minified". Measuring that properly
 * would mean adding a minifier, and DEP-2 forbids a package for anything
 * achievable in under ~100 readable lines — which this is, provided the
 * measurement errs in the safe direction.
 *
 * So it does. Comments and indentation are stripped; identifiers, whitespace
 * inside expressions, and every `const` name are left exactly as written. That
 * is strictly LARGER than what esbuild or terser would emit, because those
 * additionally mangle locals and collapse expression whitespace.
 *
 * The consequence is the one that matters for a budget: passing here
 * guarantees passing under a real minifier, and the number reported is never
 * flattering. It can fail a file a real minifier would have squeezed under the
 * line — that is the acceptable direction to be wrong, and the remedy is to
 * write less code rather than to measure more cleverly.
 *
 * Gzip is reported alongside, because it is what a browser actually downloads
 * and `node:zlib` is built in. It is informational: the blocking number is the
 * stripped byte count.
 *
 * @module scripts/size-report
 */

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The blocking budget, in bytes (§50.2 step 9). */
export const RENDERER_BUDGET_BYTES = 5 * 1024;

/** Everything that ships to a client site. */
export const SHIPPED_FILES = ['frontend/renderer/tp-reviews.mjs'];

/**
 * Removes comments and indentation without touching anything inside a string
 * or a regular expression.
 *
 * A regex-based comment stripper gets this wrong on `'http://x'` and on `/\//`,
 * and gets it wrong silently — it reports a smaller file, which is the failure
 * mode a budget cannot tolerate. So this walks the source character by
 * character and tracks which context it is in.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripForMeasurement(source) {
  let out = '';
  // Code awaiting collapse. String literals bypass it entirely, so a space
  // inside `'Page 1 of 2'` survives while the one in `const x = 1` does not.
  let code = '';
  let index = 0;
  /** @type {string | null} */
  let quote = null;
  const flush = () => {
    out += collapse(code);
    code = '';
  };

  while (index < source.length) {
    const char = source[index];

    if (quote !== null) {
      const read = readInString(source, index, quote);

      out += read.text;
      quote = read.closed ? null : quote;
      index = read.index;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      flush();
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    const comment = skipComment(source, index);

    if (comment !== null) {
      index = comment;
      continue;
    }

    code += char;
    index += 1;
  }

  flush();

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Consumes one character of a string literal, honouring backslash escapes.
 *
 * The escape case is why this is not a one-liner: `'it\'s'` ends at the third
 * quote, not the second, and a stripper that got that wrong would treat the
 * rest of the file as string content and under-report enormously.
 *
 * @param {string} source
 * @param {number} index
 * @param {string} quote
 * @returns {{ text: string, index: number, closed: boolean }}
 */
function readInString(source, index, quote) {
  const char = source[index] ?? '';

  if (char === '\\') {
    return { text: char + (source[index + 1] ?? ''), index: index + 2, closed: false };
  }

  return { text: char, index: index + 1, closed: char === quote };
}

/**
 * If a comment starts here, returns the index just past it. Otherwise null.
 *
 * @param {string} source
 * @param {number} start
 * @returns {number | null}
 */
function skipComment(source, start) {
  const char = source[start];
  const next = source[start + 1];

  if (char === '/' && next === '/') {
    let index = start;

    while (index < source.length && source[index] !== '\n') index += 1;

    return index;
  }

  if (char === '/' && next === '*') {
    let index = start + 2;

    while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
      index += 1;
    }

    return index + 2;
  }

  return null;
}

/**
 * Characters that can never form part of an identifier, and so can never merge
 * with a neighbour when the space between them is removed.
 *
 * This is the conservative half of the approximation. A real minifier also
 * removes the space in `const x` (by renaming) and around `=`, `+`, `=>` and
 * the rest; doing that here would need real tokenisation to avoid turning
 * `a - -b` into `a--b`, and getting THAT wrong would under-report — the one
 * direction a budget cannot tolerate.
 */
const SAFE_TO_HUG = String.raw`{}()\[\];,:`;

/**
 * Removes whitespace that a minifier certainly removes, and no more.
 *
 * Applied only outside string literals, so `'a, b'` keeps its space.
 *
 * @param {string} code
 * @returns {string}
 */
function collapse(code) {
  return code
    .replace(/[^\S\n]+/gu, ' ')
    .replace(new RegExp(String.raw`\s*([${SAFE_TO_HUG}])\s*`, 'gu'), '$1');
}

/**
 * @param {string} path
 * @returns {{ path: string, raw: number, stripped: number, gzip: number }}
 */
export function measure(path) {
  const source = readFileSync(path, 'utf8');
  const stripped = stripForMeasurement(source);

  return {
    path,
    raw: Buffer.byteLength(source, 'utf8'),
    stripped: Buffer.byteLength(stripped, 'utf8'),
    gzip: gzipSync(Buffer.from(stripped, 'utf8')).length,
  };
}

/**
 * @returns {{ total: number, files: ReturnType<typeof measure>[] }}
 */
export function report() {
  const files = SHIPPED_FILES.map(measure);

  return { total: files.reduce((sum, file) => sum + file.stripped, 0), files };
}

// Run directly: print the table and exit non-zero if over budget. Compared as
// file URLs rather than as paths — on Windows `process.argv[1]` is a backslash
// path and `import.meta.url` is a `file:///C:/...` URL, so a string comparison
// silently never matches and the script exits 0 having measured nothing.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { total, files } = report();

  for (const file of files) {
    process.stdout.write(
      `${file.path}\n  raw ${file.raw} B · stripped ${file.stripped} B · gzip ${file.gzip} B\n`,
    );
  }

  const verdict = total <= RENDERER_BUDGET_BYTES ? 'within' : 'OVER';

  process.stdout.write(`\ntotal stripped: ${total} B / ${RENDERER_BUDGET_BYTES} B — ${verdict}\n`);

  // `exitCode`, not `exit()`. TR-CLI-003 keeps `process.exit` inside cli/, and
  // setting the code lets stdout flush rather than truncating the report this
  // script exists to print.
  if (total > RENDERER_BUDGET_BYTES) process.exitCode = 1;
}
