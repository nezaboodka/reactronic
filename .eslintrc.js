module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ['plugin:@typescript-eslint/recommended'],
  "rules": {
    "indent": ["error", 2],
    "semi": ["error", "never"],
    "prefer-const": "error",
    "comma-dangle": ["error", "always-multiline"],
    "no-unexpected-multiline": "error",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/no-this-alias": "off",
    "@typescript-eslint/member-delimiter-style": "off",
    "@typescript-eslint/interface-name-prefix": "off",
  }
}
