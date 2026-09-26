import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "dist-demo/",
      "site-dist/",
      "node_modules/",
      "coverage/",
      "src-tauri/",
      "scripts/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Landing-page script: plain browser JS, no bundler.
    files: ["website/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        IntersectionObserver: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Flagged across ten pre-existing "reset state when the dialog opens /
      // tab changes" effects. The pattern is intentional and safe today;
      // refactoring those flows is roadmap work, not lint cleanup — keep the
      // debt visible without blocking CI.
      "react-hooks/set-state-in-effect": "warn",
      // Unused args/vars prefixed with _ are intentional (IPC contract params,
      // keep-alives). Everything else must be removed.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
