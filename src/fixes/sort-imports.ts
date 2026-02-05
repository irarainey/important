import * as vscode from 'vscode';
import type { ImportCategory } from '../types';
import { parseImports } from '../validation/import-parser';
import { getImportCategory } from '../validation/import-validator';
import { escapeRegex } from '../utils/text-utils';

/**
 * Sorts all imports in a document according to Google style.
 * Expands multi-imports, removes unused imports, and groups by category.
 */
export async function sortImportsInDocument(document: vscode.TextDocument): Promise<boolean> {
    const imports = parseImports(document);
    if (imports.length === 0) {
        return false;
    }

    const documentText = document.getText();

    // Helper to check if a name is used in the document
    const isNameUsed = (name: string, importLine: number): boolean => {
        const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
        let match;
        while ((match = pattern.exec(documentText)) !== null) {
            const pos = document.positionAt(match.index);
            // Skip if on the import line itself
            if (pos.line === importLine) continue;
            // Skip if in a comment
            const lineText = document.lineAt(pos.line).text;
            const beforeMatch = lineText.substring(0, pos.character);
            if (beforeMatch.includes('#')) continue;
            return true;
        }
        return false;
    };

    // Expand multi-imports into individual imports, filtering out unused ones
    const expandedImports: { module: string; type: 'import' | 'from'; names: string[]; category: ImportCategory; originalLine: number }[] = [];

    for (const imp of imports) {
        const category = getImportCategory(imp);

        if (imp.type === 'import') {
            for (const name of imp.names) {
                // Check if this import is used
                if (isNameUsed(name, imp.line)) {
                    expandedImports.push({
                        module: name,
                        type: 'import',
                        names: [name],
                        category,
                        originalLine: imp.line,
                    });
                }
            }
        } else if (imp.names.includes('*')) {
            // Keep wildcard imports as-is (can't determine usage)
            expandedImports.push({
                module: imp.module,
                type: imp.type,
                names: [...imp.names],
                category,
                originalLine: imp.line,
            });
        } else {
            // For 'from X import Y, Z' - filter to only used names
            const usedNames = imp.names.filter(name => isNameUsed(name, imp.line));
            if (usedNames.length > 0) {
                expandedImports.push({
                    module: imp.module,
                    type: imp.type,
                    names: usedNames,
                    category,
                    originalLine: imp.line,
                });
            }
        }
    }

    // Group imports by category
    const groups: Record<ImportCategory, typeof expandedImports> = {
        'stdlib': [],
        'third-party': [],
        'local': [],
    };

    for (const imp of expandedImports) {
        groups[imp.category].push(imp);
    }

    // Sort alphabetically within each group
    // Plain imports before from imports, then by module name
    const sortKey = (imp: typeof expandedImports[0]): string => {
        if (imp.type === 'from') {
            return `1.${imp.module}.${imp.names[0] ?? ''}`;
        }
        return `0.${imp.module}`;
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

    // Find the range covering all import lines
    const importLines = imports.map(i => i.line);
    const firstImportLine = Math.min(...importLines);

    let lastImportLine = firstImportLine;
    for (const imp of imports) {
        const endLine = imp.line + (imp.text.split('\n').length - 1);
        if (endLine > lastImportLine) {
            lastImportLine = endLine;
        }
    }

    const startPos = new vscode.Position(firstImportLine, 0);
    const endPos = new vscode.Position(lastImportLine, document.lineAt(lastImportLine).text.length);
    const importRange = new vscode.Range(startPos, endPos);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, importRange, sortedImportsText);

    return vscode.workspace.applyEdit(edit);
}
