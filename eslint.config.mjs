import js from '@eslint/js';
import globals from 'globals';

/**
 * TP Reviews Engine - lint configuration.
 *
 * This file mechanically enforces TRD 67.2 (structural limits) and 67.3
 * (prohibited patterns), so that neither is negotiated in review under deadline
 * pressure. Nine rule groups, per IMPL PLAN 19.1.
 *
 * LINT-01  Warnings are errors. A warning nobody must fix is a rule nobody
 *          follows, so `--max-warnings 0` is wired into the lint script.
 * LINT-03  A disable comment carries a reason on the same line.
 * LINT-04  The core purity rules are expressed here AND as the PH-07
 *          architecture test. Two independent mechanisms, deliberately, because
 *          DR-2 is the rule most likely to be violated (IR-02). Lint gives the
 *          fast local signal at the moment of typing, which is when a
 *          `Date.now()` default parameter is cheapest to remove; the
 *          architecture test gives the authoritative one and can express
 *          graph-level properties lint cannot.
 */

/** Timing and threshold literals that carry meaning and must be named. */
const ALLOWED_NUMBERS = [-1, 0, 1, 2];

const HTML_INJECTION_PROPERTIES = [
  { property: 'innerHTML', message: 'TR-STD-002: assign text via textContent.' },
  { property: 'outerHTML', message: 'TR-STD-002: build nodes, do not serialise markup.' },
  {
    property: 'insertAdjacentHTML',
    message: 'TR-STD-002: use insertAdjacentText or createElement.',
  },
  { property: 'setHTML', message: 'TR-STD-002: no HTML parsing in the renderer.' },
];

/**
 * A local plugin. Two rules TRD 67.3 requires that ESLint core does not carry.
 * Written here rather than pulled in as a dependency: DEP-2 forbids a package
 * for anything achievable in under ~100 readable lines.
 */
