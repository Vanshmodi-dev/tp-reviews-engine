/**
 * A comparable serialisation of a real `Ledger`.
 *
 * Property laws compare ledgers, and a `Ledger` holds a `Map`, which compares by
 * identity. Sorting by key and serialising is what makes "identical ledger" a
 * checkable claim.
 *
 * ## Total, not an allowlist
 *
 * Every field of every record is included, key-sorted. An allowlist would decide
 * in advance which fields a wrong implementation is allowed to be wrong about,
 * and anything outside it becomes invisible to every law that compares
 * snapshots. That is not hypothetical — the earlier six-field allowlist in
 * `naive-reconcile.mjs` would have let PT-01 pass against a reconciler that
 * double-counted, because the counter it incremented was not on the list.
 *
 * @module tests/helpers/ledger-snapshot
 */

/**
 * @param {Record<string, any>} value
 * @returns {any}
 */
function sortedDeep(value) {
  if (Array.isArray(value)) return value.map((entry) => sortedDeep(entry));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedDeep(value[key])]),
  );
}

/**
 * Every record in the ledger, in identity order, with every field.
 *
 * `updated_at` is included: it is part of the ledger's observable state, and a
 * reconciler that advanced it on a run that changed nothing would produce a
 * different file on disk for identical inputs, defeating hash-gating.
 *
 * @param {any} ledger
 * @returns {string}
 */
export function ledgerSnapshot(ledger) {
  const records = [...ledger.records.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, record]) => [key, sortedDeep(record)]);

  return JSON.stringify({
    ledger_version: ledger.ledger_version,
    identity_algo_version: ledger.identity_algo_version,
    client_slug: ledger.client_slug,
    listing_key: ledger.listing_key,
    created_at: ledger.created_at,
    updated_at: ledger.updated_at,
    last_full_harvest_at: ledger.last_full_harvest_at,
    records,
  });
}

/**
 * The states of every record, keyed by identity — for laws that are about state
 * transitions rather than whole-ledger equality.
 *
 * @param {any} ledger
 * @returns {Map<string, string>}
 */
export function statesOf(ledger) {
  return new Map([...ledger.records.entries()].map(([id, record]) => [id, record.state]));
}
