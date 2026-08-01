/**
 * TP Reviews Engine - formatting.
 *
 * The purpose is to remove formatting from code review entirely (IMPL PLAN 20)
 * and to keep hand-authored JSON byte-stable, since some of it participates in
 * content hashing.
 *
 * @type {import('prettier').Config}
 */
export default {
  // FMT-02. Reinforces .gitattributes at the tool level, so a file is written
  // with LF before Git ever has to normalise one. Third layer of the same
  // guarantee, after .editorconfig and .gitattributes.
  endOfLine: 'lf',

  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',

  overrides: [
    {
      // Markdown line breaks are semantic. Rewrapping prose turns a one-word
      // edit into a whole-paragraph diff and makes review harder, not easier.
      files: ['*.md'],
      options: { proseWrap: 'preserve' },
    },
    {
      // Hand-authored JSON is pretty-printed with stable key order (TRD 69.5).
      // These files are read by the schema validator and by operators; width
      // that forces objects onto one line hurts both.
      files: [
        'schemas/**/*.json',
        'selectors/**/*.json',
        'clients/**/*.json',
        'profiles/**/*.json',
      ],
      options: { printWidth: 80 },
    },
    {
      // jsconfig.json carries explanatory comments, so it is JSONC.
      files: ['jsconfig.json'],
      options: { parser: 'jsonc' },
    },
  ],
};
