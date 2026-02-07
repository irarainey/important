import * as vscode from 'vscode';
import type { ImportCategory, ValidationResult } from '../types';
import { CATEGORY_ORDER } from '../types';

interface NormalizedImport {
    module: string;
    type: 'import' | 'from';
    names: string[];
    /** Maps original name → alias for names with `as` clauses. */
    aliases: Map<string, string>;
    category: ImportCategory;
}

/**
 * Sorts all imports in a document according to Google style.
 *
 * Consumes a pre-computed {@link ValidationResult} so that parsing,
 * categorisation, and unused-name detection are performed exactly once
 * and shared with diagnostics — eliminating duplicate scans.
 *
 * Expands multi-imports, removes unused, groups by category, sorts alphabetically.
 */
export async function sortImportsInDocument(
    document: vscode.TextDocument,
    result: ValidationResult,
): Promise<boolean> {
    const { imports, categories, unusedNames } = result;
    if (imports.length === 0) {
        return false;
    }

    // Normalize imports: expand multi-imports, filter unused
    const normalized: NormalizedImport[] = [];

    for (const imp of imports) {
        const category = categories.get(imp)!;
        const unused = new Set(unusedNames.get(imp) ?? []);

        if (imp.type === 'import') {
            // Expand 'import os, sys' into separate imports
            for (const name of imp.names) {
                if (!unused.has(name)) {
                    const alias = imp.aliases.get(name);
                    const entryAliases = new Map<string, string>();
                    if (alias) entryAliases.set(name, alias);
                    normalized.push({
                        module: name,
                        type: 'import',
                        names: [name],
                        aliases: entryAliases,
                        category,
                    });
                }
            }
        } else if (imp.module === '__future__') {
            // Always preserve __future__ imports — their names are
            // directives, not symbols referenced elsewhere in code.
            normalized.push({
                module: imp.module,
                type: 'from',
                names: [...imp.names],
                aliases: new Map(imp.aliases),
                category,
            });
        } else if (imp.names.includes('*')) {
            // Keep wildcard imports as-is
            normalized.push({
                module: imp.module,
                type: 'from',
                names: ['*'],
                aliases: new Map<string, string>(),
                category,
            });
        } else {
            // Filter to only used names (those NOT in the unused set)
            const usedNames = imp.names.filter(name => !unused.has(name));
            if (usedNames.length > 0) {
                const filteredAliases = new Map<string, string>();
                for (const name of usedNames) {
                    const alias = imp.aliases.get(name);
                    if (alias) filteredAliases.set(name, alias);
                }
                normalized.push({
                    module: imp.module,
                    type: 'from',
                    names: usedNames,
                    aliases: filteredAliases,
                    category,
                });
            }
        }
    }

    // Group by category
    const groups: Record<ImportCategory, NormalizedImport[]> = {
        'future': [],
        'stdlib': [],
        'third-party': [],
        'first-party': [],
        'local': [],
    };

    // Deduplicate imports (merge from imports for same module, skip duplicate imports)
    const seenImports = new Map<string, NormalizedImport>();

    for (const imp of normalized) {
        const key = `${imp.type}:${imp.module}`;

        const existing = seenImports.get(key);
        if (existing) {
            if (imp.type === 'from' && !imp.names.includes('*') && !existing.names.includes('*')) {
                // Merge names for from imports
                for (const name of imp.names) {
                    if (!existing.names.includes(name)) {
                        existing.names.push(name);
                    }
                    const alias = imp.aliases.get(name);
                    if (alias) {
                        existing.aliases.set(name, alias);
                    }
                }
            }
            // For 'import' type, duplicate is just ignored
        } else {
            seenImports.set(key, imp);
        }
    }

    for (const imp of seenImports.values()) {
        groups[imp.category].push(imp);
    }

    // Sort within each group: `import` statements before `from` statements,
    // then alphabetically by module name within each sub-group (ignoring case).
    // This matches Ruff/isort default behaviour (force_sort_within_sections = false).
    for (const category of Object.keys(groups) as ImportCategory[]) {
        groups[category].sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'import' ? -1 : 1;
            }
            return a.module.toLowerCase().localeCompare(b.module.toLowerCase());
        });
    }

    // Build the sorted import text
    const sortedBlocks: string[] = [];

    for (const category of CATEGORY_ORDER) {
        const categoryImports = groups[category];
        if (categoryImports.length > 0) {
            const lines = categoryImports.map(imp => {
                if (imp.type === 'import') {
                    const alias = imp.aliases.get(imp.module);
                    return alias ? `import ${imp.module} as ${alias}` : `import ${imp.module}`;
                } else {
                    const nameFragments = imp.names.map(n => {
                        const alias = imp.aliases.get(n);
                        return alias ? `${n} as ${alias}` : n;
                    });
                    return `from ${imp.module} import ${nameFragments.join(', ')}`;
                }
            });
            sortedBlocks.push(lines.join('\n'));
        }
    }

    const sortedImportsText = sortedBlocks.join('\n\n');

    // Separate top-block and misplaced imports
    const topBlockImports = imports.filter(imp => !imp.misplaced);
    const misplacedImports = imports.filter(imp => imp.misplaced);

    // Find the contiguous top-block range (only among non-misplaced imports)
    const topFirstLine = topBlockImports.length > 0
        ? Math.min(...topBlockImports.map(i => i.line))
        : 0;
    let topLastLine = topFirstLine;
    for (const imp of topBlockImports) {
        if (imp.endLine > topLastLine) {
            topLastLine = imp.endLine;
        }
    }

    // When there are no misplaced imports, check if the top block is already sorted
    if (misplacedImports.length === 0) {
        const startPos = new vscode.Position(topFirstLine, 0);
        const endPos = new vscode.Position(topLastLine, document.lineAt(topLastLine).text.length);
        const importRange = new vscode.Range(startPos, endPos);
        const currentText = document.getText(importRange);

        if (currentText === sortedImportsText) {
            return false; // Already sorted
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, importRange, sortedImportsText);
        return vscode.workspace.applyEdit(edit);
    }

    // Misplaced imports exist — delete them from their original
    // positions and merge into the sorted top block.
    //
    // Process deletions bottom-up so that earlier line numbers remain
    // valid as we delete later lines.
    const edit = new vscode.WorkspaceEdit();

    const sortedMisplaced = [...misplacedImports].sort((a, b) => b.line - a.line);
    for (const imp of sortedMisplaced) {
        const startPos = new vscode.Position(imp.line, 0);
        // Delete the import line(s) and the following newline so we
        // don't leave blank gaps in the file body.
        const endLine = imp.endLine + 1 < document.lineCount
            ? imp.endLine + 1
            : imp.endLine;
        const endPos = imp.endLine + 1 < document.lineCount
            ? new vscode.Position(endLine, 0)
            : new vscode.Position(imp.endLine, document.lineAt(imp.endLine).text.length);
        edit.delete(document.uri, new vscode.Range(startPos, endPos));
    }

    // Replace the top-block range with the merged sorted imports
    const topStart = new vscode.Position(topFirstLine, 0);
    const topEnd = new vscode.Position(topLastLine, document.lineAt(topLastLine).text.length);
    edit.replace(document.uri, new vscode.Range(topStart, topEnd), sortedImportsText);

    return vscode.workspace.applyEdit(edit);
}
