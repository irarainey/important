import type * as vscode from 'vscode';
import type { ValidationResult } from '../types';
import { validateImports } from './import-validator';

interface CacheEntry {
    readonly version: number;
    readonly result: ValidationResult;
}

/** Cached validation results keyed by document URI. */
const cache = new Map<string, CacheEntry>();

/**
 * Returns the validation result for the given document.
 *
 * If the document version matches the cached entry the result is
 * returned immediately (no re-scan).  Otherwise a fresh validation is
 * run, cached, and returned.
 *
 * **This is the single entry-point that both diagnostics and fix
 * commands should use** to ensure they operate on the same set of
 * issues.
 */
export function getValidation(document: vscode.TextDocument): ValidationResult {
    const key = document.uri.toString();
    const existing = cache.get(key);

    if (existing && existing.version === document.version) {
        return existing.result;
    }

    const result = validateImports(document);
    cache.set(key, { version: document.version, result });
    return result;
}

/**
 * Removes a specific document from the cache (e.g. when it is closed).
 */
export function invalidateValidation(uri: vscode.Uri): void {
    cache.delete(uri.toString());
}

/**
 * Clears the entire validation cache.
 */
export function disposeValidationCache(): void {
    cache.clear();
}
