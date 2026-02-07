import * as vscode from 'vscode';
import { getValidation } from '../validation/validation-cache';
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
    const { issues } = getValidation(document);
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

    // Second: Fix non-standard import aliases by replacing with the standard
    // alias (or removing the alias entirely) and updating all references.
    const aliasIssues = issues.filter(i => i.code === 'non-standard-import-alias');
    if (aliasIssues.length > 0) {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const currentAliasIssues = freshResult.issues.filter(i => i.code === 'non-standard-import-alias');

        const aliasTransformations: Array<{
            oldAlias: string;
            newName: string;
        }> = [];

        // Phase 1: Replace import statements
        const aliasEdit = new vscode.WorkspaceEdit();
        for (const issue of currentAliasIssues) {
            if (!issue.suggestedFix) continue;

            // The old alias currently used in code
            const oldAlias = issue.import.aliases.get(issue.import.module);
            if (!oldAlias) continue;

            // The new usage name: either the standard alias or the bare module name
            const asMatch = issue.suggestedFix.match(/^import\s+\S+\s+as\s+(\S+)$/);
            const newName = asMatch ? asMatch[1] : issue.import.module;

            aliasEdit.replace(freshDoc.uri, issue.range, issue.suggestedFix);
            aliasTransformations.push({ oldAlias, newName });
        }

        if (aliasTransformations.length > 0) {
            await vscode.workspace.applyEdit(aliasEdit);
            madeChanges = true;

            await new Promise(resolve => setTimeout(resolve, 100));

            // Phase 2: Replace alias usages in code
            const updatedDoc = await vscode.workspace.openTextDocument(editor.document.uri);
            const updatedText = updatedDoc.getText();
            const updatedResult = getValidation(updatedDoc);

            const usageEdit = new vscode.WorkspaceEdit();
            for (const { oldAlias, newName } of aliasTransformations) {
                replaceSymbolUsagesOutsideImports(updatedDoc, usageEdit, updatedText, oldAlias, newName, updatedResult.importLines);
            }

            await vscode.workspace.applyEdit(usageEdit);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Third: Apply symbol reference updates for import-modules-not-symbols
    // This must happen before we sort the imports.
    // Phase 1: Replace the import statements themselves
    // Phase 2: Replace symbol usages (after import edits are applied to avoid range conflicts)
    const symbolIssues = issues.filter(i => i.code === 'import-modules-not-symbols');
    if (symbolIssues.length > 0) {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const currentSymbolIssues = freshResult.issues.filter(i => i.code === 'import-modules-not-symbols');

        // Collect transformation info before modifying the document
        const transformations: Array<{
            moduleName: string;
            symbols: readonly string[];
            aliases: ReadonlyMap<string, string>;
        }> = [];

        // Build a map of modules already imported via `import X [as Y]`
        // so we can reuse the existing reference name instead of creating
        // a duplicate import that the deduplicator would incorrectly merge.
        const existingModuleImports = new Map<string, string>();
        for (const imp of freshResult.imports) {
            if (imp.type === 'import') {
                const usageName = imp.aliases.get(imp.module) ?? imp.module;
                // Prefer non-aliased imports (module available by its own name)
                if (!existingModuleImports.has(imp.module) || usageName === imp.module) {
                    existingModuleImports.set(imp.module, usageName);
                }
            }
        }

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
                transformations.push({ moduleName, symbols: importedSymbols, aliases: issue.import.aliases });
            } else {
                // Top-level module: from fastmcp import FastMCP → import fastmcp
                const moduleName = issue.import.module;
                const existingName = existingModuleImports.get(moduleName);
                if (existingName) {
                    // Module already imported (possibly aliased).  Don't add
                    // a duplicate — the from-import will become unused after
                    // Phase 2 rewrites references, and the sort step removes
                    // it.  Use the existing name for qualified references.
                    transformations.push({ moduleName: existingName, symbols: importedSymbols, aliases: issue.import.aliases });
                } else {
                    importEdit.replace(freshDoc.uri, issue.range, `import ${moduleName}`);
                    transformations.push({ moduleName, symbols: importedSymbols, aliases: issue.import.aliases });
                }
            }
        }

        await vscode.workspace.applyEdit(importEdit);
        madeChanges = true;

        // Wait for import edits to be applied
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 2: Replace symbol usages in the updated document
        const updatedDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const updatedText = updatedDoc.getText();
        const updatedResult = getValidation(updatedDoc);

        const symbolEdit = new vscode.WorkspaceEdit();
        for (const { moduleName, symbols, aliases } of transformations) {
            for (const symbol of symbols) {
                // When the imported name has an alias (e.g. `from json import loads as json_loads`),
                // code uses the alias, not the original name.  Search for the alias and
                // replace with the qualified original name (e.g. `json_loads` → `json.loads`).
                const searchName = aliases.get(symbol) ?? symbol;
                replaceSymbolUsagesOutsideImports(updatedDoc, symbolEdit, updatedText, searchName, `${moduleName}.${symbol}`, updatedResult.importLines);
            }
        }

        await vscode.workspace.applyEdit(symbolEdit);

        // Wait for symbol edits to be applied before sorting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Fourth: Sort imports (also removes unused, expands multi-imports, fixes order)
    // Iterate until stable (max 5 iterations for safety)
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get fresh document reference and its validation result
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const sorted = await sortImportsInDocument(freshDoc, freshResult);

        if (!sorted) {
            break; // No changes made, imports are sorted
        }
        madeChanges = true;
    }

    return madeChanges ? 1 : 0;
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
    importLines: ReadonlySet<number>,
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
