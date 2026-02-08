import type * as vscode from 'vscode';

/**
 * Represents a parsed Python import statement.
 */
export interface ImportStatement {
    /** The type of import: 'import' or 'from' */
    readonly type: 'import' | 'from';
    /** The module being imported (e.g., 'os.path', '.foo') */
    readonly module: string;
    /** The names being imported (for 'from' imports) */
    readonly names: readonly string[];
    /** Aliases for imported names — maps original name to alias. Only entries with an `as` clause are present. */
    readonly aliases: ReadonlyMap<string, string>;
    /** The relative import level (0 = absolute, 1 = '.', 2 = '..', etc.) */
    readonly level: number;
    /** The line number in the document (0-based) */
    readonly line: number;
    /** The last line number of the import (same as `line` for single-line imports, 0-based) */
    readonly endLine: number;
    /** The original text of the import line */
    readonly text: string;
    /** `true` when the import was found outside the top-level import block and should be moved to the top. */
    readonly misplaced: boolean;
    /** `true` when the import is inside an `if TYPE_CHECKING:` block and should be exempt from runtime validation. */
    readonly typeCheckingOnly: boolean;
}

/**
 * Represents a validation issue found in an import statement.
 */
export interface ImportIssue {
    /** Unique code for this issue type */
    readonly code: ImportIssueCode;
    /** Human-readable message describing the issue */
    readonly message: string;
    /** The severity of the issue */
    readonly severity: vscode.DiagnosticSeverity;
    /** The range in the document where the issue occurs */
    readonly range: vscode.Range;
    /** The original import statement that has the issue */
    readonly import: ImportStatement;
    /** Optional suggested fix */
    readonly suggestedFix?: string;
}

/**
 * Issue codes for import validation rules.
 */
export type ImportIssueCode =
    | 'no-relative-imports'
    | 'no-wildcard-imports'
    | 'no-multiple-imports'
    | 'import-modules-not-symbols'
    | 'non-standard-import-alias'
    | 'unnecessary-from-alias'
    | 'unused-import'
    | 'wrong-import-order'
    | 'wrong-alphabetical-order'
    | 'misplaced-import';

/**
 * Import category for grouping and ordering.
 * Follows Google Python Style Guide section 3.13 extended with Ruff's
 * first-party concept:
 *  1. __future__ imports
 *  2. stdlib
 *  3. third-party
 *  4. first-party — explicitly configured project modules
 *  5. local — relative imports & workspace-detected modules
 */
export type ImportCategory = 'future' | 'stdlib' | 'third-party' | 'first-party' | 'local';

/** Canonical ordering of import categories (Google style + first-party). */
export const CATEGORY_ORDER: readonly ImportCategory[] = ['future', 'stdlib', 'third-party', 'first-party', 'local'] as const;

/**
 * Associates a set of first-party module names with the workspace-relative
 * directory that contains the `pyproject.toml` they were read from.
 *
 * Modules from a scoped entry only apply to documents whose
 * workspace-relative path starts with {@link dirPath}.
 */
export interface ScopedFirstParty {
    /** Workspace-relative directory containing the `pyproject.toml` (e.g. `"packages/api"`). `"."` for the workspace root. */
    readonly dirPath: string;
    /** Module root names declared as first-party in that scope. */
    readonly modules: readonly string[];
}

/**
 * Comprehensive validation result from a single scan of a document's imports.
 *
 * This is the **single source of truth** consumed by diagnostics, fixes,
 * and sorting — eliminating duplicate scans and ensuring consistency
 * between what is reported and what is fixed.
 */
export interface ValidationResult {
    /** All parsed import statements in document order. */
    readonly imports: readonly ImportStatement[];
    /** Category assigned to each import statement. */
    readonly categories: ReadonlyMap<ImportStatement, ImportCategory>;
    /** All detected issues. */
    readonly issues: readonly ImportIssue[];
    /**
     * Original names from each import that are not referenced outside
     * the import block.  Empty arrays for `__future__` and wildcard imports.
     */
    readonly unusedNames: ReadonlyMap<ImportStatement, readonly string[]>;
    /** Line numbers occupied by import statements (used to exclude from usage checks). */
    readonly importLines: ReadonlySet<number>;
}

/**
 * Configuration options for the extension.
 */
export interface ImportantConfig {
    readonly validateOnSave: boolean;
    readonly validateOnType: boolean;
    readonly styleGuide: 'google';
    /** Explicitly configured first-party module names (e.g. `["myproject"]`). */
    readonly knownFirstParty: readonly string[];
    /** Whether to auto-read `known-first-party` from `pyproject.toml`. Defaults to `true`. */
    readonly readFromPyprojectToml: boolean;
    /** Maximum line length for imports. `0` means auto-detect from `pyproject.toml`, falling back to 88. */
    readonly lineLength: number;
}
