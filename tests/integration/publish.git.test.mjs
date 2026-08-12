import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_PUSH_ATTEMPTS, commitMessage, createGit } from '../../src/infra/git.mjs';
import { createGitDataPublisher, publishInOrder } from '../../src/adapters/publisher/git-data.mjs';

const run = promisify(execFile);

/**
 * DEL-148 / DEL-149 — publication against a real temporary repository.
 *
 * Real git, not a mock. The behaviours under test — "a commit does not happen
 * when nothing is staged", "a rejected push is followed by a rebase" — are
 * properties of git itself, and a mock would only prove that the mock agrees
 * with what we believed git does.
 */

/** @type {string} */
let sandbox;
/** @type {string} */
let origin;
/** @type {string} */
let work;

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(cwd, args) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });

  return String(stdout).trim();
}

/**
 * @param {string} cwd
 * @returns {Promise<number>}
 */
async function commitCount(cwd) {
  return Number(await git(cwd, ['rev-list', '--count', 'HEAD']));
}

/**
 * @param {string} slug
 * @param {string} body
 * @returns {any}
 */
const target = (slug, body) => ({
  clientSlug: slug,
  listingKey: 'main',
  artifacts: { reviews: { bytes: body } },
});

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'tpre-publish-'));
  origin = join(sandbox, 'origin.git');
  work = join(sandbox, 'work');

  await run('git', ['init', '--bare', '--initial-branch=data', origin]);
  await run('git', ['clone', origin, work]);

  /** @type {Record<string, string>} */
  const settings = {
    'user.email': 'engine@tradyperch.test',
    'user.name': 'TP Engine',
    // Signing would prompt, and a prompt in a test is a hang.
    'commit.gpgsign': 'false',
  };

  for (const [key, value] of Object.entries(settings)) {
    await git(work, ['config', key, value]);
  }

  // A bare repository has no commits, so `rev-list` and `rebase` have nothing
  // to work against until there is one.
  await git(work, ['commit', '--allow-empty', '-m', 'chore(data): initialise']);
  await git(work, ['push', 'origin', 'HEAD:data']);
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('PUB-02 / IR-06 — hash-gating: identical bytes produce no write', () => {
  it('writes and commits on the first publish', async () => {
    const publisher = createGitDataPublisher({ root: work });
    const staged = await publisher.stage(target('acme', '{"reviews":[1]}'));

    expect(staged.written).toHaveLength(1);
    expect(staged.skipped).toHaveLength(0);

    const before = await commitCount(work);
    const result = await publisher.commit({ runId: 'run-1', listings: 1 });

    expect(result.committed).toBe(true);
    expect(await commitCount(work)).toBe(before + 1);
  });

  it('SKIPS the write and makes NO commit on an identical second run', async () => {
    // The exit criterion for this phase, and the whole economy of the system.
    // Most harvests change nothing; writing anyway costs a commit per shard per
    // run — roughly fifty times the volume for zero information, and it makes
    // `git log` on the data branch useless for answering "when did this
    // actually change".
    const publisher = createGitDataPublisher({ root: work });
    const before = await commitCount(work);
    const staged = await publisher.stage(target('acme', '{"reviews":[1]}'));

    expect(staged.written).toEqual([]);
    expect(staged.skipped).toHaveLength(1);

    const result = await publisher.commit({ runId: 'run-2', listings: 1 });

    expect(result.committed).toBe(false);
    expect(result.sha).toBeNull();
    expect(await commitCount(work)).toBe(before);
  });

  it('writes again when a single byte differs', async () => {
    // Gating must be exact. A comparison that normalised whitespace, or
    // compared a re-derived hash rather than the bytes, would silently stop
    // publishing real changes.
    const publisher = createGitDataPublisher({ root: work });
    const staged = await publisher.stage(target('acme', '{"reviews":[2]}'));

    expect(staged.written).toHaveLength(1);

    await publisher.commit({ runId: 'run-3', listings: 1 });

    expect(await readFile(join(work, 'acme', 'main', 'reviews.json'), 'utf8')).toBe(
      '{"reviews":[2]}',
    );
  });
});

describe('PUB-03 / CON-13 — one commit per shard, never one per target', () => {
  it('stages three targets and commits once', async () => {
    const publisher = createGitDataPublisher({ root: work });
    const before = await commitCount(work);

    for (const slug of ['alpha', 'beta', 'gamma']) {
      await publisher.stage(target(slug, `{"client":"${slug}"}`));
    }

    expect(publisher.pending()).toHaveLength(3);

    const result = await publisher.commit({ runId: 'run-4', listings: 3 });

    expect(result.committed).toBe(true);
    expect(result.files).toBe(3);
    // Thirty targets that each committed would be thirty commits describing
    // one run.
    expect(await commitCount(work)).toBe(before + 1);
  });

  it('writes a conventional, machine-readable commit subject', async () => {
    // The data branch's history is read by humans during incidents: the subject
    // has to answer "what changed" without opening the diff.
    const subject = await git(work, ['log', '-1', '--pretty=%s']);

    expect(subject).toBe('chore(data): publish 3 listings');
    expect(await git(work, ['log', '-1', '--pretty=%b'])).toContain('Run: run-4');
  });

  it('singularises one listing', () => {
    expect(commitMessage({ branch: 'data', listings: 1, runId: 'r' })).toContain(
      'publish 1 listing',
    );
    expect(commitMessage({ branch: 'state', listings: 2, runId: 'r' })).toContain(
      'publish 2 listings',
    );
  });
});

