import * as vscode from 'vscode';
import { getValidation } from '../validation/validation-cache';
import { isInStringOrComment, escapeRegex, getMultilineStringLines, isNameAssignedInDocument } from '../utils/text-utils';
import { getModuleSymbols, hasModuleSymbols } from '../utils/module-symbols';
import { sortImportsInDocument } from './sort-imports';
import { ensureModuleResolverReady, resolveRelativeImport } from '../utils/module-resolver';
import { log } from '../utils/logger';

/**
 * Fixes all import issues in the current document.
 * 
 * @returns Number > 0 if any fixes were applied, 0 if nothing to fix
 */
export async function fixAllImports(editor: vscode.TextEditor, lineLength: number): Promise<number> {
    // Ensure the module resolver is ready so category detection works.
    await ensureModuleResolverReady();

    const document = editor.document;
    const { issues, importLines } = getValidation(document);

    const relativePath = vscode.workspace.asRelativePath(document.uri);
    log(`Fixing imports in ${relativePath}: ${issues.length} issue(s) detected.`);

    // If there are no diagnostics, skip all fix and sort logic — the imports
    // are already valid and should not be reformatted.
    if (issues.length === 0) {
        return 0;
    }

    let madeChanges = false;

    // First: Fix wildcard imports by converting to module imports
    const wildcardIssues = issues.filter(i => i.code === 'no-wildcard-imports');
    if (wildcardIssues.length > 0) {
        const edit = new vscode.WorkspaceEdit();
        const documentText = document.getText();

        for (const issue of wildcardIssues) {
            const moduleName = issue.import.module;

            if (!hasModuleSymbols(moduleName)) {
                continue;
            }

            const topLevelModule = moduleName.split('.')[0];
            const knownSymbols = getModuleSymbols(moduleName);

            // Replace all usages of known symbols with qualified names
            for (const symbol of knownSymbols) {
                replaceSymbolUsagesOutsideImports(document, edit, documentText, symbol, `${moduleName}.${symbol}`, importLines);
            }

            // Replace the wildcard import with simple top-level module import
            // from os.path import * -> import os
            edit.replace(document.uri, issue.range, `import ${topLevelModule}`);
        }

        await vscode.workspace.applyEdit(edit);
        madeChanges = true;
    }

    // Second: Fix relative imports by converting to absolute imports
    const relativeIssues = issues.filter(i => i.code === 'no-relative-imports');
    if (relativeIssues.length > 0) {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const currentRelativeIssues = freshResult.issues.filter(i => i.code === 'no-relative-imports');

        const relativeEdit = new vscode.WorkspaceEdit();
        for (const issue of currentRelativeIssues) {
            const imp = issue.import;

            // Resolve the relative import to an absolute module path
            // using the workspace module cache and the document's location.
            const absoluteModule = resolveRelativeImport(freshDoc.uri, imp.level, imp.module);
            if (absoluteModule) {
                // Rebuild the import statement with the resolved absolute path
                const namesPart = imp.names.length > 0 ? imp.names.map(n => {
                    const alias = imp.aliases.get(n);
                    return alias ? `${n} as ${alias}` : n;
                }).join(', ') : '';

                const newImport = imp.type === 'from' && namesPart
                    ? `from ${absoluteModule} import ${namesPart}`
                    : `import ${absoluteModule}`;
                relativeEdit.replace(freshDoc.uri, issue.range, newImport);
            } else if (issue.suggestedFix) {
                // Fallback: strip dots (best-effort when resolver can't find the path)
                relativeEdit.replace(freshDoc.uri, issue.range, issue.suggestedFix);
            }
        }

        await vscode.workspace.applyEdit(relativeEdit);
        madeChanges = true;
    }

    // Fourth: Fix non-standard import aliases by replacing with the standard
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

        // Group issues by import line so that multi-import lines
        // (e.g. `import datetime as dt, collections as col`) are
        // handled as a single replacement instead of conflicting edits.
        const issuesByLine = new Map<number, typeof currentAliasIssues>();
        for (const issue of currentAliasIssues) {
            if (!issue.suggestedFix) continue;
            const key = issue.import.line;
            const group = issuesByLine.get(key) ?? [];
            group.push(issue);
            issuesByLine.set(key, group);
        }

        // Phase 1: Replace import statements
        const aliasEdit = new vscode.WorkspaceEdit();
        for (const [, lineIssues] of issuesByLine) {
            const imp = lineIssues[0].import;

            // Map module name → suggestedFix for modules flagged on this line
            const fixes = new Map<string, string>();
            for (const issue of lineIssues) {
                const sfMatch = issue.suggestedFix!.match(/^import\s+(\S+)(?:\s+as\s+\S+)?$/);
                if (sfMatch) {
                    fixes.set(sfMatch[1], issue.suggestedFix!);
                }
            }

            // Rebuild one import line per module: apply fixes where flagged,
            // preserve unflagged modules unchanged (including their aliases).
            const lines: string[] = [];
            for (const name of imp.names) {
                if (fixes.has(name)) {
                    lines.push(fixes.get(name)!);

                    // Track alias → new-name transformation for Phase 2
                    const oldAlias = imp.aliases.get(name);
                    if (oldAlias) {
                        const asMatch = fixes.get(name)!.match(/^import\s+\S+\s+as\s+(\S+)$/);
                        const newName = asMatch ? asMatch[1] : name;
                        aliasTransformations.push({ oldAlias, newName });
                    }
                } else {
                    const alias = imp.aliases.get(name);
                    lines.push(alias ? `import ${name} as ${alias}` : `import ${name}`);
                }
            }

            aliasEdit.replace(freshDoc.uri, lineIssues[0].range, lines.join('\n'));
        }

        if (aliasTransformations.length > 0) {
            await vscode.workspace.applyEdit(aliasEdit);
            madeChanges = true;

            // Phase 2: Replace alias usages in code
            const updatedDoc = await vscode.workspace.openTextDocument(editor.document.uri);
            const updatedText = updatedDoc.getText();
            const updatedResult = getValidation(updatedDoc);

            const usageEdit = new vscode.WorkspaceEdit();
            for (const { oldAlias, newName } of aliasTransformations) {
                replaceSymbolUsagesOutsideImports(updatedDoc, usageEdit, updatedText, oldAlias, newName, updatedResult.importLines);
            }

            await vscode.workspace.applyEdit(usageEdit);
        }
    }

    // Fifth: Fix unnecessary from-import aliases by removing the `as` clause
    // and updating all references.  e.g. `from X import y as z` → `from X import y`
    // with all `z.xxx` → `y.xxx` replacements.
    const fromAliasIssues = issues.filter(i => i.code === 'unnecessary-from-alias');
    if (fromAliasIssues.length > 0) {
        log(`Fixing ${fromAliasIssues.length} unnecessary from-alias issue(s).`);
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const currentFromAliasIssues = freshResult.issues.filter(i => i.code === 'unnecessary-from-alias');

        if (currentFromAliasIssues.length !== fromAliasIssues.length) {
            log(`Warning: from-alias issue count changed from ${fromAliasIssues.length} to ${currentFromAliasIssues.length} after re-validation.`);
        }

        const fromAliasTransformations: Array<{
            oldAlias: string;
            newName: string;
        }> = [];

        // Group issues by import line (an import may have multiple aliases flagged)
        const issuesByLine = new Map<number, typeof currentFromAliasIssues>();
        for (const issue of currentFromAliasIssues) {
            const key = issue.import.line;
            const group = issuesByLine.get(key) ?? [];
            group.push(issue);
            issuesByLine.set(key, group);
        }

        // Phase 1: Rebuild import statements without the flagged aliases
        const fromAliasEdit = new vscode.WorkspaceEdit();
        for (const [, lineIssues] of issuesByLine) {
            const imp = lineIssues[0].import;

            // Collect the original names whose aliases are flagged
            const flaggedNames = new Set<string>();
            for (const issue of lineIssues) {
                // Extract the specific (original, alias) pair from the message.
                // Message format: 'from MODULE import ORIGINAL as ALIAS' — ...
                const messageMatch = issue.message.match(/^'from \S+ import (\S+) as (\S+)'/);
                if (messageMatch) {
                    const [, msgOriginal, msgAlias] = messageMatch;
                    // Verify this alias exists in the import
                    if (imp.aliases.get(msgOriginal) === msgAlias) {
                        flaggedNames.add(msgOriginal);
                        fromAliasTransformations.push({ oldAlias: msgAlias, newName: msgOriginal });
                    } else {
                        log(`Warning: extracted alias '${msgOriginal} as ${msgAlias}' doesn't match import aliases.`);
                    }
                } else {
                    // Fallback: try matching each alias against the message
                    for (const [original, alias] of issue.import.aliases) {
                        const pattern = `${original} as ${alias}`;
                        if (issue.message.includes(pattern)) {
                            flaggedNames.add(original);
                            fromAliasTransformations.push({ oldAlias: alias, newName: original });
                        }
                    }
                }
            }

            // Rebuild the import: strip alias from flagged names, keep others
            const nameFragments = imp.names.map(n => {
                const alias = imp.aliases.get(n);
                if (alias && flaggedNames.has(n)) {
                    return n; // Drop the alias
                }
                return alias ? `${n} as ${alias}` : n;
            });
            const newImport = `from ${imp.module} import ${nameFragments.join(', ')}`;
            fromAliasEdit.replace(freshDoc.uri, lineIssues[0].range, newImport);
        }

        if (fromAliasTransformations.length > 0) {
            log(`Removing ${fromAliasTransformations.length} unnecessary from-alias(es) and updating references.`);
            await vscode.workspace.applyEdit(fromAliasEdit);
            madeChanges = true;

            // Phase 2: Replace alias usages in code
            const updatedDoc = await vscode.workspace.openTextDocument(editor.document.uri);
            const updatedText = updatedDoc.getText();
            const updatedResult = getValidation(updatedDoc);

            const usageEdit = new vscode.WorkspaceEdit();
            for (const { oldAlias, newName } of fromAliasTransformations) {
                replaceSymbolUsagesOutsideImports(updatedDoc, usageEdit, updatedText, oldAlias, newName, updatedResult.importLines);
            }

            await vscode.workspace.applyEdit(usageEdit);
        } else if (currentFromAliasIssues.length > 0) {
            // We found issues but couldn't extract transformations - log for debugging
            log(`Warning: ${currentFromAliasIssues.length} from-alias issue(s) found but no transformations extracted.`);
        }
    }

    // Sixth: Apply symbol reference updates for import-modules-not-symbols
    // This must happen before we sort the imports.
    // Phase 1: Replace the import statements themselves
    // Phase 2: Replace symbol usages (after import edits are applied to avoid range conflicts)
    // Always re-validate here — earlier fixes (e.g. relative → absolute) can
    // introduce new symbol-import violations that were not in the original issues.
    {
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const currentSymbolIssues = freshResult.issues.filter(i => i.code === 'import-modules-not-symbols');

        if (currentSymbolIssues.length > 0) {
            const freshText = freshDoc.getText();
            const freshMultilineLines = getMultilineStringLines(freshDoc);

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

                    // Check if the module name conflicts with a local variable.
                    // If so, alias the import to avoid shadowing.
                    const hasConflict = isNameAssignedInDocument(
                        freshDoc, freshText, moduleName, freshResult.importLines, freshMultilineLines,
                    );
                    const usageName = hasConflict ? `${moduleName}_mod` : moduleName;
                    const importStatement = hasConflict
                        ? `from ${parentPackage} import ${moduleName} as ${usageName}`
                        : `from ${parentPackage} import ${moduleName}`;

                    importEdit.replace(freshDoc.uri, issue.range, importStatement);
                    transformations.push({ moduleName: usageName, symbols: importedSymbols, aliases: issue.import.aliases });
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
                        // Check if the module name conflicts with a local variable.
                        const hasConflict = isNameAssignedInDocument(
                            freshDoc, freshText, moduleName, freshResult.importLines, freshMultilineLines,
                        );
                        const usageName = hasConflict ? `${moduleName}_mod` : moduleName;
                        const importStatement = hasConflict
                            ? `import ${moduleName} as ${usageName}`
                            : `import ${moduleName}`;

                        importEdit.replace(freshDoc.uri, issue.range, importStatement);
                        transformations.push({ moduleName: usageName, symbols: importedSymbols, aliases: issue.import.aliases });
                    }
                }
            }

            await vscode.workspace.applyEdit(importEdit);
            madeChanges = true;

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
        }
    }

    // Seventh: Sort imports (also removes unused, expands multi-imports, fixes order)
    // Iterate until stable (max 5 iterations for safety)
    for (let i = 0; i < 5; i++) {
        // Get fresh document reference and its validation result
        const freshDoc = await vscode.workspace.openTextDocument(editor.document.uri);
        const freshResult = getValidation(freshDoc);
        const sorted = await sortImportsInDocument(freshDoc, freshResult, lineLength);

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
    const mlLines = getMultilineStringLines(document);
    let match;

    while ((match = symbolRegex.exec(documentText)) !== null) {
        const matchStart = document.positionAt(match.index);

        // Skip if this is on an import line
        if (importLines.has(matchStart.line)) {
            continue;
        }

        // Skip if inside a multi-line string (docstring)
        if (mlLines.has(matchStart.line)) {
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

        // Skip if this is a function/class definition name (preceded by 'def ' or 'class ')
        const trimmedBefore = beforeMatch.trimEnd();
        if (trimmedBefore.endsWith('def') || trimmedBefore.endsWith('class')) {
            continue;
        }

        // Skip if this is a keyword argument name (followed by '=' without
        // whitespace, e.g. `func(is_third_party=value)`).  Default values
        // after type annotations have a space before '=' (`Type = default`)
        // per PEP 8 and should NOT be skipped.
        const afterMatch = lineText.substring(matchStart.character + symbol.length);
        if (afterMatch.startsWith('=') && !afterMatch.startsWith('==')) {
            continue;
        }

        const matchEnd = document.positionAt(match.index + symbol.length);
        edit.replace(document.uri, new vscode.Range(matchStart, matchEnd), qualifiedName);
    }
}
