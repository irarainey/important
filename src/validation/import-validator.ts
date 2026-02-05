import * as vscode from 'vscode';
import type { ImportStatement, ImportIssue, ImportCategory } from '../types';
import { isStdlibModule } from '../utils/stdlib-modules';
import { escapeRegex } from '../utils/text-utils';
import { parseImports } from './import-parser';

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
 * Checks if a name is used anywhere in the document outside the given line.
 */
function isNameUsedInDocument(document: vscode.TextDocument, name: string, excludeLine: number): boolean {
    const documentText = document.getText();
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');

    let match;
    while ((match = pattern.exec(documentText)) !== null) {
        const pos = document.positionAt(match.index);

        // Skip if this is on the excluded line (import line)
        if (pos.line === excludeLine) {
            continue;
        }

        // Skip if in a comment
        const lineText = document.lineAt(pos.line).text;
        const beforeMatch = lineText.substring(0, pos.character);
        if (beforeMatch.includes('#')) {
            continue;
        }

        return true;
    }

    return false;
}

/**
 * Finds names from an import statement that are not used in the document.
 */
function findUnusedNames(document: vscode.TextDocument, imp: ImportStatement): string[] {
    return imp.names.filter(name => {
        if (name === '*') return false;
        return !isNameUsedInDocument(document, name, imp.line);
    });
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
