import { absenceIsMeaningful } from './review.mjs';

/**
 * The Ledger — the engine's durable record of every review it has ever seen.
 *
 * **Nothing regenerates a ledger.** Every published payload is regenerable from
 * it with `tpre project`, without touching the network; the reverse is not
 * true. A review dropped from here because a partial harvest was mistaken for a
 * deletion is simply gone.
 *
 * This module owns the *shape* and the *safe mutations*. It deliberately owns
 * no decisions: which mutation applies to which observation is
 * `core/reconcile/`'s job in PH-05. The split matters because the decision
 * logic is the hardest thing in the system, while these primitives are
 * mechanical — and separating them means the hard part is written against
 * operations that cannot silently violate the field-mutation matrix.
 *
 * Each function here enforces one column of TRD §22.5.2. In particular
 * {@link updateReview} takes `first_seen_at` and the pinned date from the
 * *existing* record and never from the incoming one, so PT-05 and PT-06 hold by
 * construction rather than by remembering.
 *
 * TR-REC-022: every function returns new objects and mutates nothing.
 * TR-REC-030: `now` is always an explicit parameter. There is no default, ever.
 *
 * @module core/model/ledger
 */

/**
 * @typedef {import('./review.mjs').NormalizedReview} NormalizedReview
 * @typedef {import('./review.mjs').LedgerReview} LedgerReview
 */

export const LEDGER_VERSION = 1;

/**
 * What a mutation did. Returned alongside the new ledger so the caller can
 * build a decision log without re-deriving what happened.
 */
export const OUTCOMES = Object.freeze({
  INSERTED: 'INSERTED',
  UPDATED: 'UPDATED',
  UNCHANGED: 'UNCHANGED',
  MISSING: 'MISSING',
  TOMBSTONED: 'TOMBSTONED',
  SUPPRESSED: 'SUPPRESSED',
  /** The id is tombstoned or suppressed. Both are terminal; the observation is dropped. */
  IGNORED_TERMINAL: 'IGNORED_TERMINAL',
  /** Absence observed in a harvest too incomplete to mean anything. Nothing changed. */
  HELD: 'HELD',
  /** The id is not in the ledger. */
  ABSENT: 'ABSENT',
});

/**
 * The durable record for one listing.
 *
 * `records` is a **Map keyed by `identity_hash`**, not an array (TR-REC-031,
 * IR-24). An array forces a nested scan per observed review, which is O(n²)
 * allocation at the thousand-review listings this system is explicitly built
 * for.
 *
 * @typedef {object} Ledger
 * @property {number} ledger_version
 * @property {number} identity_algo_version  Bumping this is a migration, not an edit (§53.6).
 * @property {string} client_slug            Immutable after first publication (TR-GIT-003).
 * @property {string} listing_key            Immutable after first publication (TR-GIT-003).
 * @property {ReadonlyMap<string, LedgerReview>} records
 * @property {string} created_at             RFC 3339.
 * @property {string} updated_at             RFC 3339.
 * @property {string | null} last_full_harvest_at  The honest freshness signal (§52.6).
 */

/**
 * @param {object} spec
 * @param {string} spec.clientSlug
 * @param {string} spec.listingKey
 * @param {string} spec.now RFC 3339.
 * @param {number} [spec.identityAlgoVersion]
 * @returns {Ledger}
 */
export function createLedger({ clientSlug, listingKey, now, identityAlgoVersion = 1 }) {
  return Object.freeze({
    ledger_version: LEDGER_VERSION,
    identity_algo_version: identityAlgoVersion,
    client_slug: clientSlug,
    listing_key: listingKey,
    records: new Map(),
    created_at: now,
    updated_at: now,
    last_full_harvest_at: null,
  });
}

/**
 * Replaces one record, returning a new ledger. The Map is copied rather than
 * mutated, because a reconciler that crashes halfway must leave its input
 * intact for the retry (TR-REC-022, PT-01).
 *
 * @param {Ledger} ledger
 * @param {string} identityHash
 * @param {LedgerReview} record
 * @param {string} now
 * @returns {Ledger}
 */
function withRecord(ledger, identityHash, record, now) {
  const records = new Map(ledger.records);
  records.set(identityHash, Object.freeze(record));

  return Object.freeze({ ...ledger, records, updated_at: now });
}

/**
 * Reads only `state`, so it is typed to that rather than to a whole record:
 * asking a one-field question should not require constructing one.
 *
 * @param {{ state?: string } | undefined} record
 * @returns {boolean} Whether this id can never become active again.
 */
export function isTerminal(record) {
  return record?.state === 'tombstoned' || record?.state === 'suppressed';
}

/**
 * INSERT. Sets `first_seen_at`, pins the date, starts the revision count.
 *
 * Refuses to resurrect a terminal id. A tombstoned or suppressed
 * `identity_hash` must never become active again under any observation
 * sequence — including one where the review genuinely reappears at the source
 * (TR-REC-014, TR-REC-015, PT-03, PT-04). "Deleted review comes back" is
 * embarrassing when it is a mistake and legally significant when it is an
 * erasure request.
 *
 * @param {Ledger} ledger
 * @param {NormalizedReview} review
 * @param {string} now RFC 3339.
 * @returns {{ ledger: Ledger, outcome: string }}
 */
