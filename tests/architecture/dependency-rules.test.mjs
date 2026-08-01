import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The architecture test — the authoritative half of LINT-04's two mechanisms.
 *
 * ESLint gives the fast local signal at the moment of typing, which is when a
 * `Date.now()` default parameter is cheapest to remove. This gives the
 * authoritative one, and expresses what lint cannot: real specifier
 * classification and graph-level properties like acyclicity.
 *
 * **This file closes a gap that was open for four pull requests.** The `core/`
 * "imports no npm package" rule was removed from `eslint.config.mjs` because a
 * gitignore-style glob cannot distinguish a bare specifier from a relative path
 * or a `node:` builtin — it rejected `node:crypto` and `./result.mjs` on their
 * first real use. That was the right removal and the wrong place to leave it:
 * for four PRs the rule was enforced by nothing. It lives here now, where
 * specifiers are actually resolved.
 *
 * Every rule below is checked twice: against synthetic inputs that prove the
 * detector works, and against the real tree. A small tree makes vacuous passing
 * very easy, and this project has already shipped one gate that was not
 * checking anything.
 */

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SRC = join(ROOT, 'src');

/**
 * @param {string} dir
 * @returns {string[]} Every .mjs file under a directory, as repo-relative paths.
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.mjs')) out.push(relative(ROOT, full).replaceAll('\\', '/'));
  }
  return out;
}

/**
 * Import specifiers in one file: static imports, re-exports, and dynamic
 * `import()`. Re-exports matter — `core/index.mjs` is entirely re-exports, and
 * a rule that only read `import` statements would see it as importing nothing.
 *
 * @param {string} source
 * @returns {string[]}
 */
function specifiersIn(source) {
  const found = [];
  const patterns = [
    /^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gmu,
    /^\s*import\s*['"]([^'"]+)['"]/gmu,
    /^\s*export\s[^'"]*from\s*['"]([^'"]+)['"]/gmu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

/**
 * @param {string} specifier
 * @returns {'relative' | 'builtin' | 'package'}
 */
function classifySpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return 'relative';
  if (specifier.startsWith('node:')) return 'builtin';
  return 'package';
}

/** @returns {Map<string, string[]>} file → its specifiers. */
function buildImportMap() {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const file of walk(SRC)) {
    map.set(file, specifiersIn(readFileSync(join(ROOT, file), 'utf8')));
  }
  return map;
}

const IMPORTS = buildImportMap();
const CORE_FILES = [...IMPORTS.keys()].filter((f) => f.startsWith('src/core/'));

/**
 * Resolves a relative specifier against the importing file.
 *
 * @param {string} from Repo-relative path of the importing file.
 * @param {string} specifier
 * @returns {string} Repo-relative path of the target.
 */
function resolveFrom(from, specifier) {
  return relative(ROOT, resolve(join(ROOT, dirname(from)), specifier)).replaceAll('\\', '/');
}

/**
 * Depth-first cycle detection over a directed graph.
 *
 * @param {Map<string, string[]>} graph
 * @returns {string[][]} Cycles found, each as a path of nodes.
 */
