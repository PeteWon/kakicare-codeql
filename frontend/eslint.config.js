// ESLint flat config — SAST for the frontend (SR-DEV-03).
//
// This config exists ONLY to drive the static security scan that the Proposal
// and Report 1 (SR-DEV-03) commit to: "ESLint security plugins for SAST". It is
// deliberately NOT a general style/lint config — type-checking is handled
// separately by `tsc --noEmit` (the `lint` npm script), and we keep the
// frontend toolchain minimal (see the project's minimal-dependency rule).
//
// eslint, @typescript-eslint/parser and eslint-plugin-security are NOT listed in
// package.json: they are installed on the fly by the CI "SAST" step (the same
// pattern the backend uses for pip-audit / bandit), so package-lock.json stays
// untouched. To run the scan locally:
//
//   cd frontend
//   npm install --no-save eslint @typescript-eslint/parser eslint-plugin-security
//   npx eslint .
//
// eslint-plugin-security flags risky JS/TS patterns (eval, non-literal
// require/fs, unsafe regex, child_process, etc.). Most of its rules target
// Node-side code and will rarely fire in this browser SPA — the point is that
// the gate runs on every change, as committed in D1.

import security from 'eslint-plugin-security';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // Build output, deps and tooling configs are out of scope for the scan.
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  // Pulls in the eslint-plugin-security recommended rule set (applies to all
  // matched files).
  security.configs.recommended,
  {
    // The SPA is TypeScript + JSX, so parse with the TS parser. We only need
    // syntax parsing here (no type-aware rules), so no `project` is set.
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
