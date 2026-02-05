import * as vscode from 'vscode';
import type { ImportCategory } from '../types';
import { parseImports } from '../validation/import-parser';
import { getImportCategory } from '../validation/import-validator';
import { escapeRegex } from '../utils/text-utils';

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
        const category = getImportCategory(imp);

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
        'stdlib': [],
        'third-party': [],
        'local': [],
    };

    for (const imp of normalized) {
        groups[imp.category].push(imp);
    }

    // Sort alphabetically within each group (pure alphabetical by module name)
    const sortKey = (imp: NormalizedImport): string => {
        return imp.module.toLowerCase();
    };

    for (const category of Object.keys(groups) as ImportCategory[]) {
        groups[category].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }

    // Build the sorted import text
    const categoryOrder: ImportCategory[] = ['stdlib', 'third-party', 'local'];
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
