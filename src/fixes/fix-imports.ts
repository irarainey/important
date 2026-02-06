import * as vscode from 'vscode';
import { validateImports } from '../validation/import-validator';
import { parseImports } from '../validation/import-parser';
import { isInStringOrComment, escapeRegex } from '../utils/text-utils';
import { getModuleSymbols, hasModuleSymbols } from '../utils/module-symbols';
import { sortImportsInDocument } from './sort-imports';
import { ensureModuleResolverReady } from '../utils/module-resolver';
import { log } from '../utils/logger';

/**
 * Fixes all import issues in the current document.
 * 
 * @returns Number > 0 if any fixes were applied, 0 if nothing to fix
 */
export async function fixAllImports(editor: vscode.TextEditor): Promise<number> {
    // Ensure the module resolver is ready so category detection works.
    await ensureModuleResolverReady();

    const document = editor.document;
    const issues = validateImports(document);
    let madeChanges = false;

    const relativePath = vscode.workspace.asRelativePath(document.uri);
    log(`Fixing imports in ${relativePath}: ${issues.length} issue(s) detected.`);

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

            // Use the top-level module for simplicity (e.g., os instead of os.path)
            const topLevelModule = moduleName.split('.')[0];

            const knownSymbols = getModuleSymbols(moduleName);
            const usedSymbols: string[] = [];

            // Scan document for uses of known symbols
            for (const symbol of knownSymbols) {
                const symbolRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
                let match;

                while ((match = symbolRegex.exec(documentText)) !== null) {
                    const matchStart = document.positionAt(match.index);

                    // Skip if this is on the import line(s) (including multi-line imports)
                    if (matchStart.line >= issue.import.line && matchStart.line <= issue.import.endLine) {
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

                    // Replace symbol with qualified name (keep full path for clarity)
                    const matchEnd = document.positionAt(match.index + symbol.length);
                    const matchRange = new vscode.Range(matchStart, matchEnd);
                    edit.replace(document.uri, matchRange, `${moduleName}.${symbol}`);
                }
            }

            // Replace the wildcard import with simple top-level module import
            // from os.path import * -> import os
            edit.replace(document.uri, issue.range, `import ${topLevelModule}`);
        }

        await vscode.workspace.applyEdit(edit);
        madeChanges = true;

        // Wait for edit to be applied
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Second: Apply symbol reference updates for import-modules-not-symbols
    // This must happen before we sort the imports.
    // Phase 1: Replace the import statements themselves
    // Phase 2: Replace symbol usages (after import edits are applied to avoid range conflicts)
    const symbolIssues = issues.filter(i => i.code === 'import-modules-not-symbols');
    if (symbolIssues.length > 0) {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshIssues = validateImports(freshDoc);
        const currentSymbolIssues = freshIssues.filter(i => i.code === 'import-modules-not-symbols');

        // Collect transformation info before modifying the document
        const transformations: Array<{
            moduleName: string;
            symbols: readonly string[];
        }> = [];

        // Phase 1: Replace import statements only
        const importEdit = new vscode.WorkspaceEdit();
        for (const issue of currentSymbolIssues) {
            const moduleParts = issue.import.module.split('.');
            const importedSymbols = issue.import.names;

            if (moduleParts.length >= 2) {
                // Deep import: from x.y import Symbol → from x import y
                const moduleName = moduleParts[moduleParts.length - 1];
                const parentPackage = moduleParts.slice(0, -1).join('.');
                importEdit.replace(freshDoc.uri, issue.range, `from ${parentPackage} import ${moduleName}`);
                transformations.push({ moduleName, symbols: importedSymbols });
            } else {
                // Top-level module: from fastmcp import FastMCP → import fastmcp
                const moduleName = issue.import.module;
                importEdit.replace(freshDoc.uri, issue.range, `import ${moduleName}`);
                transformations.push({ moduleName, symbols: importedSymbols });
            }
        }

        await vscode.workspace.applyEdit(importEdit);
        madeChanges = true;

        // Wait for import edits to be applied
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 2: Replace symbol usages in the updated document
        const updatedDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const updatedText = updatedDoc.getText();
        const updatedImports = parseImports(updatedDoc);

        // Build a set of lines that are part of import statements (to skip)
        const importLineSet = new Set<number>();
        for (const imp of updatedImports) {
            for (let line = imp.line; line <= imp.endLine; line++) {
                importLineSet.add(line);
            }
        }

        const symbolEdit = new vscode.WorkspaceEdit();
        for (const { moduleName, symbols } of transformations) {
            for (const symbol of symbols) {
                replaceSymbolUsagesOutsideImports(updatedDoc, symbolEdit, updatedText, symbol, `${moduleName}.${symbol}`, importLineSet);
            }
        }

        await vscode.workspace.applyEdit(symbolEdit);

        // Wait for symbol edits to be applied before sorting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Third: Sort imports (also removes unused, expands multi-imports, fixes order)
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

/**
 * Replaces all usages of a symbol in the document with a qualified name,
 * skipping the import line itself, strings, comments, and already-qualified refs.
 */
function replaceSymbolUsages(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    documentText: string,
    symbol: string,
    qualifiedName: string,
    importRange: vscode.Range,
): void {
    const symbolRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
    let match;

    while ((match = symbolRegex.exec(documentText)) !== null) {
        const matchStart = document.positionAt(match.index);
        const matchEnd = document.positionAt(match.index + symbol.length);
        const matchRange = new vscode.Range(matchStart, matchEnd);

        // Skip if this is part of the import statement itself
        if (matchRange.intersection(importRange)) {
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

        edit.replace(document.uri, matchRange, qualifiedName);
    }
}

/**
 * Replaces all usages of a symbol with a qualified name, skipping any line
 * that is part of an import statement (identified by line number set).
 * Used after import statements have been modified to avoid stale range issues.
 */
function replaceSymbolUsagesOutsideImports(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    documentText: string,
    symbol: string,
    qualifiedName: string,
    importLines: Set<number>,
): void {
    const symbolRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g');
    let match;

    while ((match = symbolRegex.exec(documentText)) !== null) {
        const matchStart = document.positionAt(match.index);

        // Skip if this is on an import line
        if (importLines.has(matchStart.line)) {
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

        const matchEnd = document.positionAt(match.index + symbol.length);
        edit.replace(document.uri, new vscode.Range(matchStart, matchEnd), qualifiedName);
    }
}
