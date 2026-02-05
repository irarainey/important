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
    /** The relative import level (0 = absolute, 1 = '.', 2 = '..', etc.) */
    readonly level: number;
    /** The line number in the document (0-based) */
    readonly line: number;
    /** The original text of the import line */
    readonly text: string;
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
    | 'unused-import'
    | 'wrong-import-order'
    | 'wrong-alphabetical-order';

/**
 * Import category for grouping and ordering.
 */
export type ImportCategory = 'stdlib' | 'third-party' | 'local';

/**
 * Configuration options for the extension.
 */
export interface ImportantConfig {
    readonly validateOnSave: boolean;
    readonly validateOnType: boolean;
    readonly styleGuide: 'google';
}