describe('PUB-04 / TR-PUB-003 — push rebases and retries, never forces', () => {
  it('pushes cleanly when the remote has not moved', async () => {
    const publisher = createGitDataPublisher({ root: work });
    const result = await publisher.push();

    expect(result.pushed).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('rebases onto a remote that moved, then succeeds', async () => {
    // Somebody else's commit is on the branch. Their work is not ours to
    // discard, so the answer is fetch, rebase, and try again.
    const other = join(sandbox, 'other');

    await run('git', ['clone', origin, other]);
    await git(other, ['config', 'user.email', 'other@tradyperch.test']);
    await git(other, ['config', 'user.name', 'Other Shard']);
    await git(other, ['commit', '--allow-empty', '-m', 'chore(data): another shard']);
    await git(other, ['push', 'origin', 'HEAD:data']);

    const publisher = createGitDataPublisher({ root: work });

    await publisher.stage(target('delta', '{"client":"delta"}'));
    await publisher.commit({ runId: 'run-5', listings: 1 });

    const result = await publisher.push();

    expect(result.pushed).toBe(true);
    expect(result.attempts).toBeGreaterThan(1);

    // Both commits survive. That is the difference between rebasing and
    // forcing, stated as an assertion.
    const log = await git(work, ['log', '--pretty=%s', '-5']);

    expect(log).toContain('another shard');
    expect(log).toContain('publish 1 listing');
  });

  it('gives up after three attempts with ERR-PUBLISH-CONFLICT', async () => {
    // A conflict that survives three rebases is a fact about the world that a
    // human needs to see, not a fact to overwrite.
    //
    // Driven through a fake `exec` rather than a fake git client, so the retry
    // COUNT is the real one from infra/git.mjs. A fake push would have been
    // asserting the fake.
    /** @type {string[][]} */
    const attempted = [];
    const client = createGit({
      cwd: work,
      exec: async (/** @type {string} */ _file, /** @type {string[]} */ args) => {
        attempted.push(args);

        if (args[0] !== 'push') return { stdout: '' };

        throw Object.assign(new Error('rejected'), { stderr: 'non-fast-forward' });
      },
    });
    const result = await client.push({ remote: 'origin', branch: 'data' });

    expect(result.pushed).toBe(false);
    expect(result.code).toBe('ERR-PUBLISH-CONFLICT');
    expect(result.attempts).toBe(MAX_PUSH_ATTEMPTS);
    expect(attempted.filter((args) => args[0] === 'push')).toHaveLength(MAX_PUSH_ATTEMPTS);
    // It rebased between attempts rather than escalating.
    expect(attempted.filter((args) => args[0] === 'rebase')).toHaveLength(MAX_PUSH_ATTEMPTS - 1);
  });

  it('refuses a force flag that arrives through a variable', async () => {
    // The literal is split so the LINT rule cannot see it. That is the whole
    // point: this asserts the runtime guard, which is the mechanism that
    // catches a flag lint never could.
    const client = createGit({ cwd: work });
    const smuggled = ['--for', 'ce'].join('');

    await expect(client.git(['push', 'origin', smuggled])).rejects.toThrow(/TR-PUB-003/u);
  });
});

describe('PUB-01 / EDR-025 — payload first, then state', () => {
  /**
   * @param {string[]} order
   * @param {string} name
   * @param {boolean} pushed
   * @returns {any}
   */
  const recorder = (order, name, pushed = true) => ({
    commit: async () => {
      order.push(`${name}:commit`);

      return { committed: true, sha: `${name}-sha`, files: 1 };
    },
    push: async () => {
      order.push(`${name}:push`);

      return { pushed, attempts: 1 };
    },
  });

  it('commits and pushes the payload before touching state', async () => {
    /** @type {string[]} */
    const order = [];

    await publishInOrder({
      payload: recorder(order, 'payload'),
      state: recorder(order, 'state'),
      runId: 'r',
      listings: 1,
    });

    expect(order).toEqual(['payload:commit', 'payload:push', 'state:commit', 'state:push']);
  });

  it('does NOT write state when the payload failed to push', async () => {
    // State committed against a payload that never landed is exactly the
    // inversion EDR-025 forbids: state would claim reviews no published payload
    // contains, and the next run would see nothing to change. Silently
    // permanent, rather than self-healing.
    /** @type {string[]} */
    const order = [];
    const result = await publishInOrder({
      payload: recorder(order, 'payload', false),
      state: recorder(order, 'state'),
      runId: 'r',
      listings: 1,
    });

    expect(order).toEqual(['payload:commit', 'payload:push']);
    expect(result.state).toBeNull();
  });

  it('is self-healing when a crash lands between the two writes', async () => {
    // Payload ahead of state: the next run re-reconciles, produces identical
    // bytes, hash-gates them, and does nothing. Proven here by publishing the
    // same bytes twice and asserting the second is a no-op.
    const publisher = createGitDataPublisher({ root: work });

    await publisher.stage(target('epsilon', '{"client":"epsilon"}'));
    await publisher.commit({ runId: 'crash-run', listings: 1 });

    const after = createGitDataPublisher({ root: work });
    const replayed = await after.stage(target('epsilon', '{"client":"epsilon"}'));
    const recommit = await after.commit({ runId: 'recovery-run', listings: 1 });

    expect(replayed.written).toEqual([]);
    expect(recommit.committed).toBe(false);
  });
});
