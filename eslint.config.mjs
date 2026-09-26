import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "node_modules/**", ".vscode-test/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  },
  {
    files: ["scripts/**/*.js", "test/fixtures/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", process: "readonly", __dirname: "readonly", __filename: "readonly", module: "writable", console: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  }
);
