/**
 * Canonical serialisation (EDR-021, PROJ-02).
 *
 * Two modes, and the difference is not stylistic:
 *
 * - **Payloads are minified.** They are read by `response.json()` over a
 *   network. Pretty-printing grows them by roughly a quarter for readability
 *   nobody uses.
 * - **Ledgers are pretty-printed with a trailing newline.** They are read by
 *   humans during incidents, through `git diff`. Minifying one makes its diff a
 *   single unreadable line, which destroys the "Git is the database and the
 *   diff is the audit log" property the whole persistence strategy rests on.
 *
 * Both use **stable key ordering**, and that part is load-bearing for a third
 * reason: content hashing. Key order that follows object insertion order
 * follows harvest order, which is unstable, so two runs over identical data
 * would produce different bytes, the hash would differ, hash-gating would never
 * skip a write, and every client would commit on every cycle (TR-PROJ-012,
 * IR-06).
 *
 * @module core/project/serialise
 */

/**
 * Recursively orders object keys, leaving arrays in their given order.
 *
 * Array order is meaningful — it is the publication order the comparator
 * produced — so sorting one here would silently discard PROJ-01's work.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalise(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalise(entry));
  if (value === null || typeof value !== 'object') return value;

  const source = /** @type {Record<string, unknown>} */ (value);

  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalise(source[key])]),
  );
}

/**
 * Minified payload bytes: stable key order, no spacing, no trailing newline.
 *
 * @param {unknown} payload
 * @returns {string}
 */
export function serialisePayload(payload) {
  return JSON.stringify(canonicalise(payload));
}

/**
 * Pretty-printed ledger bytes: stable key order, two-space indent, trailing
 * newline.
 *
 * The trailing newline is required (TR-PROJ-011) and is not decoration: without
 * it every diff of the file's last line shows as a change, and POSIX tools
 * treat a file without one as malformed.
 *
 * @param {unknown} ledger
 * @returns {string}
 */
export function serialiseLedger(ledger) {
  return `${JSON.stringify(canonicalise(ledger), null, 2)}\n`;
}

/**
 * The exact byte sequence a content hash is computed over.
 *
 * `generated_at` is excluded (EDR-022, PROJ-03). It changes on every run by
 * definition, so including it would make every artifact's hash differ every
 * time and hash-gating would never suppress anything.
 *
 * Two byte sequences therefore exist per artifact — the written bytes and the
 * hashed bytes — and conflating them is the mistake this function exists to
 * prevent. The pair is tested together, because a change to either alone breaks
 * the guarantee.
 *
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
export function hashableBytes(payload) {
  const projection = { ...payload };
  delete projection.generated_at;

  return serialisePayload(projection);
}
