import * as vscode from 'vscode';
import type { ImportCategory } from '../types';
import { CATEGORY_ORDER } from '../types';
import { parseImports } from '../validation/import-parser';
import { getImportCategory } from '../validation/import-validator';
import { isNameUsedOutsideLines } from '../utils/text-utils';
import { ensureModuleResolverReady } from '../utils/module-resolver';

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
 * Expands multi-imports, removes unused, groups by category, sorts alphabetically.
 */
export async function sortImportsInDocument(document: vscode.TextDocument): Promise<boolean> {
    // Ensure the module resolver cache is populated so that
    // getImportCategory can distinguish local from third-party.
    await ensureModuleResolverReady();

    const imports = parseImports(document);
    if (imports.length === 0) {
        return false;
    }

    const documentText = document.getText();

    // Collect all import line numbers for usage checking
    const importLineSet = new Set<number>();
    for (const imp of imports) {
        for (let line = imp.line; line <= imp.endLine; line++) {
            importLineSet.add(line);
        }
    }

    // Find the contiguous import block range
    const firstImportLine = Math.min(...imports.map(i => i.line));
    let lastImportLine = firstImportLine;
    for (const imp of imports) {
        if (imp.endLine > lastImportLine) {
            lastImportLine = imp.endLine;
        }
    }

    // Normalize imports: expand multi-imports, filter unused
    const normalized: NormalizedImport[] = [];

    for (const imp of imports) {
        const category = getImportCategory(imp, document.uri);

        if (imp.type === 'import') {
            // Expand 'import os, sys' into separate imports
            for (const name of imp.names) {
                const alias = imp.aliases.get(name);
                const usageName = alias ?? name;
                if (isNameUsedOutsideLines(document, documentText, usageName, importLineSet)) {
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
            // Filter to only used names
            const usedNames = imp.names.filter(name => {
                const alias = imp.aliases.get(name);
                const usageName = alias ?? name;
                return isNameUsedOutsideLines(document, documentText, usageName, importLineSet);
            });
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

    // Check if already sorted (no change needed)
    const startPos = new vscode.Position(firstImportLine, 0);
    const endPos = new vscode.Position(lastImportLine, document.lineAt(lastImportLine).text.length);
    const importRange = new vscode.Range(startPos, endPos);
    const currentText = document.getText(importRange);

    if (currentText === sortedImportsText) {
        return false; // Already sorted
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, importRange, sortedImportsText);

    return vscode.workspace.applyEdit(edit);
}
