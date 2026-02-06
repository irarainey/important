import * as vscode from 'vscode';
import type { ImportCategory } from '../types';
import { parseImports } from '../validation/import-parser';
import { getImportCategory } from '../validation/import-validator';
import { escapeRegex } from '../utils/text-utils';
import { ensureModuleResolverReady } from '../utils/module-resolver';

/**
 * Checks if a name is used anywhere in the document outside import lines.
 */
function isNameUsed(documentText: string, document: vscode.TextDocument, name: string, importLines: Set<number>): boolean {
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
    let match;
    while ((match = pattern.exec(documentText)) !== null) {
        const pos = document.positionAt(match.index);
        // Skip if on an import line
        if (importLines.has(pos.line)) continue;
        // Skip if in a comment
        const lineText = document.lineAt(pos.line).text;
        const beforeMatch = lineText.substring(0, pos.character);
        if (beforeMatch.includes('#')) continue;
        return true;
    }
    return false;
}

interface NormalizedImport {
    module: string;
    type: 'import' | 'from';
    names: string[];
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
        const lineCount = imp.text.split('\n').length;
        for (let i = 0; i < lineCount; i++) {
            importLineSet.add(imp.line + i);
        }
    }

    // Find the contiguous import block range
    const importLines = imports.map(i => i.line);
    const firstImportLine = Math.min(...importLines);
    let lastImportLine = firstImportLine;
    for (const imp of imports) {
        const endLine = imp.line + (imp.text.split('\n').length - 1);
        if (endLine > lastImportLine) {
            lastImportLine = endLine;
        }
    }

    // Normalize imports: expand multi-imports, filter unused
    const normalized: NormalizedImport[] = [];

    for (const imp of imports) {
        const category = getImportCategory(imp, document.uri);

        if (imp.type === 'import') {
            // Expand 'import os, sys' into separate imports
            for (const name of imp.names) {
                if (isNameUsed(documentText, document, name, importLineSet)) {
                    normalized.push({
                        module: name,
                        type: 'import',
                        names: [name],
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
                category,
            });
        } else if (imp.names.includes('*')) {
            // Keep wildcard imports as-is
            normalized.push({
                module: imp.module,
                type: 'from',
                names: ['*'],
                category,
            });
        } else {
            // Filter to only used names
            const usedNames = imp.names.filter(name =>
                isNameUsed(documentText, document, name, importLineSet)
            );
            if (usedNames.length > 0) {
                normalized.push({
                    module: imp.module,
                    type: 'from',
                    names: usedNames,
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

        if (seenImports.has(key)) {
            const existing = seenImports.get(key)!;
            if (imp.type === 'from' && !imp.names.includes('*') && !existing.names.includes('*')) {
                // Merge names for from imports
                for (const name of imp.names) {
                    if (!existing.names.includes(name)) {
                        existing.names.push(name);
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
    const categoryOrder: ImportCategory[] = ['future', 'stdlib', 'third-party', 'first-party', 'local'];
    const sortedBlocks: string[] = [];

    for (const category of categoryOrder) {
        const categoryImports = groups[category];
        if (categoryImports.length > 0) {
            const lines = categoryImports.map(imp => {
                if (imp.type === 'import') {
                    return `import ${imp.module}`;
                } else {
                    return `from ${imp.module} import ${imp.names.join(', ')}`;
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
