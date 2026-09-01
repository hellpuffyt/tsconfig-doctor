import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Two projects on purpose: src type-checks under tsconfig.json,
        // the test suite under tsconfig.test.json (which alone sets
        // skipLibCheck — see the comment in that file).
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    // Tests assert over parsed JSON and reach into structures the compiler
    // cannot see through; the strictest unsafe-* rules would force casts
    // that add noise without adding safety there. Source files keep the
    // full rule set.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },
  {
    // Plain JavaScript outside the TypeScript projects: this config file
    // itself. Type-aware rules cannot run on files the TypeScript program
    // does not contain.
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
