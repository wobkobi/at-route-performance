// ESM flat config for Next.js + TS + JSDoc + Prettier

import { FlatCompat } from "@eslint/eslintrc"
import js from "@eslint/js"
import typescriptEslint from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import jsdoc from "eslint-plugin-jsdoc"
import prettier from "eslint-plugin-prettier"
import globals from "globals"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  // ignore
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "dist/**",
      "coverage/**",
      "build/**",
      "next.config.mjs",
      "postcss.config.js",
      "eslint.config.js",
    ],
  },

  // JSDoc preset (errors)
  jsdoc.configs["flat/recommended-typescript-error"],

  // Next + TS + Prettier presets via compat
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@next/next/recommended",
    "plugin:@next/next/core-web-vitals",
    "prettier"
  ),

  // Project rules and language settings
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
      jsdoc,
    },
    settings: {
      "import/resolver": { node: { extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"] } },
      jsdoc: { mode: "typescript" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "prettier/prettier": ["error", { endOfLine: "crlf" }],
      "linebreak-style": ["error", "windows"],
      "@typescript-eslint/consistent-type-definitions": "error",

      // JSDoc
      "jsdoc/require-jsdoc": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",

      // Types
      "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],
    },
  },
]
