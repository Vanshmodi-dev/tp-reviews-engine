/**
 * Steps 1 and 2 — decode entities, then **remove** markup.
 *
 * TR-NORM-010: markup is REMOVED, never escaped. The payload contains no markup
 * of any kind and there is no `text_html` field — there must never be one.
 * Escaping would mean a consumer that unescapes gets live markup back, and the
 * engine cannot know how every client website renders its text.
 *
 * The order is normative and non-obvious. Decoding must precede stripping,
 * because `&lt;script&gt;` left undecoded survives stripping as literal text and
 * then re-encodes into markup downstream — the payload looks clean and the
 * client site executes it.
 *
 * @module core/normalize/markup
 */

/**
 * Named entities this decoder resolves.
 *
 * Deliberately small. `core/` has zero dependencies (DEP-1), and the full HTML5
 * named-character-reference table is ~2,200 entries of which review text uses a
 * handful. Anything not listed here is left as literal text, which is safe: an
 * unrecognised `&foo;` is not markup and cannot become markup, because step 2
 * removes anything that could.
 */
/** @type {Readonly<Record<string, string>>} */
const NAMED_ENTITIES = Object.freeze({
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
});

/**
 * Decoding passes before giving up.
 *
 * Bounded rather than "until stable" so that a crafted input cannot spin the
 * loop. Five layers is far beyond anything seen in real review text — the
 * documented adversarial case is triple-encoded — and the markup self-check
 * (T-069) catches the pathological remainder rather than this loop trying
 * forever.
 */
const MAX_DECODE_PASSES = 5;

/** Highest valid Unicode code point. Beyond this, `String.fromCodePoint` throws. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Resolves one entity reference, or returns the original text when it is not
 * one this decoder knows.
 *
 * Split out of the replacer so neither function exceeds the complexity limit -
 * three reference syntaxes plus two bounds checks is more branching than one
 * arrow should carry.
 *
 * @param {string} match The whole `&...;` sequence.
 * @param {string} ref The part between `&` and `;`.
 * @returns {string}
 */
function resolveReference(match, ref) {
  const lower = ref.toLowerCase();

  if (lower.startsWith('#x')) return fromCodePoint(Number.parseInt(ref.slice(2), 16), match);
  if (lower.startsWith('#')) return fromCodePoint(Number.parseInt(ref.slice(1), 10), match);

  return NAMED_ENTITIES[lower] ?? match;
}

/**
 * @param {number} code
 * @param {string} fallback Returned when the code point is out of range.
 * @returns {string}
 */
function fromCodePoint(code, fallback) {
  return Number.isFinite(code) && code >= 0 && code <= MAX_CODE_POINT
    ? String.fromCodePoint(code)
    : fallback;
}

/**
 * One decoding pass: named, decimal, and hexadecimal references.
 *
 * @param {string} text
 * @returns {string}
 */
function decodePass(text) {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/giu, (match, body) =>
    resolveReference(String(match), String(body)),
  );
}

/**
 * Resolves entity references repeatedly, until the text stops changing.
 *
 * Repetition is the whole point. `&amp;lt;script&amp;gt;` decodes in one pass to
 * `&lt;script&gt;`, which is still an encoded tag; a single-pass decoder leaves
 * it as literal text that re-encodes downstream into a live tag. The documented
 * adversarial case is exactly this, doubled and tripled.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  let current = text;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodePass(current);
    if (next === current) return current;
    current = next;
  }

  return current;
}

/**
 * Removes tags, comments, and tag-like constructs.
 *
 * A bare `<` is not markup. "5 < 10" is ordinary review text and must survive,
 * so a construct only counts as tag-like when `<` is followed by a letter, `/`,
 * `!`, or `?` — the characters that can actually begin a tag, a closing tag, a
 * declaration, or a processing instruction.
 *
 * The closing `>` is optional, which is what handles the unclosed-tag case: a
 * review ending `<div` has no matching `>`, and leaving it would let a later
 * concatenation complete the tag.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripMarkup(text) {
  return (
    text
      // Comments first, including unterminated ones. A general tag pattern would
      // stop at the first `>` inside the comment and leave `-->` as text.
      .replaceAll(/<!--[\s\S]*?(?:-->|$)/gu, '')
      // CDATA, which can wrap markup in XML-ish sources.
      .replaceAll(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/giu, '')
      // Tags, declarations, processing instructions; closing `>` optional.
      .replaceAll(/<[!?/a-zA-Z][^>]*(?:>|$)/gu, '')
  );
}

/**
 * Steps 1 and 2 together, applied until the result stops changing.
 *
 * Alternating is necessary rather than tidy: stripping can join text that was
 * separated by a tag, and that join can form an entity — `&a<b>mp;` becomes
 * `&amp;` once the tag is gone, which then decodes to `&`. Neither order alone
 * catches it.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeAndStrip(text) {
  let current = text;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = stripMarkup(decodeEntities(current));
    if (next === current) return current;
    current = next;
  }

  return current;
}

/**
 * Whether any tag-like construct or tag-forming entity survives.
 *
 * Used by the post-pipeline self-check (T-069). A `true` here is
 * `ERR-CLEAN-MARKUP-SURVIVED`, which is `critical`: it means the security
 * boundary itself failed.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasSurvivingMarkup(text) {
  return /<[!?/a-zA-Z]/u.test(text) || /&(?:lt|gt|#0*60|#0*62|#x0*3[ce]);/iu.test(text);
}
