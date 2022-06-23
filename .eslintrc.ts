module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  env: {
    'es6': true,
  },
  parserOptions: {
    'project': './tsconfig.json',
    ecmaVersion: 'latest',
    ecmaFeatures: {
      'tsx': true,
      'jsx': true,
      'modules': true,
      'sourceType': 'modules',
    },
  },
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended'],
  rules: {
    'indent': ['error', 2, { 'SwitchCase': 1 }],
    'quotes': ['error', 'single'],
    'semi': ['error', 'never'],
    'prefer-const': 'error',
    'comma-dangle': ['error', 'always-multiline'],
    'no-trailing-spaces': 'error',
    'no-unexpected-multiline': 'error',
    'object-shorthand': ['error', 'always'],
    // 'import-order': 'off',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    // '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/strict-boolean-expressions': ['error', { allowNullableObject: true, allowNullableString: true, allowNullableBoolean: true, allowAny: true }],
    'no-useless-rename': 'error',
  },
  'overrides': [
    {
      'files': ['*.js', '*.jsx'],
      'rules': {
        '@typescript-eslint/explicit-function-return-type': 'off',
      }
    }
  ],
}
