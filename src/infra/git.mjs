/**
 * Git plumbing (DEL-146) — the only module that shells out to `git`.
 *
 * ## No force flags. Anywhere. Ever.
 *
 * TR-PUB-003 and PUB-04. `--force` and `--force-with-lease` must not appear in
 * this repository, and the reason is worth stating plainly: the `data` branch
 * is the published state of every client's reviews. A force push against it
 * discards whatever another shard committed in the last few seconds, and the
 * loss is silent — the push succeeds, the run reports success, and a client's
 * reviews quietly revert.
 *
 * The temptation arrives disguised as conflict resolution. It always does. The
 * correct answer to a conflict is `fetch`, `rebase`, and try again — three
 * times, and then fail loudly with `ERR-PUBLISH-CONFLICT`, because a conflict
 * that survives three rebases is a fact about the world that a human needs to
 * see rather than a fact to overwrite.
 *
 * This is enforced three ways: the lint rule, the architecture test, and the
 * absence of any code path that could accept such a flag — arguments are built
 * here from fixed arrays, never interpolated from a caller's string.
 *
 * ## Why arguments are arrays
 *
 * `execFile` with an argument array never invokes a shell, so a branch name or
 * a commit message containing a quote, a semicolon, or a `$(…)` is data rather
 * than syntax. A template-string `exec` would make every one of those an
 * injection point, and commit messages here are machine-generated from client
 * slugs that operators control.
 *
 * @module infra/git
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How many times a push is retried through fetch-and-rebase (TR-PUB-003). */
export const MAX_PUSH_ATTEMPTS = 3;

/**
 * Flags that must never reach `git`.
 *
 * Checked at the call boundary as well as by lint, because the lint rule can
 * only see literals. A flag arriving through a variable would pass lint and
 * fail here — which is the direction that matters, since the argument that
 * reaches `git` is the one that does the damage.
 */
const FORBIDDEN_FLAGS = Object.freeze([
  '--force',
  '-f',
  '--force-with-lease',
  '--force-if-includes',
  '--delete',
  '--prune',
  '--hard',
]);

/**
 * Creates a git client bound to one working directory.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {{ debug?: (event: string, fields?: any) => void }} [options.logger]
 * @param {(file: string, args: string[], options: any) => Promise<any>} [options.exec]
 * @returns {any}
 */
export function createGit({ cwd, logger, exec = run }) {
  /**
   * @param {string[]} args
   * @returns {Promise<string>}
   */
  async function git(args) {
    const forbidden = args.filter((arg) => FORBIDDEN_FLAGS.includes(arg));

    if (forbidden.length > 0) {
      // Never reached in normal operation — every call site below passes a
      // fixed array. It exists so that a future call site built from a
      // variable fails here rather than succeeding quietly.
      throw new Error(
        `refusing to run git with ${forbidden.join(', ')}: destructive flags are forbidden ` +
          `against data and state (TR-PUB-003)`,
      );
    }

    logger?.debug?.('git.run', { args });

    const { stdout } = await exec('git', args, { cwd, encoding: 'utf8' });

    return String(stdout).trim();
  }

  return {
    git,

    /**
     * @returns {Promise<string>}
     */
    head: () => git(['rev-parse', 'HEAD']),

    /**
     * Whether anything is staged.
     *
     * The hash-gating question, asked of git rather than of our own bookkeeping
     * — if every artifact was byte-identical, there is nothing staged and there
     * must be no commit (PUB-02).
     *
     * @returns {Promise<boolean>}
     */
    async hasStagedChanges() {
      const staged = await git(['diff', '--cached', '--name-only']);

      return staged !== '';
    },

    /**
     * @param {ReadonlyArray<string>} paths
     * @returns {Promise<void>}
     */
    async stage(paths) {
      if (paths.length === 0) return;

      // `--` separates paths from options, so a file literally named `--force`
      // is staged rather than interpreted.
      await git(['add', '--', ...paths]);
    },

    /**
     * Commits, or reports that there was nothing to commit.
     *
     * @param {string} message
     * @returns {Promise<{ committed: boolean, sha: string | null }>}
     */
    async commit(message) {
      if (!(await this.hasStagedChanges())) {
        // PUB-02 and IR-06. An empty commit per shard per run is ~50x the
        // commit volume for zero information, and it makes `git log` on the
        // data branch useless for answering "when did this actually change".
        return { committed: false, sha: null };
      }

      await git(['commit', '-m', message]);

      return { committed: true, sha: await this.head() };
    },

    /**
     * Pushes, rebasing onto the remote and retrying on rejection.
     *
     * @param {object} target
     * @param {string} target.remote
     * @param {string} target.branch
     * @returns {Promise<{
     *   pushed: boolean,
     *   attempts: number,
     *   code: string | null,
     *   detail?: string,
     * }>}
     */
    async push({ remote, branch }) {
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
        try {
          await git(['push', remote, `HEAD:${branch}`]);

          return { pushed: true, attempts: attempt, code: null };
        } catch (error) {
          lastError = error;
          logger?.debug?.('git.push_rejected', { attempt, message: describe(error) });

          if (attempt === MAX_PUSH_ATTEMPTS) break;

          // Fetch and rebase — never force. A rejected push means somebody
          // else's commit is on the branch, and their work is not ours to
          // discard.
          await git(['fetch', remote, branch]);
          await git(['rebase', `${remote}/${branch}`]);
        }
      }

      return {
        pushed: false,
        attempts: MAX_PUSH_ATTEMPTS,
        code: 'ERR-PUBLISH-CONFLICT',
        // The message is kept because the next run must be able to reproduce
        // the same bytes, and the operator needs to know why it did not land.
        detail: describe(lastError),
      };
    },
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  if (error === null || error === undefined) return 'unknown';

  const stderr = /** @type {any} */ (error).stderr;

  return String(stderr ?? (error instanceof Error ? error.message : error)).trim();
}

/**
 * The commit message for one shard's publication.
 *
 * Conventional Commits, machine-generated. The shape matters because the data
 * branch's history is read by humans during incidents: "chore(data): publish 3
 * listings" answers "what changed" without opening the diff.
 *
 * @param {object} input
 * @param {string} input.branch     `data` or `state`.
 * @param {number} input.listings
 * @param {string} input.runId
 * @returns {string}
 */
export function commitMessage({ branch, listings, runId }) {
  const noun = listings === 1 ? 'listing' : 'listings';

  return `chore(${branch}): publish ${listings} ${noun}\n\nRun: ${runId}\n`;
}
