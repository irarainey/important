import * as vscode from 'vscode';
import { validateImports } from '../validation/import-validator';
import { isInStringOrComment } from '../utils/text-utils';
import { sortImportsInDocument } from './sort-imports';

/**
 * Fixes all import issues in the current document.
 * 
 * @returns The number of issues fixed
 */
export async function fixAllImports(editor: vscode.TextEditor): Promise<number> {
    const document = editor.document;
    const issues = validateImports(document);
    let fixCount = 0;

    // First: Apply symbol reference updates for import-modules-not-symbols
    // This must happen before we modify the imports
    const symbolIssues = issues.filter(i => i.code === 'import-modules-not-symbols');
    if (symbolIssues.length > 0) {
        const edit = new vscode.WorkspaceEdit();
        const documentText = document.getText();

        for (const issue of symbolIssues) {
            const moduleParts = issue.import.module.split('.');
            const moduleName = moduleParts[moduleParts.length - 1];
            const parentPackage = moduleParts.slice(0, -1).join('.');
            const importedSymbols = issue.import.names;

            // Fix the import statement itself
            edit.replace(document.uri, issue.range, `from ${parentPackage} import ${moduleName}`);

            for (const symbol of importedSymbols) {
                const symbolRegex = new RegExp(`\\b${symbol}\\b`, 'g');
                let match;

                while ((match = symbolRegex.exec(documentText)) !== null) {
                    const matchStart = document.positionAt(match.index);
                    const matchEnd = document.positionAt(match.index + symbol.length);
                    const matchRange = new vscode.Range(matchStart, matchEnd);

                    // Skip if this is part of the import statement itself
                    if (matchRange.intersection(issue.range)) {
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

                    edit.replace(document.uri, matchRange, `${moduleName}.${symbol}`);
                }
            }
        }

        await vscode.workspace.applyEdit(edit);
        fixCount += symbolIssues.length;

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
        fixCount++;
    }

    return fixCount;
}
