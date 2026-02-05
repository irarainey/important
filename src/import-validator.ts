import * as vscode from 'vscode';
import type { ImportStatement, ImportIssue, ImportCategory } from './types';
import { isStdlibModule } from './stdlib-modules';

/**
 * Parses a single line of Python code to extract import information.
 */
export function parseImportLine(line: string, lineNumber: number): ImportStatement | undefined {
    const trimmed = line.trim();

    // Skip empty lines, comments, and non-import statements
    if (!trimmed || trimmed.startsWith('#')) {
        return undefined;
    }

    // Match 'from X import Y' style
    const fromMatch = trimmed.match(/^from\s+(\.*)(\S*)\s+import\s+(.+)$/);
    if (fromMatch) {
        const dots = fromMatch[1];
        const module = fromMatch[2];
        const namesStr = fromMatch[3];
        const names = namesStr.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());

        return {
            type: 'from',
            module: dots + module,
            names,
            level: dots.length,
            line: lineNumber,
            text: trimmed,
        };
    }

    // Match 'import X' style
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
        const modulesStr = importMatch[1];
        const modules = modulesStr.split(',').map(m => m.trim().split(/\s+as\s+/)[0].trim());

        return {
            type: 'import',
            module: modules[0],
            names: modules,
            level: 0,
            line: lineNumber,
            text: trimmed,
        };
    }

    return undefined;
}

/**
 * Parses a multiline import statement (with parentheses).
 * Returns the parsed statement and the ending line number.
 */
