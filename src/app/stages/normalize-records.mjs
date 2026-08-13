/**
 * Stage 4 · Normalize — `ExtractedReview[]` → `NormalizedReview[]` (TRD §23).
 *
 * ## Why this file did not exist until SP-8
 *
 * Every piece it uses was built and exhaustively tested in PH-02 … PH-05:
 * `normalize`, `deriveAuthorKey`, `deriveIdentityHash`, `deriveContentHash`,
 * `resolveRelativePhrase`, `detectLanguage`, `validateRecord`. What was never
 * written is the thing that calls them **in order, per record**.
 *
 * The audit that found C-08 missing found this too, by a different route:
 * `deriveIdentityHash` was imported by its own module and by tests, and by
 * nothing else in `src/`. A hash function nobody calls is a hash function whose
 * output has never reached a ledger.
 *
 * ## Fails softly, per record (TRD §1.3 stage 4)
 *
 * One malformed review must not cost the other forty-nine. A record that cannot
 * be normalised is quarantined with a code and an ordinal, and the harvest
 * continues — the same shape as extraction's per-record quarantine, for the
 * same reason: an all-or-nothing stage means one bad row removes a client's
 * entire review set, every run, until a human notices.
 *
 * ## Order is not arbitrary
 *
 * Text is sanitised BEFORE the hashes are derived. Deriving identity from raw
 * text would make the hash depend on markup that normalisation removes, so the
 * same review harvested before and after a markup change would produce two
 * identities — and the reconciler would read that as one review deleted and one
 * inserted, on a site where nothing had changed.
 *
 * @module app/stages/normalize-records
 */

// Through the barrel, never past it (DR-6). Several of these were added to
// `core/index.mjs` in SP-8, because this file is the first consumer outside
// `core/` that any of them ever had.
import {
  deriveAuthorKey,
  deriveContentHash,
  deriveIdentityHash,
  detectLanguage,
  normalize,
  pinDate,
  shouldQuarantine,
  validateRecord,
} from '../../core/index.mjs';

/**
 * @param {number} ordinal
 * @param {string} code
 * @param {string} detail
 * @returns {any}
 */
function quarantined(ordinal, code, detail) {
  return { ordinal, code, detail };
}

/**
 * Normalises one extracted review.
 *
 * @param {any} extracted
 * @param {{ listingKey: string, source: string, observedAtMs: number, locale: string, ordinal: number }} ctx
 * @returns {{ record: any, quarantine: null } | { record: null, quarantine: any }}
 */
export function normaliseOne(extracted, ctx) {
  const refusal = precheck(extracted, ctx);

  if (refusal !== null) return refusal;

  const rating = extracted.rating;
  const derived = derive(extracted, ctx);
  const { body, cleanAuthor, text, authorKey, date, language, reply, likes, photoCount } = derived;
  const content = hashContent({ extracted, rating, text, cleanAuthor, reply, likes, photoCount });

  if (content.ok === false) {
    return {
      record: null,
      quarantine: quarantined(ctx.ordinal, 'ERR-HASH-INPUT', String(content.error)),
    };
  }

  const record = buildRecord({
    extracted,
    ctx,
    rating,
    text,
    body,
    cleanAuthor,
    authorKey,
    date,
    language,
    reply,
    likes,
    photoCount,
    contentHash: content.value,
  });

  const findings = validateRecord(record);

  return shouldQuarantine(findings)
    ? {
        record: null,
        quarantine: quarantined(
          ctx.ordinal,
          findings[0]?.code ?? 'ERR-VALIDATE-RECORD',
          findings.map((/** @type {any} */ f) => f.code ?? f.rule).join(', '),
        ),
      }
    : { record, quarantine: null };
}

/**
 * Everything derived from one extracted review, in dependency order.
 *
 * Text is sanitised before the keys that depend on it: the author key and both
 * hashes are derived from NORMALISED text, so the same review before and after
 * a markup change produces one identity rather than two.
 *
 * @param {any} extracted
 * @param {any} ctx
 * @returns {any}
 */
