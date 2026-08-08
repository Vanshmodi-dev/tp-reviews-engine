import { describe, expect, it } from 'vitest';

import {
  initialsOf,
  parseCsv,
  splitRows,
} from '../../../src/adapters/acquisition/file-csv/parse.mjs';

const HEADER = 'author_name,rating,date,text';

/**
 * @param {string[]} lines
 * @returns {string}
 */
const file = (...lines) => [HEADER, ...lines].join('\n');

describe('splitRows handles what a spreadsheet actually produces', () => {
  it('splits plain rows', () => {
    expect(splitRows('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    // The single most common thing in a review body.
    expect(splitRows('a,"b,c"')).toEqual([['a', 'b,c']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(splitRows('a,"line one\nline two"')).toEqual([['a', 'line one\nline two']]);
  });

  it('unescapes a doubled quote', () => {
    expect(splitRows('a,"she said ""hello"""')).toEqual([['a', 'she said "hello"']]);
  });

  it('treats CRLF as one row break, not two', () => {
    // A Windows-authored export would otherwise yield an empty row between
    // every pair of reviews.
    expect(splitRows('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads a final row with no trailing newline', () => {
    expect(splitRows('a,b\nc,d')).toHaveLength(2);
  });

  it('strips a UTF-8 BOM', () => {
    // Left in place it becomes part of the first column name, so the header
    // stops matching and every row is rejected - for a file that looks
    // perfectly correct in a spreadsheet.
    expect(splitRows('﻿author_name,rating')).toEqual([['author_name', 'rating']]);
  });

  it('drops blank lines', () => {
    expect(splitRows('a,b\n\n\nc,d')).toHaveLength(2);
  });

  it('returns nothing for empty input', () => {
    expect(splitRows('')).toEqual([]);
  });
});

describe('per-row isolation (T-181)', () => {
  it('keeps the good rows when one is bad', () => {
    // The whole point. Ninety-nine reviews and one reported rejection, not zero
    // reviews and one error.
    const result = parseCsv(
      file('Dana,5,2026-01-15,Good', 'Bad,9,2026-01-16,Out of range', 'Alex,4,2026-01-17,Fine'),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it('reports the line number and the reason', () => {
    // Without the line number a hundred-row file becomes a search.
    const result = parseCsv(file('Dana,5,2026-01-15,Good', 'Bad,9,2026-01-16,x'));

    expect(result.rejected[0].line).toBe(3);
    expect(result.rejected[0].reason).toContain('rating "9"');
  });

  it('REJECTS an out-of-range rating rather than clamping it', () => {
    // A 7 means the export came from a source with a different scale. Silently
    // calling it a 5 puts a number on a client's website that nobody wrote.
    expect(parseCsv(file('Dana,7,2026-01-15,x')).rows).toEqual([]);
    expect(parseCsv(file('Dana,0,2026-01-15,x')).rows).toEqual([]);
  });

  it('rejects a non-integer rating', () => {
    expect(parseCsv(file('Dana,4.5,2026-01-15,x')).rejected).toHaveLength(1);
    expect(parseCsv(file('Dana,five,2026-01-15,x')).rejected).toHaveLength(1);
  });

  it('rejects a row missing a required value', () => {
    expect(parseCsv(file(',5,2026-01-15,x')).rejected[0].reason).toContain('author_name is empty');
    expect(parseCsv(file('Dana,5,,x')).rejected[0].reason).toContain('date is empty');
  });

  it('reports a missing required COLUMN once, not per row', () => {
    // No row in the file can become a review, so a per-row report would be a
    // hundred copies of one fact.
    const result = parseCsv('author_name,text\nDana,Good\nAlex,Fine');

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('missing required column(s): rating, date');
  });

  it('reports an empty file', () => {
    expect(parseCsv('').rejected[0].reason).toContain('empty');
  });
});

describe('optional columns and unknown columns', () => {
  it('ignores an unknown column rather than rejecting the file', () => {
    // A client export routinely carries columns the engine has no use for.
    const result = parseCsv('author_name,rating,date,vendor_internal_id\nDana,5,2026-01-15,XYZ');

    expect(result.rows).toHaveLength(1);
  });

  it('derives initials when the export omits them', () => {
    expect(parseCsv(file('Dana Smith,5,2026-01-15,x')).rows[0].author.initials).toBe('DS');
  });

  it('prefers supplied initials over derived ones', () => {
    const result = parseCsv('author_name,rating,date,author_initials\nDana Smith,5,2026-01-15,DXS');

    expect(result.rows[0].author.initials).toBe('DXS');
  });

  it('reads an owner reply only when there is reply text', () => {
    const withReply = parseCsv(
      'author_name,rating,date,owner_reply_text\nDana,5,2026-01-15,Thank you',
    );

    expect(withReply.rows[0].owner_reply.text).toBe('Thank you');
    expect(parseCsv(file('Dana,5,2026-01-15,x')).rows[0].owner_reply).toBeNull();
  });

  it('drops a non-numeric optional number rather than rejecting the row', () => {
    // The review is still publishable; the like count is not.
    const result = parseCsv('author_name,rating,date,likes\nDana,5,2026-01-15,many');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].likes).toBeNull();
  });

  it('declares the fields the format cannot express as null', () => {
    const review = parseCsv(file('Dana,5,2026-01-15,x')).rows[0];

    expect(review.author.is_local_guide).toBeNull();
    expect(review.verified).toBeNull();
  });

  it('carries the line number as a diagnostic ordinal only', () => {
    // TR-EXT-031: never used for identity. Stable within a file, meaningless
    // across files.
    expect(parseCsv(file('Dana,5,2026-01-15,x')).rows[0].node_ordinal).toBe(2);
  });
});

describe('the cap', () => {
  it('stops at the configured ceiling', () => {
    const result = parseCsv(file('A,5,2026-01-15,x', 'B,5,2026-01-16,x', 'C,5,2026-01-17,x'), {
      cap: 2,
    });

    expect(result.rows).toHaveLength(2);
  });

  it('reads everything when no cap is given', () => {
    expect(parseCsv(file('A,5,2026-01-15,x', 'B,5,2026-01-16,x')).rows).toHaveLength(2);
  });
});

describe('initialsOf', () => {
  it('takes the first letter of each word', () => {
    expect(initialsOf('Dana Smith')).toBe('DS');
    expect(initialsOf('mary jane watson')).toBe('MJW');
  });

  it('handles a single name', () => {
    expect(initialsOf('Cher')).toBe('C');
  });

  it('handles a non-Latin name by grapheme', () => {
    expect(initialsOf('あき たなか')).toBe('あた');
  });

  it('returns null for an empty name', () => {
    expect(initialsOf('')).toBeNull();
    expect(initialsOf('   ')).toBeNull();
  });
});
