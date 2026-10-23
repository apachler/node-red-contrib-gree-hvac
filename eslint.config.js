'use strict';

// Flat config (ESLint 10): eslint:recommended + jsdoc/recommended + Prettier
// as an ESLint rule (same baseline as gree-hvac-client), plus per-area globals.
const js = require('@eslint/js');
const globals = require('globals');
const jsdoc = require('eslint-plugin-jsdoc');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
    {
        ignores: ['node_modules/**', 'coverage/**', 'sandbox/**', 'pack/**'],
    },
    js.configs.recommended,
    jsdoc.configs['flat/recommended'],
    prettierRecommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'prettier/prettier': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            // `catch (_) {}` is the codebase's "intentionally ignored" idiom.
            'no-unused-vars': ['error', { caughtErrorsIgnorePattern: '^_' }],
            'jsdoc/require-property-description': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/check-property-names': 'off',
            // New in eslint-plugin-jsdoc v63 recommended; the codebase uses
            // `Function` / `any` in JSDoc intentionally, so keep them allowed.
            'jsdoc/reject-function-type': 'off',
            'jsdoc/reject-any-type': 'off',
            'jsdoc/sort-tags': 'error',
        },
    },
    {
        // The sim dashboard's front-end runs in the browser as a classic script.
        files: ['sim/public/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: { ...globals.browser },
        },
    },
    {
        files: ['**/*.mjs'],
        languageOptions: { sourceType: 'module', globals: { ...globals.node } },
    },
];