function derive(extracted, ctx) {
  const body = normalize(extracted.text ?? '');
  const authorName = extracted.author?.name ?? extracted.author_name ?? null;
  const cleanAuthor = authorName === null ? null : normalize(authorName).text;
  const text = body.text === '' ? null : body.text;

  return {
    body,
    cleanAuthor,
    text,
    // The anonymous context is the listing plus the review's own text, not the
    // ordinal. Ordinal position changes between harvests as reviews are added,
    // so keying on it would give the same anonymous review a new identity every
    // run — and the reconciler would read that as a deletion and an insertion.
    authorKey: deriveAuthorKey(cleanAuthor, { listingKey: ctx.listingKey, text }),
    date: resolveDate(extracted, ctx),
    language: text === null ? { code: null, confidence: null } : detectLanguage(text),
    reply: normaliseReply(extracted.owner_reply, ctx),
    ...counts(extracted),
  };
}

/** @param {any} extracted @returns {string} */
function relativePhrase(extracted) {
  return extracted.relative_date_raw ?? extracted.relative_date ?? '';
}

/** An absolute calendar date, as several adapters supply it. */
const ABSOLUTE_DATE = /^(\d{4}-\d{2}-\d{2})/u;

/**
 * The review's date, from whichever form the adapter had.
 *
 * Not every source speaks in relative phrases. The CSV adapter carries a real
 * calendar date, and the Business Profile API carries an RFC 3339 `createTime`.
 * Pinning only the relative phrase threw those away and gave every such review
 * `null` with `unknown` precision — losing information the source had actually
 * provided, and making date-ordered display meaningless for two of the three
 * adapters.
 *
 * An absolute date is taken at DAY precision and HIGH confidence, because that
 * is what it is: the source said so, and no estimation was involved.
 *
 * @param {any} extracted
 * @param {any} ctx
 * @returns {{ date_estimated: string | null, date_precision: string, date_confidence: string }}
 */
function resolveDate(extracted, ctx) {
  // The relative-date field is where an adapter puts whatever the source gave
  // it, and that is not always relative: the CSV adapter carries a calendar
  // date there, and the Business Profile API an RFC 3339 `createTime`.
  const raw = String(extracted.date ?? extracted.date_raw ?? relativePhrase(extracted));
  const absolute = ABSOLUTE_DATE.exec(raw);

  if (absolute !== null) {
    return {
      date_estimated: absolute[1] ?? null,
      date_precision: 'day',
      date_confidence: 'high',
    };
  }

  return pinDate(relativePhrase(extracted), ctx.observedAtMs, ctx.locale);
}

/**
 * The two optional engagement counts.
 *
 * Adapters disagree about where these live — some nest them under `meta`, some
 * flatten them — so both shapes are read, and anything non-numeric becomes
 * `null` rather than `0`. Zero is a claim the source did not make, and it is
 * indistinguishable downstream from a review nobody found helpful.
 *
 * @param {any} extracted
 * @returns {{ likes: number | null, photoCount: number | null }}
 */
function counts(extracted) {
  return {
    likes: numberOrNull(extracted.meta?.likes ?? extracted.likes),
    photoCount: numberOrNull(extracted.meta?.photo_count ?? extracted.photo_count),
  };
}

/**
 * Assembles the ledger record.
 *
 * Every field is either taken from a derivation above or defaulted to `null`.
 * Nothing here computes: a value that needed a decision was decided in `core/`
 * and tested there.
 *
 * @param {any} input
 * @returns {any}
 */
function buildRecord({
  extracted,
  ctx,
  rating,
  text,
  body,
  cleanAuthor,
  authorKey,
  date,
  language,
  reply,
  likes,
  photoCount,
  contentHash,
}) {
  return {
    identity_hash: deriveIdentityHash({
      listingKey: ctx.listingKey,
      source: ctx.source,
      authorKey,
      text,
      rating,
    }),
    content_hash: contentHash,
    author_key: authorKey,
    author: buildAuthor(extracted, cleanAuthor),
    rating,
    text,
    text_truncated: extracted.text_truncated === true,
    text_clipped: body.text_clipped,
    date_estimated: date.date_estimated,
    date_precision: date.date_precision,
    date_confidence: date.date_confidence,
    // Verbatim, and deliberately excluded from `content_hash` (TR-HASH-010):
    // "3 days ago" changes wording every single day without the review having
    // changed, and hashing it would republish every payload every run.
    relative_date: extracted.relative_date_raw ?? extracted.relative_date ?? null,
    language: language.code,
    language_confidence: language.confidence,
    likes,
    photo_count: photoCount,
    owner_reply: reply,
    source: ctx.source,
    source_url: extracted.source_url ?? null,
    verified: extracted.verified ?? null,
  };
}

