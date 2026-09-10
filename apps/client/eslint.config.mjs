import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

// Vue's essential rules catch correctness issues without imposing a formatting rewrite.
// Keep vue-eslint-parser outside and TypeScript inside so templates are actually linted.
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: { uni: 'readonly', wx: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } },
    rules: {
      // uni-app route files conventionally use index.vue; reusable components still require names.
      'vue/multi-word-component-names': ['error', { ignores: ['index'] }],
    },
  },
);
