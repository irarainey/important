import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	// Global ignores
	{
		ignores: ["dist/**", "**/dist/**", "node_modules/**", "*.config.js", "*.config.ts"]
	},

	// Base JavaScript rules
	js.configs.recommended,

	// TypeScript rules
	...tseslint.configs.recommended,

	// TypeScript source rules
	{
		files: ["src/**/*.ts"],
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/no-explicit-any": "warn",
			"no-console": ["warn", { allow: ["warn", "error"] }]
		}
	},

	// Test file rules — relax `any` and unused-var restrictions.
	// Mock objects are cast to `any` when passed to functions expecting
	// vscode types, and mock stubs intentionally ignore parameters.
	{
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
		}
	}
);