/**
 * The two refusals that need nothing derived.
 *
 * Checked first so a record that cannot be published costs no hashing, and so
 * the rating guard cannot be reached around by a later edit.
 *
 * @param {any} extracted
 * @param {any} ctx
 * @returns {any | null}
 */
function precheck(extracted, ctx) {
  const rating = extracted.rating;

  // Rating is the one field with no sensible fallback. A review with no rating
  // is not a review with a default rating — publishing 5 would be inventing a
  // customer's opinion, which is the single worst thing this engine could do.
  if (typeof rating !== 'number' || Number.isNaN(rating)) {
    return {
      record: null,
      quarantine: quarantined(ctx.ordinal, 'ERR-PARSE-RATING-INVALID', 'no usable rating'),
    };
  }

  // TR-NORM-030: the normalizer checks its own work. If markup survived, the
  // record is quarantined rather than published — this is the second of the two
  // independent defences INV-05 rests on (the renderer is the other).
  return normalize(extracted.text ?? '').markup_survived
    ? {
        record: null,
        quarantine: quarantined(
          ctx.ordinal,
          'ERR-CLEAN-MARKUP-SURVIVED',
          'markup survived normalisation',
        ),
      }
    : null;
}

/**
 * The content hash, over every field that can change the published bytes.
 *
 * A Result, not a string: a malformed input is a refusal rather than a hash of
 * something slightly wrong, because a wrong content hash means either a payload
 * that never republishes or one that republishes every run.
 *
 * @param {any} input
 * @returns {any}
 */
function hashContent({ extracted, rating, text, cleanAuthor, reply, likes, photoCount }) {
  return deriveContentHash({
    rating,
    text,
    text_truncated: extracted.text_truncated === true,
    author_name: cleanAuthor,
    author_avatar_url: extracted.author?.avatar_url ?? null,
    reply_text: reply?.text ?? null,
    reply_date: reply?.date ?? null,
    likes,
    photo_count: photoCount,
  });
}

/**
 * The published author block.
 *
 * Every optional field defaults to `null`, never to a placeholder. `null` means
 * "the source did not say"; a fabricated initial or a default avatar would be
 * the engine inventing a fact about a real person.
 *
 * @param {any} extracted
 * @param {string | null} cleanAuthor
 * @returns {any}
 */
function buildAuthor(extracted, cleanAuthor) {
  const author = extracted.author ?? {};

  return {
    name: cleanAuthor,
    initials: author.initials ?? null,
    avatar_url: author.avatar_url ?? null,
    profile_url: author.profile_url ?? null,
    is_local_guide: author.is_local_guide ?? null,
    review_count_hint: author.review_count_hint ?? null,
  };
}

/**
 * @param {any} reply
 * @param {any} ctx
 * @returns {any}
 */
function normaliseReply(reply, ctx) {
  if (reply === null || reply === undefined) return null;

  const text = normalize(reply.text ?? '');

  if (text.markup_survived || text.text === '') return null;

  const date = pinDate(reply.relative_date_raw ?? '', ctx.observedAtMs, ctx.locale);

  return {
    text: text.text,
    date: date.date_estimated,
    date_precision: date.date_precision,
    relative_date: reply.relative_date_raw ?? null,
    // Never a personal name (TRD §23). An owner reply is published by the
    // business, and attributing it to an individual would put a name on a
    // client's site that nobody agreed to.
    author_label: reply.author_label_raw ?? null,
  };
}

/**
 * Normalises a harvest.
 *
 * @param {ReadonlyArray<any>} extracted
 * @param {{ listingKey: string, source: string, observedAtMs: number, locale?: string }} ctx
 * @returns {{ records: any[], quarantined: any[] }}
 */
export function normaliseRecords(extracted, ctx) {
  /** @type {any[]} */
  const records = [];
  /** @type {any[]} */
  const rejected = [];

  for (const [ordinal, review] of (extracted ?? []).entries()) {
    const outcome = normaliseOne(review, {
      listingKey: ctx.listingKey,
      source: ctx.source,
      observedAtMs: ctx.observedAtMs,
      locale: ctx.locale ?? 'en',
      ordinal,
    });

    if (outcome.record === null) rejected.push(outcome.quarantine);
    else records.push(outcome.record);
  }

  return { records, quarantined: rejected };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
