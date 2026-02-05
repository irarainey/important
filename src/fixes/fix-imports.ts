import * as vscode from 'vscode';
import { validateImports } from '../validation/import-validator';
import { isInStringOrComment, escapeRegex } from '../utils/text-utils';
import { getModuleSymbols, hasModuleSymbols } from '../utils/module-symbols';
import { sortImportsInDocument } from './sort-imports';

/**
 * Fixes all import issues in the current document.
 * 
 * @returns Number > 0 if any fixes were applied, 0 if nothing to fix
 */
export async function fixAllImports(editor: vscode.TextEditor): Promise<number> {
    const document = editor.document;
    const issues = validateImports(document);
    let madeChanges = false;

    // First: Fix wildcard imports by converting to module imports
    const wildcardIssues = issues.filter(i => i.code === 'no-wildcard-imports');
    if (wildcardIssues.length > 0) {
        const edit = new vscode.WorkspaceEdit();
        const documentText = document.getText();

        for (const issue of wildcardIssues) {
            const moduleName = issue.import.module;

            // Check if we have known symbols for this module
            if (!hasModuleSymbols(moduleName)) {
                // Can't fix - skip this wildcard import
                continue;
            }

            const knownSymbols = getModuleSymbols(moduleName);
            const usedSymbols: string[] = [];

            // Scan document for uses of known symbols
            for (const symbol of knownSymbols) {
                const symbolRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
                let match;

                while ((match = symbolRegex.exec(documentText)) !== null) {
                    const matchStart = document.positionAt(match.index);

                    // Skip if this is on the import line itself
                    if (matchStart.line === issue.import.line) {
                        continue;
                    }

                    // Skip if in a string or comment
                    const lineText = document.lineAt(matchStart.line).text;
                    const beforeMatch = lineText.substring(0, matchStart.character);
                    if (isInStringOrComment(beforeMatch)) {
                        continue;
                    }

                    // Skip if preceded by a dot (already qualified)
                    if (matchStart.character > 0) {
                        const charBefore = document.getText(new vscode.Range(
                            matchStart.translate(0, -1),
                            matchStart
                        ));
                        if (charBefore === '.') {
                            continue;
                        }
                    }

                    if (!usedSymbols.includes(symbol)) {
                        usedSymbols.push(symbol);
                    }

                    // Replace symbol with qualified name
                    const matchEnd = document.positionAt(match.index + symbol.length);
                    const matchRange = new vscode.Range(matchStart, matchEnd);
                    edit.replace(document.uri, matchRange, `${moduleName}.${symbol}`);
                }
            }

            // Replace the wildcard import with module import
            // from os.path import * -> import os.path
            edit.replace(document.uri, issue.range, `import ${moduleName}`);
        }

        await vscode.workspace.applyEdit(edit);
        madeChanges = true;

        // Wait for edit to be applied
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Second: Apply symbol reference updates for import-modules-not-symbols
    // This must happen before we modify the imports
    const symbolIssues = issues.filter(i => i.code === 'import-modules-not-symbols');
    if (symbolIssues.length > 0) {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const edit = new vscode.WorkspaceEdit();
        const documentText = freshDoc.getText();
        const freshIssues = validateImports(freshDoc);
        const currentSymbolIssues = freshIssues.filter(i => i.code === 'import-modules-not-symbols');

        for (const issue of currentSymbolIssues) {
            const moduleParts = issue.import.module.split('.');
            const moduleName = moduleParts[moduleParts.length - 1];
            const parentPackage = moduleParts.slice(0, -1).join('.');
            const importedSymbols = issue.import.names;

            // Fix the import statement itself
            edit.replace(freshDoc.uri, issue.range, `from ${parentPackage} import ${moduleName}`);

            for (const symbol of importedSymbols) {
                const symbolRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
                let match;

                while ((match = symbolRegex.exec(documentText)) !== null) {
                    const matchStart = freshDoc.positionAt(match.index);
                    const matchEnd = freshDoc.positionAt(match.index + symbol.length);
                    const matchRange = new vscode.Range(matchStart, matchEnd);

                    // Skip if this is part of the import statement itself
                    if (matchRange.intersection(issue.range)) {
                        continue;
                    }

                    // Skip if in a string or comment
                    const lineText = freshDoc.lineAt(matchStart.line).text;
                    const beforeMatch = lineText.substring(0, matchStart.character);
                    if (isInStringOrComment(beforeMatch)) {
                        continue;
                    }

                    // Skip if preceded by a dot (already qualified)
                    if (matchStart.character > 0) {
                        const charBefore = freshDoc.getText(new vscode.Range(
                            matchStart.translate(0, -1),
                            matchStart
                        ));
                        if (charBefore === '.') {
                            continue;
                        }
                    }

                    edit.replace(freshDoc.uri, matchRange, `${moduleName}.${symbol}`);
                }
            }
        }

        await vscode.workspace.applyEdit(edit);
        madeChanges = true;

        // Wait for edit to be applied before sorting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Second: Sort imports (also removes unused, expands multi-imports, fixes order)
    // Iterate until stable (max 5 iterations for safety)
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get fresh document reference to ensure we have the latest content
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const sorted = await sortImportsInDocument(freshDoc);

        if (!sorted) {
            break; // No changes made, imports are sorted
        }
        madeChanges = true;
    }

    return madeChanges ? 1 : 0;
}
