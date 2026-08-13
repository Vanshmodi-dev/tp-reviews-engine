/**
 * Identity verification by name (TR-APP-020, TR-APP-021).
 *
 * Pure. The resolver drives a browser; this file decides what the browser saw
 * means, and that decision is the one worth testing exhaustively.
 *
 * ## What this is defending against
 *
 * The listing under a given identifier is not stable. Businesses rename,
 * listings get merged by the platform, a chain's branch listing is silently
 * repointed at head office. In every one of those cases the identifier still
 * resolves, the page still loads, reviews still extract, and the payload is
 * quietly full of **someone else's reviews**.
 *
 * Nothing downstream can catch that. The reconciler sees new identity hashes
 * and records them as new reviews; the gate sees a count that went up. The only
 * place it is detectable is here, at the moment of resolution, by comparing the
 * name on the page to the name the operator said to expect.
 *
 * ## Why normalisation is the hard half (TR-APP-021)
 *
 * A threshold on raw strings produces false drift alerts on things that are not
 * drift at all: "Acme Ltd." becoming "Acme Limited", a café losing its accent,
 * an ampersand becoming "and". Each one would abort a harvest and page someone.
 *
 * So the comparison strips what is decoration and keeps what is identity. It is
 * deliberately aggressive in one direction only — it may make two different
 * names look similar, and the threshold plus `ERR-RESOLVE-AMBIGUOUS` handle
 * that; it must never make the SAME business look different, because that is
 * the false alarm that gets the check disabled.
 *
 * @module adapters/acquisition/google-dom/name-match
 */

/** TR-APP-020's default. Overridable per client via `resolution.identity_threshold`. */
export const DEFAULT_IDENTITY_THRESHOLD = 0.82;

/**
 * Legal and structural suffixes that carry no identity.
 *
 * "Acme Ltd" and "Acme Limited" are the same business, and a rebrand between
 * the two is a filing, not a change of premises. Ordered longest-first so
 * "limited" is stripped before "ltd" cannot match it.
 */
const LEGAL_SUFFIXES = Object.freeze([
  'incorporated',
  'corporation',
  'limited',
  'company',
  'gmbh',
  'llc',
  'ltd',
  'inc',
  'plc',
  'llp',
  'bv',
  'nv',
  'sa',
  'ag',
  'co',
]);

/** Words that are punctuation wearing letters. */
const CONNECTORS = Object.freeze({ '&': ' and ', '+': ' and ' });

/**
 * Reduces a business name to its identifying core.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseName(raw) {
  if (typeof raw !== 'string') return '';

  let name = raw;

  for (const [symbol, word] of Object.entries(CONNECTORS)) name = name.split(symbol).join(word);

  const folded = name
    // Diacritics: "Café" and "Cafe" are the same shopfront (TR-APP-021).
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Anything that is not a letter, digit or space becomes a space, so
    // "Acme-Dental" and "Acme Dental" agree.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  const words = folded.split(/\s+/u).filter((word) => word !== '');

  // Suffixes are stripped only from the END. "Ltd Commercial Cleaning" starts
  // with a word that is a suffix elsewhere, and it is part of the name here.
  while (words.length > 1 && LEGAL_SUFFIXES.includes(/** @type {string} */ (words.at(-1)))) {
    words.pop();
  }

  return words.join(' ');
}

/**
 * Similarity of two names, in [0, 1].
 *
 * Token-set based rather than edit-distance based. Edit distance on whole
 * strings punishes word ORDER and length, so "Commerce Insight" against
 * "Commerce Insight Ltd, Manchester" scores badly despite being obviously the
 * same business — and that is the commonest real-world shape, because the
 * platform appends locality and the config does not.
 *
 * The measure is the proportion of the SHORTER name's tokens that appear in the
 * longer one. That makes it tolerant of additions (locality, branch) and strict
 * about the core name, which is the asymmetry this check wants.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function similarity(left, right) {
  const a = normaliseName(left);
  const b = normaliseName(right);

  if (a === '' || b === '') return 0;
  if (a === b) return 1;

  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];

  let shared = 0;

  for (const token of smaller) if (larger.has(token)) shared += 1;

  return shared / smaller.size;
}

/**
 * The identity verdict for one resolved page (TR-APP-020).
 *
 * Runs on EVERY run, not only on re-resolution. Re-verification is a string
 * comparison against a name already on the page; skipping it to save nothing
 * is how a merged listing goes unnoticed for a month.
 *
 * @param {{ observedName: string, expectedName: string, threshold?: number }} input
 * @returns {{ ok: boolean, score: number, code: string | null, detail: string }}
 */
export function verifyIdentity({ observedName, expectedName, threshold }) {
  const limit = typeof threshold === 'number' ? threshold : DEFAULT_IDENTITY_THRESHOLD;

  // An absent expected name is a configuration defect, not a pass. Treating it
  // as "nothing to compare, therefore fine" would disable the check for exactly
  // the client whose config was written carelessly.
  if (typeof expectedName !== 'string' || expectedName.trim() === '') {
    return {
      ok: false,
      score: 0,
      code: 'ERR-IDENTITY-DRIFT',
      detail: 'resolution.expected_name is not set, so identity cannot be verified',
    };
  }

  const score = similarity(observedName, expectedName);

  return score >= limit
    ? { ok: true, score, code: null, detail: `"${observedName}" matches "${expectedName}"` }
    : {
        ok: false,
        score,
        code: 'ERR-IDENTITY-DRIFT',
        detail:
          `the page says "${observedName}" but this client expects "${expectedName}" ` +
          `(similarity ${score.toFixed(2)} < ${limit}). The listing may have been renamed, ` +
          `merged, or repointed — harvesting it would publish another business's reviews.`,
      };
}

/**
 * Picks a search result, or refuses to (TR-APP-022, FR-014).
 *
 * @param {ReadonlyArray<{ name: string, id: string }>} candidates
 * @param {{ expectedName: string, threshold?: number }} input
 * @returns {{ ok: boolean, chosen: any, code: string | null, detail: string }}
 */
export function chooseCandidate(candidates, { expectedName, threshold }) {
  const limit = typeof threshold === 'number' ? threshold : DEFAULT_IDENTITY_THRESHOLD;
  const scored = candidates
    .map((candidate) => ({ candidate, score: similarity(candidate.name, expectedName) }))
    .filter((entry) => entry.score >= limit)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return {
      ok: false,
      chosen: null,
      code: 'ERR-RESOLVE-NOTFOUND',
      detail: `no search candidate matched "${expectedName}" at or above ${limit}`,
    };
  }

  if (scored.length > 1) {
    // FR-014: never guess. Taking the highest score would be a coin flip
    // whenever two branches of the same chain are both above threshold — and
    // the wrong branch produces a completely successful harvest of the wrong
    // premises, which nothing downstream can detect.
    return {
      ok: false,
      chosen: null,
      code: 'ERR-RESOLVE-AMBIGUOUS',
      detail:
        `${scored.length} candidates matched "${expectedName}" at or above ${limit}: ` +
        `${scored.map((entry) => `"${entry.candidate.name}"`).join(', ')}. ` +
        `Set an explicit place_id or cid in the client config rather than relying on search.`,
    };
  }

  return {
    ok: true,
    chosen: /** @type {any} */ (scored[0]).candidate,
    code: null,
    detail: `one candidate matched "${expectedName}"`,
  };
}