function findCycles(graph) {
  /** @type {string[][]} */
  const cycles = [];
  /** @type {Set<string>} */
  const done = new Set();

  /**
   * @param {string} node
   * @param {string[]} path
   * @param {Set<string>} onPath
   */
  function visit(node, path, onPath) {
    if (onPath.has(node)) {
      cycles.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    if (done.has(node)) return;

    onPath.add(node);
    for (const next of graph.get(node) ?? []) visit(next, [...path, node], onPath);
    onPath.delete(node);
    done.add(node);
  }

  for (const node of graph.keys()) visit(node, [], new Set());
  return cycles;
}

// ---------------------------------------------------------------- detectors

describe('the detectors themselves work', () => {
  it('finds static imports, bare imports, re-exports, and dynamic imports', () => {
    const source = [
      "import { a } from './a.mjs';",
      "import './side-effect.mjs';",
      "export { b } from './b.mjs';",
      "const c = await import('./c.mjs');",
    ].join('\n');

    expect(specifiersIn(source).sort()).toEqual([
      './a.mjs',
      './b.mjs',
      './c.mjs',
      './side-effect.mjs',
    ]);
  });

  it('sees re-exports, which a naive import-only scanner would miss', () => {
    // core/index.mjs is ENTIRELY re-exports. A scanner that only read `import`
    // statements would conclude it imports nothing and every rule about it
    // would pass vacuously.
    expect(specifiersIn("export { x } from './model/review.mjs';")).toEqual(['./model/review.mjs']);
  });

  it('classifies the three specifier kinds that a glob cannot', () => {
    // This distinction is exactly what the removed ESLint pattern got wrong.
    expect(classifySpecifier('./result.mjs')).toBe('relative');
    expect(classifySpecifier('../model/review.mjs')).toBe('relative');
    expect(classifySpecifier('node:crypto')).toBe('builtin');
    expect(classifySpecifier('lodash')).toBe('package');
    expect(classifySpecifier('@scope/pkg')).toBe('package');
  });

  it('detects a cycle', () => {
    const graph = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);

    expect(findCycles(graph).length).toBeGreaterThan(0);
  });

  it('detects a two-node cycle', () => {
    expect(
      findCycles(
        new Map([
          ['a', ['b']],
          ['b', ['a']],
        ]),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('does not report a cycle for a diamond', () => {
    // a -> b -> d, a -> c -> d. Shared dependencies are not cycles, and a
    // detector that says otherwise is unusable in a real codebase.
    const graph = new Map([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['d']],
      ['d', []],
    ]);

    expect(findCycles(graph)).toEqual([]);
  });

  it('scanned a non-trivial number of real files', () => {
    // Guard against every rule below passing because the scan found nothing.
    expect(IMPORTS.size).toBeGreaterThan(5);
    expect(CORE_FILES.length).toBeGreaterThan(5);
  });
});

// ------------------------------------------------------------- DR-1 purity

describe('DR-1: core/ depends on nothing above it', () => {
  it('imports no npm package', () => {
    // THE RULE THIS FILE EXISTS FOR. Removed from ESLint because a glob cannot
    // express it; enforced here, where specifiers are resolved properly.
    const offenders = [];
    for (const file of CORE_FILES) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) === 'package') offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports from no layer above it', () => {
    const forbidden = ['/adapters/', '/infra/', '/app/', '/cli/', '/ports/'];
    const offenders = [];

    for (const file of CORE_FILES) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        const target = `/${resolveFrom(file, specifier)}`;
        if (forbidden.some((layer) => target.includes(layer))) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------- DR-2 determinism

describe('DR-2: core/ is deterministic', () => {
  it('imports no node: builtin other than node:crypto', () => {
    const offenders = [];
    for (const file of CORE_FILES) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) === 'builtin' && specifier !== 'node:crypto') {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reads no clock, no randomness, and no environment', () => {
    // A single Date.now() as a default parameter voids fifteen property laws
    // without failing anything, which is why this is checked and not trusted.
    const banned = [
      { pattern: /\bDate\.now\s*\(/u, name: 'Date.now()' },
      { pattern: /\bnew\s+Date\s*\(\s*\)/u, name: 'new Date()' },
      { pattern: /\bMath\.random\s*\(/u, name: 'Math.random()' },
      { pattern: /\bprocess\.env\b/u, name: 'process.env' },
      { pattern: /\bfetch\s*\(/u, name: 'fetch()' },
      { pattern: /\bsetTimeout\s*\(/u, name: 'setTimeout()' },
      { pattern: /\bsetInterval\s*\(/u, name: 'setInterval()' },
    ];

    const offenders = [];
    for (const file of CORE_FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      // Strip comments: the modules explain these hazards in prose, and a
      // detector that flags its own documentation gets deleted rather than
      // fixed. This project has already made that mistake once, in the CI
      // workflow-hygiene check.
      const code = source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');

      for (const { pattern, name } of banned) {
        if (pattern.test(code)) offenders.push(`${file}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the clock detector actually fires on a violation', () => {
    // T-058's acceptance is "a deliberate Date.now() in core/ fails". Proven
    // against the real pattern rather than by adding a file to the tree.
    const violation = 'export function f(now = Date.now()) { return now; }';

    expect(/\bDate\.now\s*\(/u.test(violation)).toBe(true);
  });
});

// -------------------------------------------------------------- DR-3 … DR-6

describe('DR-3: an adapter never imports another adapter', () => {
  it('holds', () => {
    const adapters = [...IMPORTS.keys()].filter((f) => f.startsWith('src/adapters/'));
    const offenders = [];

    for (const file of adapters) {
      const ownDir = dirname(file);
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        const target = resolveFrom(file, specifier);
        if (target.startsWith('src/adapters/') && !target.startsWith(ownDir)) {
          offenders.push(`${file} -> ${target}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('DR-4: app/ names no concrete adapter', () => {
  it('holds', () => {
    const appFiles = [...IMPORTS.keys()].filter((f) => f.startsWith('src/app/'));
    const offenders = [];

    for (const file of appFiles) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        if (resolveFrom(file, specifier).startsWith('src/adapters/')) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('DR-5: only the composition root constructs adapters', () => {
  it('holds', () => {
    const cliFiles = [...IMPORTS.keys()].filter(
      (f) => f.startsWith('src/cli/') && f !== 'src/cli/composition.mjs',
    );
    const offenders = [];

    for (const file of cliFiles) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        if (resolveFrom(file, specifier).startsWith('src/adapters/')) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('DR-6: nothing outside core/ imports past core/index.mjs', () => {
  it('holds', () => {
    const outside = [...IMPORTS.keys()].filter((f) => !f.startsWith('src/core/'));
    const offenders = [];

    for (const file of outside) {
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        const target = resolveFrom(file, specifier);
        if (target.startsWith('src/core/') && target !== 'src/core/index.mjs') {
          offenders.push(`${file} -> ${target}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('TR-DEP-001: node:child_process is confined to infra/git.mjs', () => {
  it('holds', () => {
    const offenders = [];
    for (const [file, specifiers] of IMPORTS) {
      if (specifiers.includes('node:child_process') && file !== 'src/infra/git.mjs') {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ------------------------------------------------------ TR-TEST-070 acyclicity

describe('TR-TEST-070: the core import graph is acyclic', () => {
  /** @returns {Map<string, string[]>} */
  function coreGraph() {
    /** @type {Map<string, string[]>} */
    const graph = new Map();
    for (const file of CORE_FILES) {
      const edges = [];
      for (const specifier of IMPORTS.get(file) ?? []) {
        if (classifySpecifier(specifier) !== 'relative') continue;
        const target = resolveFrom(file, specifier);
        if (target.startsWith('src/core/')) edges.push(target);
      }
      graph.set(file, edges);
    }
    return graph;
  }

  it('has no cycle', () => {
    expect(findCycles(coreGraph())).toEqual([]);
  });

  it('built a graph with real edges, not an empty one', () => {
    // An empty graph is trivially acyclic. Without this the assertion above
    // would pass whether or not the resolver worked.
    const edgeCount = [...coreGraph().values()].reduce((n, edges) => n + edges.length, 0);

    expect(edgeCount).toBeGreaterThan(3);
  });

  it('would catch a cycle introduced into the real graph', () => {
    // T-059's acceptance is "a deliberate cycle fails". Injected into a copy of
    // the real graph rather than into the tree, so the proof runs on every CI
    // run instead of once on a throwaway branch.
    const graph = coreGraph();
    const [first, second] = CORE_FILES;

    if (first !== undefined && second !== undefined) {
      graph.set(first, [...(graph.get(first) ?? []), second]);
      graph.set(second, [...(graph.get(second) ?? []), first]);

      expect(findCycles(graph).length).toBeGreaterThan(0);
    }
  });
});
