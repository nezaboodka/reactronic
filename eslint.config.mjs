import typescriptEslint from "@typescript-eslint/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "**/node_modules",
    "**/build",
    "**/eslint.config.mjs",
    "**/ava.config.*s",
  ]),
  typescriptEslint.configs["flat/recommended"],
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      parserOptions: {
        project: "./tsconfig.json",
        ecmaFeatures: {
          tsx: true,
          jsx: true,
          modules: true,
          sourceType: "modules",
        },
      },
    },
    rules: {
      indent: ["error", 2, {
        SwitchCase: 1,
      }],
      quotes: ["error", "double"],
      semi: ["error", "never"],
      "prefer-const": "error",
      "comma-dangle": ["error", "always-multiline"],
      "no-trailing-spaces": "error",
      "no-unexpected-multiline": "error",
      "object-shorthand": ["error", "always"],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/explicit-function-return-type": ["error", {
        allowExpressions: true,
      }],
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/strict-boolean-expressions": ["error", {
        allowNullableObject: true,
        allowNullableString: true,
        allowNullableBoolean: true,
        allowAny: true,
      }],
      "no-useless-rename": "error",
    },
  },
  {
    files: [
      "**/*.js",
      "**/*.jsx",
    ],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
);