export function insertReview(ledger, review, now) {
  const existing = ledger.records.get(review.identity_hash);

  if (isTerminal(existing)) {
    return { ledger, outcome: OUTCOMES.IGNORED_TERMINAL };
  }

  /** @type {LedgerReview} */
  const record = {
    review,
    state: 'active',
    first_seen_at: now,
    last_seen_at: now,
    last_updated_at: now,
    revision: 1,
    missing_streak: 0,
    tombstoned_at: null,
    content_hash_history: Object.freeze([]),
  };

  return {
    ledger: withRecord(ledger, review.identity_hash, record, now),
    outcome: OUTCOMES.INSERTED,
  };
}

/**
 * UPDATE. The content changed, so the revision advances and the prior content
 * hash is appended to the history.
 *
 * **`first_seen_at` and the pinned `date_estimated` come from the EXISTING
 * record, never from the incoming review.** That is the whole protection behind
 * PT-05 and PT-06, and it is enforced here rather than trusted to the caller,
 * because the incoming review carries plausible-looking values for both and
 * using them would be the natural mistake.
 *
 * @param {Ledger} ledger
 * @param {NormalizedReview} review
 * @param {string} now RFC 3339.
 * @returns {{ ledger: Ledger, outcome: string }}
 */
export function updateReview(ledger, review, now) {
  const existing = ledger.records.get(review.identity_hash);

  if (existing === undefined) return { ledger, outcome: OUTCOMES.ABSENT };
  if (isTerminal(existing)) return { ledger, outcome: OUTCOMES.IGNORED_TERMINAL };

  /** @type {LedgerReview} */
  const record = {
    review: {
      ...review,
      // Pinned on first observation and never recomputed (TR-REC-021, PT-06).
      // A later harvest sees "3 months ago" where the first saw "2 months ago";
      // recomputing would walk the date forward on every run.
      date_estimated: existing.review.date_estimated,
      date_precision: existing.review.date_precision,
      date_confidence: existing.review.date_confidence,
    },
    state: 'active',
    first_seen_at: existing.first_seen_at,
    last_seen_at: now,
    last_updated_at: now,
    revision: existing.revision + 1,
    missing_streak: 0,
    tombstoned_at: null,
    content_hash_history: Object.freeze([
      ...existing.content_hash_history,
      existing.review.content_hash,
    ]),
  };

  return {
    ledger: withRecord(ledger, review.identity_hash, record, now),
    outcome: OUTCOMES.UPDATED,
  };
}

/**
 * UNCHANGED. The review was observed and its content is identical.
 *
 * Only `last_seen_at` moves, and the streak resets. `last_updated_at` and
 * `revision` are preserved — nothing about the review changed, so claiming an
 * update would make every payload look edited on every harvest and defeat
 * hash-gating.
 *
 * @param {Ledger} ledger
 * @param {string} identityHash
 * @param {string} now RFC 3339.
 * @returns {{ ledger: Ledger, outcome: string }}
 */
export function touchReview(ledger, identityHash, now) {
  const existing = ledger.records.get(identityHash);

  if (existing === undefined) return { ledger, outcome: OUTCOMES.ABSENT };
  if (isTerminal(existing)) return { ledger, outcome: OUTCOMES.IGNORED_TERMINAL };

  const record = { ...existing, last_seen_at: now, missing_streak: 0, state: 'active' };

  return { ledger: withRecord(ledger, identityHash, record, now), outcome: OUTCOMES.UNCHANGED };
}

/**
 * MISSING. The review did not appear in this harvest.
 *
 * **This is the absence asymmetry, and it is the most dangerous function in the
 * file.** Absence is only evidence of removal when the harvest was complete. On
 * a `partial` or `failed` harvest this changes *nothing* — not the streak, not
 * the state, not `last_seen_at` (TR-REC-011).
 *
 * An implementer who "simplifies" this by treating absence uniformly has
 * introduced the system's worst bug: one partial page load starts a countdown
 * to deleting a client's entire review set.
 *
 * @param {Ledger} ledger
 * @param {string} identityHash
 * @param {object} options
 * @param {string} options.completeness One of the completeness values.
 * @param {number} options.removalConfirmations Consecutive qualifying harvests before tombstoning.
 * @param {string} options.now RFC 3339.
 * @returns {{ ledger: Ledger, outcome: string }}
 */
export function markMissing(ledger, identityHash, { completeness, removalConfirmations, now }) {
  const existing = ledger.records.get(identityHash);

  if (existing === undefined) return { ledger, outcome: OUTCOMES.ABSENT };
  if (isTerminal(existing)) return { ledger, outcome: OUTCOMES.IGNORED_TERMINAL };

  // The asymmetry. Not a guard clause to tidy away.
  if (!absenceIsMeaningful(completeness)) {
    return { ledger, outcome: OUTCOMES.HELD };
  }

  const streak = existing.missing_streak + 1;
  const reached = streak >= removalConfirmations;

  const record = {
    ...existing,
    missing_streak: streak,
    state: reached ? 'tombstoned' : 'unconfirmed',
    tombstoned_at: reached ? now : null,
  };

  return {
    ledger: withRecord(ledger, identityHash, record, now),
    outcome: reached ? OUTCOMES.TOMBSTONED : OUTCOMES.MISSING,
  };
}

