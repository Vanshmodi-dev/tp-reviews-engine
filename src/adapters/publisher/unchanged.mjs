/**
 * Whether an artifact's published content is already on disk (FR-065, IR-06).
 *
 * ## The defect this replaces
 *
 * Both publishers compared raw bytes. Raw bytes include `generated_at`, which
 * changes on every run by construction — so the comparison was never equal, the
 * skip never happened, and every scheduled run rewrote every artifact for every
 * client whether or not a single review had changed.
 *
 * That is IR-06, and it is what `MET-commit-churn` exists to detect. MS-7's
 * exit criterion — "a second identical run produces zero commits" — did not
 * hold once the pipeline was actually wired end to end. Left alone, the `data`
 * branch grows with traffic rather than with change, until cloning it is the
 * slowest part of every job.
 *
 * ## Why the comparison is a hash and not the bytes
 *
 * `sealArtifact` already computes `sha256Hex(hashableBytes(payload))` — the
 * payload with `generated_at` removed — and seals it into
 * `provenance.content_hash`. The published file therefore carries its own
 * content hash, and deciding whether anything changed is reading it back and
 * comparing.
 *
 * This is the whole reason that field is sealed in. Nothing was reading it.
 *
 * ## Every uncertainty resolves towards writing
 *
 * Absent, unparseable, or written by an engine that did not seal a hash: all
 * three return `false`, meaning "write it". A wrong write costs one redundant
 * commit. A wrong SKIP means a client's site silently keeps stale reviews and
 * nothing reports it — so the two errors are not symmetric and the default is
 * not "assume unchanged".
 *
 * @module adapters/publisher/unchanged
 */

/**
 * @param {string | null} currentBytes  What is on disk, or null if nothing is.
 * @param {{ bytes: string, contentHash?: string }} artifact
 * @returns {boolean}
 */
export function artifactUnchanged(currentBytes, artifact) {
  if (currentBytes === null) return false;

  // Identical bytes are trivially unchanged. Cheap, and it is the right answer
  // for any artifact that carries no provenance block at all.
  if (currentBytes === artifact.bytes) return true;

  const published = publishedHash(currentBytes);

  if (published === null || typeof artifact.contentHash !== 'string') {
    // An older file with no sealed hash, or an artifact we cannot vouch for.
    // Fall back to the byte comparison already made above, which said no.
    return false;
  }

  return published === artifact.contentHash;
}

/**
 * The content hash a published payload sealed into itself.
 *
 * @param {string} bytes
 * @returns {string | null}
 */
function publishedHash(bytes) {
  try {
    const hash = JSON.parse(bytes)?.provenance?.content_hash;

    return typeof hash === 'string' && hash !== '' ? hash : null;
  } catch {
    // Unparseable is not "unchanged". A truncated write leaves valid-looking
    // bytes surprisingly often, and treating that as current would leave the
    // truncation published forever.
    return null;
  }
}
