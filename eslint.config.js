// @forge-trace {"component_id":"ci-eslint-config","problems":["P-CI-001"],"heritage":["C-01","C-09","NFR-10"],"decisions":["DEC-30","DEC-42"],"bp_ids":["BP-9"],"ac_ids":["AC-CI-001"]}
//
// ESLint 9 flat config — migrated from legacy .eslintrc.json.
// C-01 (closed dependency list): @typescript-eslint v8, eslint-plugin-import v2.
//   NOTE: eslint-import-resolver-typescript is NOT in the closed dependency list (C-01),
//   so import/no-unresolved is disabled — resolution is enforced by tsc --noEmit (build step)
//   and the C-09 dependency-direction guard in scripts/ci-guards.ts.
// C-09 (dependency direction): import/order + import/no-cycle enforce cli -> kernel -> lib.
// NFR-10 (traceability): this file carries an @forge-trace record validated by CI guards.
// DEC-30: CI is the enforcement surface for design constraints.
// DEC-42: trust labels apply to data, not tooling config; this config is trusted tooling.

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  // --- Global ignores (was ignorePatterns) ---
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'eslint.config.js'],
  },

  // --- Base: eslint:recommended ---
  js.configs.recommended,

  // --- TypeScript project files (src + tests + scripts) ---
  // A dedicated tsconfig (tsconfig.eslint.json) includes tests/scripts so the
  // type-checked rules can parse files outside the build's rootDir.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.cts', '.mts', '.tsx'],
      },
      'import/resolver': {
        node: {
          extensions: ['.ts', '.cts', '.mts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
        },
      },
    },
    rules: {
      // recommended (was plugin:@typescript-eslint/recommended)
      ...tseslint.configs['flat/recommended'].at(-1).rules,
      // recommended-requiring-type-checking (type-checked)
      ...tseslint.configs['flat/recommended-type-checked'].at(-1).rules,
      // import/recommended + import/typescript
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,

      // --- Disable rules that conflict with TS or lack a TS resolver (C-01) ---
      // Base no-unused-vars is superseded by @typescript-eslint/no-unused-vars.
      'no-unused-vars': 'off',
      // No eslint-import-resolver-typescript in closed list (C-01); tsc + C-09 guard cover this.
      'import/no-unresolved': 'off',
      // import/default and import/named fire false positives without the TS resolver.
      'import/default': 'off',
      'import/named': 'off',
      // import/namespace false-positives without TS resolver.
      'import/namespace': 'off',

      // --- Explicit rules (from legacy .eslintrc.json rules block) ---
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          alphabetize: { order: 'asc' },
          'newlines-between': 'always',
        },
      ],
      'import/no-cycle': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // --- Test/script files: relax no-console + allow explicit any in test fixtures ---
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
