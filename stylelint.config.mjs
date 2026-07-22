export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/tmp/**',
    '**/.tmp/**',
    '**/output/**',
    'public/**',
  ],
  rules: {
    'alpha-value-notation': null,
    'at-rule-empty-line-before': null,
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['custom-variant', 'source', 'theme'],
      },
    ],
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,
    'import-notation': null,
    'length-zero-no-unit': true,
    'no-descending-specificity': null,
    'no-duplicate-selectors': null,
    'property-no-vendor-prefix': null,
    'selector-class-pattern': [
      '^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|text-\\[\\d+px\\])$',
      {
        message: 'Expected class selectors to use Google-style lowercase hyphenated names.',
        resolveNestedSelectors: true,
      },
    ],
    'selector-attribute-quotes': null,
    'selector-id-pattern': [
      '^(?:root|[a-z][a-z0-9]*-[a-z0-9-]*)$',
      {
        message:
          'Expected id selectors to use Google-style hyphenated names, except the React root mount.',
      },
    ],
  },
};
