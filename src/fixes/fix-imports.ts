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
            const importedSymbols = issue.import.names;

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
    }

    // Second: Sort imports (also removes unused, expands multi-imports, fixes order)
    // Iterate until stable (max 3 iterations for safety)
    for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));

        const currentDoc = await vscode.workspace.openTextDocument(document.uri);
        const sorted = await sortImportsInDocument(currentDoc);

        if (!sorted) {
            break; // No changes made, imports are sorted
        }
        fixCount++;
    }

    return fixCount;
}
