'use strict';

// Flat config (ESLint 9+/10). Mirrors the previous .eslintrc.js: jsdoc
// recommended + Prettier as an ESLint rule, with the same rule relaxations.
const jsdoc = require('eslint-plugin-jsdoc');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
    {
        ignores: ['node_modules/**', 'coverage/**', 'sandbox/**'],
    },
    jsdoc.configs['flat/recommended'],
    prettierRecommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'commonjs',
        },
        rules: {
            'prettier/prettier': 'error',
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
];
