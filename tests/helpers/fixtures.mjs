/**
 * Loading the golden DOM corpus.
 *
 * A fixture is a directory of three files, and the pack it is tested against
 * comes from its own `meta.json` — never from whatever pack is current. That is
 * what makes the corpus a test of *extraction* rather than a test of today's
 * markup, and it is why old pack versions are retained indefinitely.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @type {string} */
export const CORPUS_ROOT = join(HERE, '..', '..', 'fixtures', 'dom', 'google');

/** @type {string} */
const PACK_ROOT = join(HERE, '..', '..', 'selectors', 'google-maps');

const NAMES = [
  'Priya Sharma',
  'Daniel Okoro',
  'Mei-Ling Chen',
  'Sofia Rossi',
  'Ahmed Al-Rashid',
  'Grace Mwangi',
  'Tomás Herrera',
  'Anika Bose',
];

/**
 * @typedef {object} Fixture
 * @property {string} slug
 * @property {string} html
 * @property {any} meta
 * @property {any} pack
 * @property {any} expected
 */

/**
 * Every case slug, in corpus order.
 *
 * @returns {string[]}
 */
export function caseSlugs() {
  return readdirSync(CORPUS_ROOT)
    .filter((entry) => /^\d{3}-/u.test(entry))
    .sort();
}

/**
 * Expands the one-node template used by the scale case.
 *
 * @param {string} shell
 * @param {string} node
 * @param {number} count
 * @returns {string}
 */
function expand(shell, node, count) {
  const nodes = [];

  for (let index = 0; index < count; index += 1) {
    nodes.push(
      node
        .replaceAll('{{i}}', String(index + 1).padStart(4, '0'))
        .replaceAll('{{name}}', /** @type {string} */ (NAMES[index % NAMES.length]))
        .replaceAll('{{rating}}', String((index % 5) + 1))
        .replaceAll('{{weeks}}', String((index % 11) + 1)),
    );
  }

  return shell.replace('<!--REVIEWS-->', nodes.join('\n'));
}

/**
 * @param {string} slug
 * @returns {Fixture}
 */
export function loadFixture(slug) {
  const directory = join(CORPUS_ROOT, slug);
  const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'));
  const shell = readFileSync(join(directory, 'page.html'), 'utf8');
  const expectedPath = join(directory, 'expected.json');

  return {
    slug,
    html:
      typeof meta.repeat === 'number'
        ? expand(shell, readFileSync(join(directory, 'node.html'), 'utf8'), meta.repeat)
        : shell,
    meta,
    pack: JSON.parse(readFileSync(join(PACK_ROOT, `${meta.pack_version}.json`), 'utf8')),
    expected: existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : null,
  };
}
