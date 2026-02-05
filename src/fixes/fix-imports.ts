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

    // Only fix issues that have suggested fixes
    const fixableIssues = issues.filter(i => i.suggestedFix !== undefined);

    if (fixableIssues.length === 0) {
        return 0;
    }

    // Sort by line number descending so we can apply fixes from bottom to top
    // This prevents line number shifts from affecting later fixes
    const sortedIssues = [...fixableIssues].sort((a, b) => b.import.line - a.import.line);

    const edit = new vscode.WorkspaceEdit();
    const documentText = document.getText();

    for (const issue of sortedIssues) {
        if (issue.suggestedFix !== undefined) {
            if (issue.suggestedFix === '') {
                // Empty fix means delete the entire line (including newline)
                const lineRange = document.lineAt(issue.import.line).rangeIncludingLineBreak;
                edit.delete(document.uri, lineRange);
            } else {
                edit.replace(document.uri, issue.range, issue.suggestedFix);
            }

            // For import-modules-not-symbols, also update all symbol references
            if (issue.code === 'import-modules-not-symbols') {
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
        }
    }

    const success = await vscode.workspace.applyEdit(edit);

    if (!success) {
        return 0;
    }

    // Second pass: Sort imports after fixing issues
    // Wait for document to update, then apply sorting
    await new Promise(resolve => setTimeout(resolve, 100));

    const sortResult = await sortImportsInDocument(editor.document);

    return sortedIssues.length + (sortResult ? 1 : 0);
}
