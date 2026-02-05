import * as vscode from 'vscode';
import type { ImportIssue, ImportCategory } from './types';
import { validateImports, parseImports, getImportCategory } from './import-validator';

/**
 * Provides code actions (quick fixes) for import validation issues.
 */
export class ImportCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    private readonly issueCache = new Map<string, ImportIssue[]>();

    /**
     * Updates the cached issues for a document.
     */
    public updateIssues(uri: vscode.Uri, issues: ImportIssue[]): void {
        this.issueCache.set(uri.toString(), issues);
    }

    /**
     * Clears cached issues for a document.
     */
    public clearIssues(uri: vscode.Uri): void {
        this.issueCache.delete(uri.toString());
    }

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        // Always validate fresh to catch undo/redo changes that may not have updated cache yet
        const issues = validateImports(document);
        this.issueCache.set(document.uri.toString(), issues);

        // Check if any issues overlap with the current selection or are in context diagnostics
        const hasRelevantIssues = issues.some(issue =>
            issue.range.intersection(range) !== undefined
        ) || context.diagnostics.some(diagnostic =>
            diagnostic.source === 'Important'
        );

        if (!hasRelevantIssues || issues.length === 0) {
            return undefined;
        }

        // Provide a single "Fix All Imports" action
        const fixAllAction = new vscode.CodeAction(
            'Fix all import issues',
            vscode.CodeActionKind.QuickFix
        );
        fixAllAction.command = {
            command: 'important.fixImports',
            title: 'Fix all import issues',
        };
        fixAllAction.isPreferred = true;

        return [fixAllAction];
    }
}

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
        if (issue.suggestedFix) {
            edit.replace(document.uri, issue.range, issue.suggestedFix);

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

/**
 * Sorts all imports in a document according to Google style.
 * Expands multi-imports, removes unused imports, and groups by category.
 */
async function sortImportsInDocument(document: vscode.TextDocument): Promise<boolean> {
    const imports = parseImports(document);
    if (imports.length === 0) {
        return false;
    }

    const documentText = document.getText();

    // Helper to check if a name is used in the document
    const isNameUsed = (name: string, importLine: number): boolean => {
        const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
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

/**
 * Check if position might be in a string or comment (not in f-string expression).
 */
function isInStringOrComment(beforeMatch: string): boolean {
    // Check for comment (only if # is not inside a string)
    // Simple check: if # appears and we're not in a string at that point
    const hashIndex = beforeMatch.lastIndexOf('#');
    if (hashIndex !== -1) {
        // Check if the # is inside a string by counting quotes before it
        const beforeHash = beforeMatch.substring(0, hashIndex);
        const singleQuotesBefore = (beforeHash.match(/'/g) ?? []).length;
        const doubleQuotesBefore = (beforeHash.match(/"/g) ?? []).length;
        const tripleSingleBefore = (beforeHash.match(/'''/g) ?? []).length;
        const tripleDoubleBefore = (beforeHash.match(/"""/g) ?? []).length;
        const inStrBefore = ((singleQuotesBefore - tripleSingleBefore * 3) % 2 === 1) ||
            ((doubleQuotesBefore - tripleDoubleBefore * 3) % 2 === 1);
        if (!inStrBefore) {
            return true; // Hash is not in a string, so we're in a comment
        }
    }

    // Count quotes before the match position
    const singleQuotes = (beforeMatch.match(/'/g) ?? []).length;
    const doubleQuotes = (beforeMatch.match(/"/g) ?? []).length;
    const tripleSingle = (beforeMatch.match(/'''/g) ?? []).length;
    const tripleDouble = (beforeMatch.match(/"""/g) ?? []).length;

    // If odd number of unescaped quotes, we might be inside a string
    const inSingleQuote = (singleQuotes - tripleSingle * 3) % 2 === 1;
    const inDoubleQuote = (doubleQuotes - tripleDouble * 3) % 2 === 1;

    if (!inSingleQuote && !inDoubleQuote) {
        return false; // Not in any string
    }

    // Check for f-string expression: if we're in a string but inside {}, we're in code
    // Find the last quote that opened the string
    const lastSingleQuote = beforeMatch.lastIndexOf("'");
    const lastDoubleQuote = beforeMatch.lastIndexOf('"');
    const lastQuotePos = Math.max(lastSingleQuote, lastDoubleQuote);

    if (lastQuotePos === -1) {
        return inSingleQuote || inDoubleQuote;
    }

    // Check if this is an f-string (has 'f' or 'F' before the quote)
    const charBeforeQuote = lastQuotePos > 0 ? beforeMatch[lastQuotePos - 1] : '';
    const isFString = charBeforeQuote === 'f' || charBeforeQuote === 'F' ||
        (lastQuotePos > 1 && (beforeMatch[lastQuotePos - 2] === 'f' || beforeMatch[lastQuotePos - 2] === 'F'));

    if (!isFString) {
        return true; // In a regular string, not f-string
    }

    // For f-strings, check if we're inside {} (code expression)
    const afterQuote = beforeMatch.substring(lastQuotePos + 1);
    const openBraces = (afterQuote.match(/{/g) ?? []).length;
    const closeBraces = (afterQuote.match(/}/g) ?? []).length;

    // If more open braces than close braces, we're inside an f-string expression (code)
    if (openBraces > closeBraces) {
        return false; // Inside f-string {}, this is code
    }

    return true; // In string portion of f-string
}