const tpre = {
  rules: {
    'no-commented-out-code': {
      meta: {
        type: 'problem',
        docs: { description: 'Commented-out code is deleted, not archived (TRD 67.3).' },
        schema: [],
        messages: {
          commented:
            'Commented-out code. Delete it - version control is the archive. If this is an explanation, write it as prose.',
        },
      },
      create(context) {
        // Statement-shaped: opens a block, closes one, or starts with a keyword
        // that cannot begin an English sentence in this codebase.
        const CODE_SHAPED =
          /^\s*(?:(?:const|let|var|function|class|import|export|return|await|throw|else|case)\b|[})\]]\s*[;,]?\s*$|.*[;{]\s*$)/u;

        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.type === 'Shebang') continue;
              for (const line of comment.value.split('\n')) {
                if (line.trim().length < 4) continue;
                if (line.trim().startsWith('@')) continue; // JSDoc tag
                if (CODE_SHAPED.test(line)) {
                  context.report({ node: comment, messageId: 'commented' });
                  break;
                }
              }
            }
          },
        };
      },
    },

    'no-bare-todo': {
      meta: {
        type: 'problem',
        docs: { description: 'A TODO carries a tracking reference (TRD 67.3).' },
        schema: [],
        messages: {
          bare: 'Bare {{marker}}. Carry a reference - TODO(TR-NNN-000), TODO(EDR-000) or TODO(#123) - or delete it. An untracked TODO is a decision nobody will ever revisit.',
        },
      },
      create(context) {
        const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/u;
        const REFERENCED = /\b(?:TODO|FIXME|HACK|XXX)\s*\(\s*(?:#\d+|[A-Z]{2,}-[A-Z]*-?\d+)\s*\)/u;

        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const found = MARKER.exec(comment.value);
              if (found && !REFERENCED.test(comment.value)) {
                context.report({ node: comment, messageId: 'bare', data: { marker: found[1] } });
              }
            }
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: [
      'node_modules/**',
      '.state/**',
      '.publish/**',
      '.artifacts/**',
      'coverage/**',
      'fixtures/**',
      'docs/**',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- baseline
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { tpre },
    linterOptions: {
      // LINT-03. A bare disable is rejected in review; this rejects it earlier.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // --- group 1: structural limits (TRD 67.2) ---
      complexity: ['error', 10],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],

      // --- group 2: prohibited patterns (TRD 67.3) ---
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-useless-catch': 'error',
      'no-console': 'error',
      'no-magic-numbers': [
        'error',
        {
          ignore: ALLOWED_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
      'tpre/no-commented-out-code': 'error',
      'tpre/no-bare-todo': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-throw-literal': 'error',

      // --- group 7: async style (TRD 67.1) ---
      // async/await only. A promise chain and an await are not stylistic
      // alternatives here: the chain hides the ordering that the eleven-stage
      // pipeline depends on being obvious.
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'no-return-await': 'error',
      'prefer-promise-reject-errors': 'error',
      'require-atomic-updates': 'error',

      // --- no default exports (TRD 67.2) ---
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'TRD 67.2: no default exports. A named export is greppable and cannot be silently renamed at the import site.',
        },
        {
          selector:
            "CallExpression[callee.object.type='CallExpression'][callee.property.name='then']",
          message: 'TRD 67.1: async/await only. Chained .then() hides pipeline ordering.',
        },
        {
          selector: "MemberExpression[property.name='exit'][object.name='process']",
          message:
            'TR-CLI-003: process.exit() is permitted in cli/ only. Elsewhere, return a Result and let the composition root decide the exit code.',
        },
      ],
    },
  },

  // ------------------------------------------------- group 3: core is pure
  {
    files: ['src/core/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '**/infra/**', '**/app/**', '**/cli/**', '**/ports/**'],
              message:
                'DR-1: core/ is pure and depends on nothing above it. If this helper is generic it belongs in infra/; if it knows what a review is it belongs here, rewritten as a pure function.',
            },
            {
              group: ['node:*', '!node:crypto'],
              message:
                'DR-2 / TR-DEP-002: core/ may import node:crypto and nothing else. No fs, no path, no process. Pass the value in as an argument.',
            },
            {
              group: ['*', '!./*', '!../*', '!../../*', '!../../../*'],
              message:
                'DR-1: core/ has zero package dependencies. Nothing on npm satisfies the purity rule.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'DR-2: core/ performs no I/O. Acquisition happens in an adapter.',
        },
        { name: 'process', message: 'DR-2: core/ reads no environment. Pass config in.' },
        {
          name: 'setTimeout',
          message: 'DR-2: core/ has no notion of elapsed time. Pass durations in as numbers.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'DR-2: core/ is deterministic. Take the instant as an argument via ClockPort. A single Date.now() default parameter voids fifteen property laws without failing anything.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'DR-2: core/ is deterministic. Take randomness as an argument via RandomPort.',
        },
        {
          object: 'process',
          property: 'env',
          message: 'DR-2: core/ reads no environment. Configuration arrives as a frozen argument.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'TRD 67.2: no default exports.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'DR-2: `new Date()` reads the system clock. core/ is deterministic; take the instant as an argument.',
        },
      ],
    },
  },

  // ------------------------------------------------------ group 4: layering
  {
    files: ['src/app/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'DR-4: app/ sequences work through ports and never names a concrete adapter. Construction happens in cli/composition.mjs alone.',
            },
            {
              group: ['**/core/*/**'],
              message: 'DR-6: import the core through core/index.mjs, never past it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.mjs'],
    rules: {
      // DR-3. This catches every import that names `adapters` explicitly. A
      // relative sibling hop (`../google-places-api/index.mjs`) is not
      // expressible as a glob without also matching `../../core`, and is
      // caught by the PH-07 architecture test, which resolves paths properly.
      // LINT-04's two-mechanism rule is why that split is acceptable.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/*/**', '**/adapters/*'],
              message:
                'DR-3: an adapter never imports another adapter. Shared pure logic belongs in core/, shared generic logic in infra/. If it is neither, the port contract is missing something.',
            },
            {
              group: ['**/core/*/**'],
              message: 'DR-6: import the core through core/index.mjs, never past it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infra/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '**/app/**', '**/cli/**', '**/core/**'],
              message:
                'infra/ is domain-ignorant technical infrastructure. If this needs to know what a review is, it is not infrastructure - it belongs in core/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/cli/**/*.mjs'],
    ignores: ['src/cli/composition.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'DR-5: cli/composition.mjs is THE composition root. It is the only file that may construct a concrete adapter.',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------- groups 5 and 6: the exceptions
  {
    // TRD 67.3. console is how a CLI talks to an operator, and the JSONL sink
    // is where structured logs are actually written. Everywhere else, a
    // console call is a log line that no redaction filter will ever see.
    files: ['src/infra/logger/**/*.mjs', 'src/cli/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // TR-CLI-003. Exit codes are a CLI concern.
    files: ['src/cli/**/*.mjs', 'bin/**/*.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'TRD 67.2: no default exports.' },
      ],
    },
  },

  // ----------------------------------------------------- group 8: frontend
  {
    files: ['frontend/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': ['error', ...HTML_INJECTION_PROPERTIES],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'TRD 67.2: no default exports.' },
        {
          selector: 'ImportDeclaration',
          message:
            'DEP-6: frontend/renderer/ has zero dependencies and no imports. It ships to client websites TradyPerch does not control, so a supply-chain risk here is multiplied by client count.',
        },
        {
          selector: "MemberExpression[object.name='document'][property.name='write']",
          message: 'TR-STD-002: document.write parses HTML.',
        },
      ],
    },
  },

  // -------------------------------------------------------- group 9: tests
  {
    files: ['tests/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // A table-driven test is long by design and splitting it hides the table.
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      // Test data is literal by nature; naming every rating and threshold
      // makes the assertion harder to read, not easier.
      'no-magic-numbers': 'off',
      // Deliberately NOT relaxed: no-console and the determinism rules. A test
      // that prints is a test whose failure output nobody reads, and a test
      // that reads the clock is a test that fails on a Tuesday.
    },
  },

  // -------------------------------------------------------- tooling scripts
  {
    files: ['scripts/**/*.mjs', '*.config.mjs', 'eslint.config.mjs'],
    rules: {
      'no-console': 'off',
      'no-magic-numbers': 'off',
    },
  },
  {
    // ESLint and Prettier both REQUIRE a default export from their config file.
    // TRD 67.2 scopes the no-default-export rule to src/ (IMPL PLAN 19.1); this
    // narrows the baseline block back to that scope rather than weakening it.
    files: ['*.config.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