function parseMultilineImport(
    document: vscode.TextDocument,
    startLine: number
): { import: ImportStatement; endLine: number } | undefined {
    const firstLine = document.lineAt(startLine).text.trim();

    // Check for 'from X import (' pattern
    const fromMatch = firstLine.match(/^from\s+(\.*)(\S*)\s+import\s+\((.*)$/);
    if (!fromMatch) {
        return undefined;
    }

    const dots = fromMatch[1];
    const module = fromMatch[2];
    let namesStr = fromMatch[3];
    let endLine = startLine;
    let fullText = document.lineAt(startLine).text;

    // Collect names from subsequent lines until we find ')'
    for (let i = startLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        fullText += '\n' + line;
        endLine = i;

        // Check if this line contains the closing paren
        const closingIndex = line.indexOf(')');
        if (closingIndex !== -1) {
            namesStr += line.substring(0, closingIndex);
            break;
        } else {
            namesStr += line;
        }
    }

    // Parse the collected names
    const names = namesStr
        .split(',')
        .map(n => n.trim().split(/\s+as\s+/)[0].trim())
        .filter(n => n.length > 0 && n !== ')');

    return {
        import: {
            type: 'from',
            module: dots + module,
            names,
            level: dots.length,
            line: startLine,
            text: fullText.trim(),
        },
        endLine,
    };
}

/**
 * Parses all import statements from a document.
 */
export function parseImports(document: vscode.TextDocument): ImportStatement[] {
    const imports: ImportStatement[] = [];
    let i = 0;

    while (i < document.lineCount) {
        const line = document.lineAt(i).text;

        // Check for multiline import (contains 'import (' without closing ')')
        if (line.includes('import (') && !line.includes(')')) {
            const multiline = parseMultilineImport(document, i);
            if (multiline) {
                imports.push(multiline.import);
                i = multiline.endLine + 1;
                continue;
            }
        }

        // Try single-line parsing
        const parsed = parseImportLine(line, i);
        if (parsed) {
            imports.push(parsed);
        }
        i++;
    }

    return imports;
}

/**
 * Determines the category of an import for grouping purposes.
 */
export function getImportCategory(importStmt: ImportStatement): ImportCategory {
    // Relative imports are always local
    if (importStmt.level > 0) {
        return 'local';
    }

    if (isStdlibModule(importStmt.module)) {
        return 'stdlib';
    }

    // For now, treat everything else as third-party
    // A full implementation would check against the project structure
    return 'third-party';
}

/**
 * Finds names from an import statement that are not used in the document.
 */
function findUnusedNames(document: vscode.TextDocument, imp: ImportStatement): string[] {
    const documentText = document.getText();
    const unusedNames: string[] = [];

    // For 'import X' style, check if X is used (as X.something or just X)
    if (imp.type === 'import') {
        for (const name of imp.names) {
            // Create regex to find usage of the module name
            const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
            let usageCount = 0;

            let match;
            while ((match = pattern.exec(documentText)) !== null) {
                const pos = document.positionAt(match.index);

                // Skip if this is on the import line itself
                if (pos.line === imp.line) {
                    continue;
                }

                // Skip if in a comment
                const lineText = document.lineAt(pos.line).text;
                const beforeMatch = lineText.substring(0, pos.character);
                if (beforeMatch.includes('#')) {
                    continue;
                }

                usageCount++;
            }

            if (usageCount === 0) {
                unusedNames.push(name);
            }
        }
    } else {
        // For 'from X import Y' style, check if Y is used
        for (const name of imp.names) {
            if (name === '*') continue;

            const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
            let usageCount = 0;

            let match;
            while ((match = pattern.exec(documentText)) !== null) {
                const pos = document.positionAt(match.index);

                // Skip if this is on the import line itself
                if (pos.line === imp.line) {
                    continue;
                }

                // Skip if in a comment
                const lineText = document.lineAt(pos.line).text;
                const beforeMatch = lineText.substring(0, pos.character);
                if (beforeMatch.includes('#')) {
                    continue;
                }

                usageCount++;
            }

            if (usageCount === 0) {
                unusedNames.push(name);
            }
        }
    }

    return unusedNames;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates import statements according to Google Python Style Guide rules.
 */
export function validateImports(document: vscode.TextDocument): ImportIssue[] {
    const issues: ImportIssue[] = [];
    const imports = parseImports(document);

    for (const imp of imports) {
        // Rule 1: No relative imports
        if (imp.level > 0) {
            issues.push({
                code: 'no-relative-imports',
                message: 'Relative imports are not allowed (Google Python Style Guide). Use absolute imports instead.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                import: imp,
                suggestedFix: imp.text.replace(/^from\s+\.+/, 'from '),
            });
        }

        // Rule 2: No wildcard imports
        if (imp.type === 'from' && imp.names.includes('*')) {
            issues.push({
                code: 'no-wildcard-imports',
                message: 'Wildcard imports are not allowed (Google Python Style Guide). Import specific names instead.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                import: imp,
            });
        }

        // Rule 3: No multiple imports on one line (for 'import X, Y' style)
        if (imp.type === 'import' && imp.names.length > 1) {
            issues.push({
                code: 'no-multiple-imports',
                message: 'Multiple imports on one line are not allowed (Google Python Style Guide). Use separate import statements.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                import: imp,
                suggestedFix: imp.names.map(n => `import ${n}`).join('\n'),
            });
        }

        // Rule 4: Import modules, not symbols (for non-stdlib 'from x.y import Z' style)
        // Google style prefers: from package import module, then use module.Symbol
        if (imp.type === 'from' && imp.level === 0 && !imp.names.includes('*')) {
            const moduleParts = imp.module.split('.');
            // Only flag if it's a deep import (has dots) and not stdlib
            if (moduleParts.length >= 2 && !isStdlibModule(imp.module)) {
                const parentPackage = moduleParts.slice(0, -1).join('.');
                const moduleName = moduleParts[moduleParts.length - 1];

                issues.push({
                    code: 'import-modules-not-symbols',
                    message: `Import modules, not symbols (Google Python Style Guide). Use 'from ${parentPackage} import ${moduleName}' and access as '${moduleName}.${imp.names[0]}'.`,
                    severity: vscode.DiagnosticSeverity.Information,
                    range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                    import: imp,
                    suggestedFix: `from ${parentPackage} import ${moduleName}`,
                });
            }
        }

        // Rule 7: Check for unused imports
        const unusedNames = findUnusedNames(document, imp);
        if (unusedNames.length > 0 && !imp.names.includes('*')) {
            if (unusedNames.length === imp.names.length) {
                // All names are unused - entire import is unused
                issues.push({
                    code: 'unused-import',
                    message: `Unused import: ${imp.type === 'import' ? imp.module : unusedNames.join(', ')}`,
                    severity: vscode.DiagnosticSeverity.Hint,
                    range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                    import: imp,
                    suggestedFix: '', // Empty means delete the line
                });
            } else if (imp.type === 'from') {
                // Some names are unused - suggest removing just those
                const usedNames = imp.names.filter(n => !unusedNames.includes(n));
                issues.push({
                    code: 'unused-import',
                    message: `Unused import: ${unusedNames.join(', ')}`,
                    severity: vscode.DiagnosticSeverity.Hint,
                    range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                    import: imp,
                    suggestedFix: `from ${imp.module} import ${usedNames.join(', ')}`,
                });
            }
        }
    }

    // Rule 5: Check import ordering (stdlib → third-party → local)
    const categoryOrder: ImportCategory[] = ['stdlib', 'third-party', 'local'];
    let lastCategory: ImportCategory | undefined;

    for (const imp of imports) {
        const category = getImportCategory(imp);
        const currentCategoryIndex = categoryOrder.indexOf(category);
        const lastCategoryIndex = lastCategory ? categoryOrder.indexOf(lastCategory) : -1;

        if (lastCategory && currentCategoryIndex < lastCategoryIndex) {
            issues.push({
                code: 'wrong-import-order',
                message: `Import ordering violation: ${category} imports should come before ${lastCategory} imports (Google Python Style Guide).`,
                severity: vscode.DiagnosticSeverity.Information,
                range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                import: imp,
            });
        }

        if (category !== lastCategory) {
            lastCategory = category;
        }
    }

    // Rule 6: Check alphabetical ordering within groups
    let currentGroupCategory: ImportCategory | undefined;
    let currentGroupImports: ImportStatement[] = [];

    for (const imp of imports) {
        const category = getImportCategory(imp);

        if (category !== currentGroupCategory) {
            // Check alphabetical order of previous group
            checkAlphabeticalOrder(currentGroupImports, issues);
            currentGroupCategory = category;
            currentGroupImports = [imp];
        } else {
            currentGroupImports.push(imp);
        }
    }
    // Check the last group
    checkAlphabeticalOrder(currentGroupImports, issues);

    return issues;
}

/**
 * Checks if imports within a group are alphabetically ordered.
 */
function checkAlphabeticalOrder(imports: ImportStatement[], issues: ImportIssue[]): void {
    for (let i = 1; i < imports.length; i++) {
        const prev = imports[i - 1];
        const current = imports[i];

        const prevModule = prev.module.toLowerCase();
        const currentModule = current.module.toLowerCase();

        if (currentModule < prevModule) {
            issues.push({
                code: 'wrong-alphabetical-order',
                message: `Import '${current.module}' should come before '${prev.module}' (alphabetical ordering).`,
                severity: vscode.DiagnosticSeverity.Information,
                range: new vscode.Range(current.line, 0, current.line, current.text.length),
                import: current,
            });
        }
    }
}

/**
 * Converts ImportIssues to VS Code Diagnostics.
 */
export function issuesToDiagnostics(issues: readonly ImportIssue[]): vscode.Diagnostic[] {
    return issues.map(issue => {
        const diagnostic = new vscode.Diagnostic(
            issue.range,
            issue.message,
            issue.severity
        );
        diagnostic.code = issue.code;
        diagnostic.source = 'Important';
        return diagnostic;
    });
}
