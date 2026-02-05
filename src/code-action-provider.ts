import * as vscode from 'vscode';
import type { ImportIssue, ImportCategory } from './types';
import { validateImports, parseImports, getImportCategory } from './import-validator';

/**
 * Provides code actions (quick fixes) for import validation issues.
 */
export class ImportCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.Source.append('sortImports'),
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
        const actions: vscode.CodeAction[] = [];

        // Get cached issues for this document
        const issues = this.issueCache.get(document.uri.toString()) ?? [];

        // Find issues that overlap with the current selection/range
        const relevantIssues = issues.filter(issue =>
            issue.range.intersection(range) !== undefined
        );

        for (const issue of relevantIssues) {
            const action = this.createFixAction(document, issue);
            if (action) {
                actions.push(action);
            }
        }

        // Also check context diagnostics for issues we can fix
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'Important') {
                const matchingIssue = issues.find(i =>
                    i.code === diagnostic.code &&
                    i.range.isEqual(diagnostic.range)
                );
                if (matchingIssue && !relevantIssues.includes(matchingIssue)) {
                    const action = this.createFixAction(document, matchingIssue);
                    if (action) {
                        actions.push(action);
                    }
                }
            }
        }

        // Add "Sort all imports" action if there are ordering issues
        const hasOrderingIssues = issues.some(
            i => i.code === 'wrong-import-order' || i.code === 'wrong-alphabetical-order'
        );
        if (hasOrderingIssues) {
            const sortAction = this.createSortImportsAction(document);
            if (sortAction) {
                actions.push(sortAction);
            }
        }

        return actions.length > 0 ? actions : undefined;
    }

    private createFixAction(
        document: vscode.TextDocument,
        issue: ImportIssue
    ): vscode.CodeAction | undefined {
        switch (issue.code) {
            case 'no-relative-imports':
                return this.createRelativeImportFix(document, issue);
            case 'no-multiple-imports':
                return this.createMultipleImportsFix(document, issue);
            case 'import-modules-not-symbols':
                return this.createModuleImportFix(document, issue);
            case 'unused-import':
                return this.createUnusedImportFix(document, issue);
            default:
                return undefined;
        }
    }

    private createUnusedImportFix(
        document: vscode.TextDocument,
        issue: ImportIssue
    ): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            'Remove unused import',
            vscode.CodeActionKind.QuickFix
        );

        fix.diagnostics = [this.issueToDiagnostic(issue)];
        fix.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();

        if (issue.suggestedFix === '') {
            // Delete the entire line (including the newline)
            const lineRange = document.lineAt(issue.import.line).rangeIncludingLineBreak;
            edit.delete(document.uri, lineRange);
        } else if (issue.suggestedFix) {
            // Replace with the fixed import (some names removed)
            edit.replace(document.uri, issue.range, issue.suggestedFix);
        }

        fix.edit = edit;
        return fix;
    }

    private createRelativeImportFix(
        document: vscode.TextDocument,
        issue: ImportIssue
    ): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            'Convert to absolute import',
            vscode.CodeActionKind.QuickFix
        );

        fix.diagnostics = [this.issueToDiagnostic(issue)];
        fix.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();

        // Remove the leading dots from the import
        // Note: A full implementation would need to resolve the absolute module path
        const suggestedFix = issue.suggestedFix ?? issue.import.text.replace(/^from\s+\.+/, 'from ');
        edit.replace(document.uri, issue.range, suggestedFix);

        fix.edit = edit;
        return fix;
    }

    private createMultipleImportsFix(
        document: vscode.TextDocument,
        issue: ImportIssue
    ): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            'Split into separate imports',
            vscode.CodeActionKind.QuickFix
        );

        fix.diagnostics = [this.issueToDiagnostic(issue)];
        fix.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();

        // Split 'import a, b, c' into separate lines
        const suggestedFix = issue.suggestedFix ??
            issue.import.names.map(n => `import ${n}`).join('\n');

        edit.replace(document.uri, issue.range, suggestedFix);

        fix.edit = edit;
        return fix;
    }

    private createModuleImportFix(
        document: vscode.TextDocument,
        issue: ImportIssue
    ): vscode.CodeAction {
        const fix = new vscode.CodeAction(
            'Import module instead of symbols',
            vscode.CodeActionKind.QuickFix
        );

        fix.diagnostics = [this.issueToDiagnostic(issue)];
        fix.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();

        // Get the module name from the import path
        // e.g., 'sample_project.client' -> 'client'
        const moduleParts = issue.import.module.split('.');
        const moduleName = moduleParts[moduleParts.length - 1];
        const parentPackage = moduleParts.slice(0, -1).join('.');

        // Replace the import statement
        const newImport = `from ${parentPackage} import ${moduleName}`;
        edit.replace(document.uri, issue.range, newImport);

        // Find and replace all symbol references in the document
        const documentText = document.getText();
        const importedSymbols = issue.import.names;

        for (const symbol of importedSymbols) {
            // Find all occurrences of the symbol (as a word boundary match)
            // We need to be careful to only match the symbol as a standalone identifier
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

                // Skip if this is in a string literal or comment
                const lineText = document.lineAt(matchStart.line).text;
                const beforeMatch = lineText.substring(0, matchStart.character);

                // Simple heuristic: skip if we're likely in a string or comment
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

                // Replace symbol with module.symbol
                edit.replace(document.uri, matchRange, `${moduleName}.${symbol}`);
            }
        }

        fix.edit = edit;
        return fix;
    }

    private issueToDiagnostic(issue: ImportIssue): vscode.Diagnostic {
        const diagnostic = new vscode.Diagnostic(
            issue.range,
            issue.message,
            issue.severity
        );
        diagnostic.code = issue.code;
        diagnostic.source = 'Important';
        return diagnostic;
    }

    /**
     * Creates a code action to sort all imports according to Google style.
     * This also expands multi-imports (import a, b, c) into separate lines and removes unused imports.
     */
    private createSortImportsAction(
        document: vscode.TextDocument
    ): vscode.CodeAction | undefined {
        const imports = parseImports(document);
        if (imports.length === 0) {
            return undefined;
        }

        const fix = new vscode.CodeAction(
            'Sort imports (Google style)',
            vscode.CodeActionKind.Source.append('sortImports')
        );
        fix.isPreferred = true;

        const documentText = document.getText();

        // Helper to check if a name is used in the document
        const isNameUsed = (name: string, importLine: number): boolean => {
            const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            let match;
            while ((match = pattern.exec(documentText)) !== null) {
                const pos = document.positionAt(match.index);
                if (pos.line === importLine) continue;
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
                expandedImports.push({
                    module: imp.module,
                    type: imp.type,
                    names: [...imp.names],
                    category,
                    originalLine: imp.line,
                });
            } else {
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

        // Find the range covering all import lines (but only the actual import lines)
        const importLines = imports.map(i => i.line);
        const firstImportLine = Math.min(...importLines);

        // Find the last import line, accounting for multiline imports
        let lastImportLine = firstImportLine;
        for (const imp of imports) {
            const endLine = imp.line + (imp.text.split('\n').length - 1);
            if (endLine > lastImportLine) {
                lastImportLine = endLine;
            }
        }

        // Build a set of lines that contain imports
        const importLineNumbers = new Set<number>();
        for (const imp of imports) {
            const lineCount = imp.text.split('\n').length;
            for (let l = imp.line; l < imp.line + lineCount; l++) {
                importLineNumbers.add(l);
            }
        }

        // Find contiguous ranges of non-import lines (comments) between imports
        // For simplicity, we'll replace from first to last import line
        // but acknowledge that inter-import comments will be lost

        const startPos = new vscode.Position(firstImportLine, 0);
        const endPos = new vscode.Position(lastImportLine, document.lineAt(lastImportLine).text.length);
        const importRange = new vscode.Range(startPos, endPos);

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, importRange, sortedImportsText);

        fix.edit = edit;
        return fix;
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
