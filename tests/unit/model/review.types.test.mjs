import { describe, expect, it } from 'vitest';

import { markNormalised } from '../../../src/core/model/review.mjs';

/**
 * T-052's verification: **type-check a deliberate misuse**.
 *
 * Each `@ts-expect-error` asserts that the line under it does NOT type-check.
 * If the brand ever stops working — if someone widens `PayloadReview.text` to
 * `string`, or drops the unique symbol — the suppression becomes unused and
 * `npm run typecheck` fails with TS2578, "unused '@ts-expect-error' directive".
 *
 * That inversion is the point. An ordinary test asserts something is true; this
 * asserts something remains *impossible*, and fails the moment it becomes
 * possible.
 *
 * The assertions are written as function calls rather than annotated
 * declarations, because a `@ts-expect-error` only suppresses the line directly
 * beneath it — and with a JSDoc `@type` annotation in between, the error lands
 * on the initialiser two lines down and the directive reports as unused.
 *
 * @typedef {import('../../../src/core/model/review.mjs').CleanString} CleanString
 * @typedef {import('../../../src/core/model/review.mjs').PayloadReview} PayloadReview
 * @typedef {import('../../../src/core/model/review.mjs').Author} Author
 * @typedef {import('../../../src/core/model/review.mjs').OwnerReply} OwnerReply
 */

/**
 * Stands in for any function or field that requires normalised text.
 *
 * @param {CleanString | null} text
 * @returns {number}
 */
function wantsCleanText(text) {
  return text === null ? 0 : text.length;
}

/**
 * Stands in for building the public contract.
 *
 * @param {Pick<PayloadReview, 'text'>} payload
 * @returns {boolean}
 */
function publishes(payload) {
  return payload.text !== null;
}

/**
 * @param {Pick<Author, 'name'>} author
 * @returns {boolean}
 */
function publishesAuthor(author) {
  return author.name !== null;
}

describe('CleanString brand (compile-time)', () => {
  it('rejects a raw string where normalised text is required', () => {
    // @ts-expect-error raw source text has not been through core/normalize/
    const misuse = () => wantsCleanText('text off a source <script>alert(1)</script>');

    expect(misuse).not.toThrow();
  });

  it('rejects raw text reaching the public payload contract', () => {
    // @ts-expect-error unnormalised text must never reach a client website
    const misuse = () => publishes({ text: 'raw <b>markup</b>' });

    expect(misuse).not.toThrow();
  });

  it('rejects raw text as an author name', () => {
    // @ts-expect-error an author name is published, so it is normalised too
    const misuse = () => publishesAuthor({ name: 'Raw <i>Name</i>' });

    expect(misuse).not.toThrow();
  });

  it('rejects a string built by concatenating normalised and raw text', () => {
    const clean = markNormalised('normalised');

    // Concatenation launders the brand away, which is correct: the result has
    // not been normalised as a whole.
    // @ts-expect-error concatenation produces a plain string, not a CleanString
    const misuse = () => wantsCleanText(`${clean} <b>and raw</b>`);

    expect(misuse).not.toThrow();
  });

  it('accepts a branded string', () => {
    const clean = markNormalised('normalised text');

    expect(wantsCleanText(clean)).toBe(15);
    expect(publishes({ text: clean })).toBe(true);
  });

  it('accepts null where the field is nullable', () => {
    // A rating-only review has no text at all. That is not the same as empty
    // text, and both are different from "text we failed to normalise".
    expect(wantsCleanText(null)).toBe(0);
    expect(publishes({ text: null })).toBe(false);
  });

  it('lets a CleanString widen to string on the way out', () => {
    // The brand narrows what can go IN, never what can come out. A consumer
    // reading payload.text gets an ordinary string.
    /** @type {string} */
    const widened = markNormalised('abc');

    expect(widened.toUpperCase()).toBe('ABC');
  });
});
