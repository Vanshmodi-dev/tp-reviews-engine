/**
 * CSV parsing with **per-row error isolation** (T-181).
 *
 * ## One bad row must never fail the file
 *
 * These files are hand-maintained client exports, so a malformed row is the
 * normal case rather than the exceptional one. An all-or-nothing parser means a
 * client's entire review set disappears because somebody typed `2026-13-45` in
 * row 47 — and it recurs on every run until a human finds it.
 *
 * So a rejected row is a *reported* row: it carries its line number and the
 * reason, and it counts toward the quarantine rate that gate rule G-06 watches.
 * The isolation is per row, not a licence to publish rubbish; a file that is
 * mostly bad still fails, at the gate, where that decision belongs.
 *
 * ## Why the parser is written here rather than taken from a package
 *
 * The format this reads is a client's spreadsheet export: quoted fields,
 * embedded commas, embedded newlines, and a BOM from Excel. That is the whole
 * surface, it is stable, and it is about eighty lines. A dependency would add a
 * supply-chain surface and a version to track for a problem this size — and
 * DEP-1 requires a documented gap before a dependency is added.
 *
 * @module adapters/acquisition/file-csv/parse
 */

/**
 * The UTF-8 byte order mark, written by Excel.
 *
 * Named rather than pasted as a literal: it is invisible in an editor, and an
 * invisible character in a regular expression is how a fix gets "tidied away"
 * by somebody who cannot see it. Left in place it becomes part of the first
 * column's name, so the header stops matching `author_name` and every row is
 * rejected for a missing required column - a spectacularly confusing failure
 * for a file that looks perfectly correct in a spreadsheet.
 */
const BOM = '\uFEFF';

/** Columns without which a row cannot become a review. */
const REQUIRED = Object.freeze(['author_name', 'rating', 'date']);

/** The lowest and highest star rating a source can express. */
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Splits CSV text into rows of fields.
 *
 * Handles quoted fields containing commas, newlines and escaped quotes, because
 * a review body contains all three routinely.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function splitRows(text) {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the first
  // column's name, so the header no longer matches `author_name` and every row
  // is rejected for a missing required column - a spectacularly confusing
  // failure for a file that looks correct in a spreadsheet.
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = /** @type {string} */ (source[index]);

    if (quoted) {
      const step = insideQuotes(char, source[index + 1]);

      field += step.append;
      index += step.skip;
      quoted = step.quoted;

      continue;
    }

    const step = outsideQuotes(char, source[index + 1]);

    index += step.skip;

    if (step.kind === 'quote') quoted = true;
    else if (step.kind === 'text') field += char;
    else if (step.kind === 'field') {
      row.push(field);
      field = '';
    } else {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    }
  }

  // A file with no trailing newline still has a final row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

/**
 * One character of a quoted field.
 *
 * A doubled quote inside quotes is a literal quote; a single one ends the
 * field. Extracted so the main loop reads as "which kind of character is this"
 * rather than nesting the quote rules three deep inside it.
 *
 * @param {string} char
 * @param {string | undefined} next
 * @returns {{ append: string, skip: number, quoted: boolean }}
 */
function insideQuotes(char, next) {
  if (char !== '"') return { append: char, skip: 0, quoted: true };
  if (next === '"') return { append: '"', skip: 1, quoted: true };

  return { append: '', skip: 0, quoted: false };
}

/**
 * What one character outside quotes means.
 *
 * `skip` handles CRLF: the LF is consumed with the CR rather than producing a
 * second, empty row — which is what a Windows-authored export would otherwise
 * yield between every pair of reviews.
 *
 * @param {string} char
 * @param {string | undefined} next
 * @returns {{ kind: string, skip: number }}
 */
function outsideQuotes(char, next) {
  if (char === '"') return { kind: 'quote', skip: 0 };
  if (char === ',') return { kind: 'field', skip: 0 };
  if (char === '\n') return { kind: 'row', skip: 0 };
  if (char === '\r') return { kind: 'row', skip: next === '\n' ? 1 : 0 };

  return { kind: 'text', skip: 0 };
}

/**
 * @typedef {object} ParseResult
 * @property {any[]} rows       Rows that parsed, as raw review records.
 * @property {any[]} rejected   `{ line, reason }` per rejected row.
 * @property {string[]} columns The header, as read.
 */

