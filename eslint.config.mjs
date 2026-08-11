// ESLint flat config (ESLint v9 + typescript-eslint v8 + react-hooks).
// Engineering floor per Harness §2.4: TypeScript strict, NO `any`.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // public/** is static assets served as-is (incl. the service worker, which runs in the SW global
    // scope, not the app's module scope) — not type-checked app source, so it's not linted here.
    ignores: ["node_modules/**", "dist/**", "coverage/**", ".next/**", "public/**", "**/*.html", "next-env.d.ts"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No `any` — prefer `unknown` + narrowing (Harness §2.4).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // React hooks correctness floor.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Tests: keep the no-`any` floor, but allow test ergonomics (non-null fixture access, JSON.parse
    // round-trips the type-checker sees as `any`). Strict floors that matter stay enforced in src/.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // Node scripts (linters, CI reporters) + config files: plain ESM, no type-aware rules.
    // Keep `.github/scripts/**` here too — CI scripts are still repo source and must pass the gate.
    files: ["scripts/**/*.mjs", ".github/scripts/**/*.mjs", "*.mjs", "*.config.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
      },
    },
  },
);
