// Static analysis (v6, conception/v6.md §3.1): only what is a real bug is an error — an undefined
// variable or component, a duplicate key, unreachable code. `npm run lint`; blocking in the CI.
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const BUGS = {
  'no-undef': 'error', 'no-dupe-keys': 'error', 'no-duplicate-case': 'error', 'no-dupe-else-if': 'error', 'no-unreachable': 'error',
  'no-const-assign': 'error', 'no-self-assign': 'error', 'no-func-assign': 'error', 'no-import-assign': 'error', 'no-unsafe-finally': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
};

export default [
  { ignores: ['**/node_modules/**', 'backups/**', 'data/**', 'logs/**', 'uploads/**', 'dashboard/dist/**', 'docs/.vitepress/cache/**', 'docs/.vitepress/dist/**', 'coverage/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['**/*.js'],
    ignores: ['dashboard/**', 'docs/**'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: BUGS,
  },
  {
    files: ['**/*.mjs'],
    ignores: ['dashboard/src/**'],
    // Playwright scripts run some functions in the page (page.evaluate): browser globals too
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: BUGS,
  },
  {
    files: ['dashboard/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser } },
    rules: { ...BUGS, 'react/jsx-no-undef': 'error', 'react/jsx-uses-vars': 'error', 'react/jsx-uses-react': 'error', 'react/jsx-key': 'error', 'react-hooks/rules-of-hooks': 'error' },
  },
];
