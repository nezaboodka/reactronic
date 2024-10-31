import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: [
        "**/node_modules",
        "**/build",
        "**/eslint.config.mjs",
        "**/ava.config.*s",
    ],
  },
  ...compat.extends("plugin:@typescript-eslint/recommended"), {
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
      globals: {},
      parser: tsParser,
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
      "@typescript-eslint/member-delimiter-style": "off",
      "@typescript-eslint/explicit-function-return-type": ["error", {
        allowExpressions: true,
      }],
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/ban-types": "off",

      "@typescript-eslint/strict-boolean-expressions": ["error", {
        allowNullableObject: true,
        allowNullableString: true,
        allowNullableBoolean: true,
        allowAny: true,
      }],
      "no-useless-rename": "error",
    },
  }, {
    files: [
      "**/*.js",
      "**/*.jsx"
    ],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  }
];