/**
 * Parses CSV text into raw review records.
 *
 * @param {string} text
 * @param {{ cap?: number }} [options]
 * @returns {ParseResult}
 */
export function parseCsv(text, options = {}) {
  const rows = splitRows(text);
  const header = rows.shift();

  if (header === undefined) {
    return { rows: [], rejected: [{ line: 0, reason: 'the file is empty' }], columns: [] };
  }

  const columns = header.map((name) => name.trim().toLowerCase());
  const missing = REQUIRED.filter((name) => !columns.includes(name));

  if (missing.length > 0) {
    // A missing required COLUMN is a file-level failure, unlike a missing
    // required VALUE. No row in this file can become a review, so reporting it
    // once is more useful than reporting it per row.
    return {
      rows: [],
      rejected: [{ line: 1, reason: `missing required column(s): ${missing.join(', ')}` }],
      columns,
    };
  }

  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  /** @type {any[]} */
  const parsed = [];
  /** @type {any[]} */
  const rejected = [];

  for (const [index, row] of rows.entries()) {
    if (parsed.length >= cap) break;

    // Header is line 1, so the first data row is line 2.
    const line = index + 2;
    const record = toRecord(columns, row);
    const problem = validate(record);

    if (problem !== null) {
      rejected.push({ line, reason: problem });
      continue;
    }

    parsed.push(toReview(record, line));
  }

  return { rows: parsed, rejected, columns };
}

/**
 * @param {string[]} columns
 * @param {string[]} row
 * @returns {Record<string, string>}
 */
function toRecord(columns, row) {
  /** @type {Record<string, string>} */
  const record = {};

  for (const [index, column] of columns.entries()) {
    record[column] = (row[index] ?? '').trim();
  }

  return record;
}

/**
 * Why a row cannot become a review, or null.
 *
 * @param {Record<string, string>} record
 * @returns {string | null}
 */
function validate(record) {
  for (const column of REQUIRED) {
    if ((record[column] ?? '') === '') return `${column} is empty`;
  }

  const rating = Number(record.rating);

  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    // Rejected, never clamped. A 7 in a rating column means the export is from
    // a source with a different scale, and silently calling it a 5 would put a
    // number on a client's website that nobody wrote.
    return `rating "${record.rating}" is not an integer between ${MIN_RATING} and ${MAX_RATING}`;
  }

  return null;
}

/**
 * @param {Record<string, string>} record
 * @param {number} line
 * @returns {any}
 */
function toReview(record, line) {
  return {
    author: {
      name: record.author_name,
      initials: blankToNull(record.author_initials) ?? initialsOf(record.author_name ?? ''),
      avatar_url: blankToNull(record.author_avatar_url),
      profile_url: blankToNull(record.author_profile_url),
      // The format cannot express these, and the adapter says so rather than
      // guessing. A null explained by a capability declaration is different
      // from a null that means "absent".
      is_local_guide: null,
      review_count_hint: null,
    },
    rating: Number(record.rating),
    text: blankToNull(record.text),
    relative_date: record.date,
    language: blankToNull(record.language),
    likes: toIntegerOrNull(record.likes),
    photo_count: toIntegerOrNull(record.photo_count),
    owner_reply: buildReply(record),
    source: 'csv',
    source_url: blankToNull(record.source_url),
    external_id: blankToNull(record.external_id),
    verified: null,
    // Diagnostics only, never identity (TR-EXT-031). It is the line number, so
    // it is stable for a given file and meaningless across files.
    node_ordinal: line,
  };
}

/**
 * @param {Record<string, string>} record
 * @returns {any}
 */
function buildReply(record) {
  const text = blankToNull(record.owner_reply_text);

  if (text === null) return null;

  return { text, relative_date: blankToNull(record.owner_reply_date) };
}

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function blankToNull(value) {
  return value === undefined || value.trim() === '' ? null : value;
}

/**
 * @param {string | undefined} value
 * @returns {number | null}
 */
function toIntegerOrNull(value) {
  if (value === undefined || value.trim() === '') return null;

  const parsed = Number(value);

  // A non-numeric value in an optional numeric column is dropped rather than
  // rejecting the row. The review is still publishable; the like count is not.
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Initials from a name, when the export does not supply them.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function initialsOf(name) {
  const parts = name
    .split(/\s+/u)
    .map((part) => [...part][0])
    .filter((letter) => letter !== undefined);

  return parts.length === 0 ? null : parts.join('').toUpperCase();
}