/**
 * SUPPRESS. Applied from `compliance/denylist.json` on `main`.
 *
 * Permanent and unconditional — it applies even to a tombstoned record, because
 * an erasure obligation outranks the lifecycle. There is deliberately no
 * un-suppress (PT-04).
 *
 * @param {Ledger} ledger
 * @param {string} identityHash
 * @param {string} now RFC 3339.
 * @returns {{ ledger: Ledger, outcome: string }}
 */
export function suppressReview(ledger, identityHash, now) {
  const existing = ledger.records.get(identityHash);

  if (existing === undefined) return { ledger, outcome: OUTCOMES.ABSENT };

  const record = { ...existing, state: 'suppressed' };

  return { ledger: withRecord(ledger, identityHash, record, now), outcome: OUTCOMES.SUPPRESSED };
}

/**
 * Records that a complete harvest happened. The freshness signal a client sees.
 *
 * @param {Ledger} ledger
 * @param {string} completeness
 * @param {string} now RFC 3339.
 * @returns {Ledger}
 */
export function recordHarvest(ledger, completeness, now) {
  return Object.freeze({
    ...ledger,
    updated_at: now,
    last_full_harvest_at: absenceIsMeaningful(completeness) ? now : ledger.last_full_harvest_at,
  });
}

/**
 * The records a payload may contain: active or unconfirmed, never terminal.
 *
 * An `unconfirmed` record is still published deliberately. It has been missing
 * for fewer harvests than the confirmation threshold, and pulling it early
 * would make a transient failure visible to visitors.
 *
 * @param {Ledger} ledger
 * @returns {LedgerReview[]}
 */
export function publishableRecords(ledger) {
  return [...ledger.records.values()].filter((record) => !isTerminal(record));
}

/**
 * Checks the invariants that must hold for any ledger at rest.
 *
 * This is a self-check, not validation of untrusted input: a violation means
 * the engine produced a state its own rules forbid, which is
 * `ERR-INTERNAL-INVARIANT` rather than a data problem.
 *
 * @param {Ledger} ledger
 * @returns {string[]} Violations, empty when the ledger is sound.
 */
export function checkLedgerInvariants(ledger) {
  const violations = [];

  for (const [identityHash, record] of ledger.records) {
    if (record.review.identity_hash !== identityHash) {
      violations.push(
        `key ${identityHash} does not match record identity ${record.review.identity_hash}`,
      );
    }
    if (record.revision < 1) {
      violations.push(`${identityHash}: revision ${record.revision} is below 1`);
    }
    if (record.missing_streak < 0) {
      violations.push(`${identityHash}: missing_streak ${record.missing_streak} is negative`);
    }
    if (record.state === 'tombstoned' && record.tombstoned_at === null) {
      violations.push(`${identityHash}: tombstoned without a tombstoned_at`);
    }
    if (record.first_seen_at > record.last_seen_at) {
      violations.push(`${identityHash}: first_seen_at is after last_seen_at`);
    }
    if (record.content_hash_history.length !== record.revision - 1) {
      violations.push(
        `${identityHash}: ${record.content_hash_history.length} prior hashes for revision ${record.revision}`,
      );
    }
  }

  return violations;
}

/**
 * Converts a ledger to its JSON shape. The Map becomes an object keyed by
 * `identity_hash`, with keys emitted in sorted order so that serialisation is
 * byte-stable and hash-gating works (TR-HASH-030).
 *
 * The I/O belongs to the state adapter; the shape belongs here.
 *
 * @param {Ledger} ledger
 * @returns {Record<string, unknown>}
 */
export function toJSON(ledger) {
  /** @type {Record<string, LedgerReview>} */
  const records = {};
  for (const key of [...ledger.records.keys()].sort()) {
    const record = ledger.records.get(key);
    if (record !== undefined) records[key] = record;
  }

  return {
    ledger_version: ledger.ledger_version,
    identity_algo_version: ledger.identity_algo_version,
    client_slug: ledger.client_slug,
    listing_key: ledger.listing_key,
    created_at: ledger.created_at,
    updated_at: ledger.updated_at,
    last_full_harvest_at: ledger.last_full_harvest_at,
    records,
  };
}

/**
 * Rebuilds a ledger from its JSON shape.
 *
 * @param {Record<string, any>} json
 * @returns {Ledger}
 */
export function fromJSON(json) {
  const records = new Map();
  for (const [key, record] of Object.entries(json.records ?? {})) {
    records.set(key, Object.freeze(record));
  }

  return Object.freeze({
    ledger_version: json.ledger_version,
    identity_algo_version: json.identity_algo_version,
    client_slug: json.client_slug,
    listing_key: json.listing_key,
    records,
    created_at: json.created_at,
    updated_at: json.updated_at,
    last_full_harvest_at: json.last_full_harvest_at ?? null,
  });
}
