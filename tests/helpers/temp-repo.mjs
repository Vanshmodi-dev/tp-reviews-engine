import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A disposable Git repository (TR-TEST-033).
 *
 * Used by the state and publisher integration suites from PH-08 onward, where
 * the thing under test is Git behaviour itself - atomic write-then-rename, hash
 * gating, rebase-retry on push - and a real repository is the only honest
 * fixture for that.
 *
 * Every repository is created with the same identity and the same
 * `.gitattributes` the real one uses, so byte-determinism holds here too. A
 * temp repo that normalises line endings differently from `main` would let a
 * publisher test pass against bytes production would never produce.
 */

/** Committer identity. Fixed, so commit hashes are reproducible given fixed content and dates. */
const IDENTITY = ['-c', 'user.name=TP Reviews Engine Test', '-c', 'user.email=test@invalid'];

/**
 * @typedef {object} TempRepo
 * @property {string} dir                                  Absolute path to the working tree.
 * @property {(args: string[]) => string} git              Runs git in the repo, returns stdout.
 * @property {(path: string, content: string) => void} write  Writes a file, creating parents.
 * @property {(message: string) => string} commit          Stages everything, commits, returns the SHA.
 * @property {(name: string) => void} orphan               Creates and switches to an orphan branch.
 * @property {() => void} destroy                          Removes the repository from disk.
 */

/**
 * Creates a temporary Git repository with one branch, `main`, and no commits.
 *
 * @param {object} [options]
 * @param {boolean} [options.gitattributes] Seed `* text=auto eol=lf` as the
 *   first commit, mirroring INIT-01. Defaults to true.
 * @returns {TempRepo}
 */
export function createTempRepo({ gitattributes = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tpre-repo-'));

  /**
   * @param {string[]} args
   * @returns {string}
   */
  const git = (args) =>
    execFileSync('git', [...IDENTITY, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  /**
   * @param {string} path
   * @param {string} content
   * @returns {void}
   */
  const write = (path, content) => {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  /**
   * @param {string} message
   * @returns {string}
   */
  const commit = (message) => {
    git(['add', '-A']);
    git(['commit', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };

  git(['init', '-b', 'main']);

  if (gitattributes) {
    write('.gitattributes', '* text=auto eol=lf\n');
    commit('build(repo): enforce LF line endings');
  }

  return {
    dir,
    git,
    write,
    commit,

    orphan(name) {
      git(['switch', '--orphan', name]);
    },

    destroy() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
