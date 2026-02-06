import * as vscode from 'vscode';
import type { ImportStatement, ImportIssue, ImportCategory } from '../types';
import { isStdlibModule } from '../utils/stdlib-modules';
import { escapeRegex } from '../utils/text-utils';
import { isWorkspaceModule, isLocalModule, isFirstPartyModule } from '../utils/module-resolver';
import { parseImports } from './import-parser';

/**
 * Determines the category of an import for grouping purposes.
 *
 * Categories (Google Python Style Guide section 3.13 + Ruff first-party):
 *  1. future      — `from __future__ import …`
 *  2. stdlib      — Python standard library modules
 *  3. third-party — installed packages (pip, etc.)
 *  4. first-party — explicitly configured project modules
 *  5. local       — relative imports & workspace-detected modules
 */
export function getImportCategory(importStmt: ImportStatement, documentUri?: vscode.Uri): ImportCategory {
    // __future__ imports always come first (Google style 3.13)
    if (importStmt.module === '__future__') {
        return 'future';
    }

    // Relative imports are always local
    if (importStmt.level > 0) {
        return 'local';
    }

    if (isStdlibModule(importStmt.module)) {
        return 'stdlib';
    }

    // Check whether the module is explicitly configured as first-party
    if (isFirstPartyModule(importStmt.module, documentUri)) {
        return 'first-party';
    }

    // Check whether the root package exists in the workspace filesystem
    if (isLocalModule(importStmt.module)) {
        return 'local';
    }

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
        // Google style prefers: import module, then use module.Symbol
        // or: from package import module, then use module.Symbol
        // Exemptions per 2.2.4.1: typing, collections.abc, typing_extensions
        const SYMBOL_IMPORT_EXEMPTIONS = ['typing', 'typing_extensions', 'collections.abc'];
        const isExempt = SYMBOL_IMPORT_EXEMPTIONS.some(
            exempt => imp.module === exempt || imp.module.startsWith(`${exempt}.`)
        );

        if (imp.type === 'from' && imp.level === 0 && !imp.names.includes('*') && !isStdlibModule(imp.module) && !isExempt) {
            const moduleParts = imp.module.split('.');

            // Determine whether the imported names are symbols (classes,
            // functions, constants) rather than sub-modules.  We combine
            // checks – any one passing means "this is a module import,
            // don't flag it":
            //
            //  1. Workspace filesystem: a matching .py file or package exists.
            //  2. Usage pattern: the name is used with dot access (name.attr),
            //     which strongly indicates module-like usage.  Combined with
            //     snake_case naming (Python module convention) this is a
            //     reliable signal.
            const documentText = document.getText();
            const isModuleImport = imp.names.some(name => {
                // Filesystem check: does a .py file or package exist?
                if (moduleParts.length >= 2 && isWorkspaceModule(imp.module, name)) {
                    return true;
                }

                // Dot-access check: is the name used with dot access?
                // For snake_case names this is a strong module signal.
                const dotAccessPattern = new RegExp(`\\b${escapeRegex(name)}\\.\\w`, 'g');
                let dotMatch;
                while ((dotMatch = dotAccessPattern.exec(documentText)) !== null) {
                    const pos = document.positionAt(dotMatch.index);
                    if (pos.line === imp.line) continue;
                    const lineText = document.lineAt(pos.line).text;
                    const beforeText = lineText.substring(0, pos.character);
                    if (beforeText.includes('#')) continue;
                    return true;
                }
                return false;
            });

            if (!isModuleImport) {
                if (moduleParts.length >= 2) {
                    // Deep import: from x.y import Symbol → from x import y
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
                } else {
                    // Top-level module: from fastmcp import FastMCP → import fastmcp
                    issues.push({
                        code: 'import-modules-not-symbols',
                        message: `Import modules, not symbols (Google Python Style Guide). Use 'import ${imp.module}' and access as '${imp.module}.${imp.names[0]}'.`,
                        severity: vscode.DiagnosticSeverity.Information,
                        range: new vscode.Range(imp.line, 0, imp.line, imp.text.length),
                        import: imp,
                        suggestedFix: `import ${imp.module}`,
                    });
                }
            }
        }

        // Rule 7: Check for unused imports
        // Skip __future__ imports — their names are directives, not symbols
        const unusedNames = imp.module === '__future__' ? [] : findUnusedNames(document, imp);
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

    // Rule 5: Check import ordering (__future__ → stdlib → third-party → first-party → local)
    const categoryOrder: ImportCategory[] = ['future', 'stdlib', 'third-party', 'first-party', 'local'];
    let lastCategory: ImportCategory | undefined;

    for (const imp of imports) {
        const category = getImportCategory(imp, document.uri);
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
        const category = getImportCategory(imp, document.uri);

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
 * Checks if imports within a group are sorted correctly:
 * `import` statements before `from` statements, then alphabetically
 * by module path within each sub-group (ignoring case).
 *
 * This matches Ruff/isort default behaviour (force_sort_within_sections = false).
 */
function checkAlphabeticalOrder(imports: ImportStatement[], issues: ImportIssue[]): void {
    for (let i = 1; i < imports.length; i++) {
        const prev = imports[i - 1];
        const current = imports[i];

        // `import` statements must come before `from` statements
        if (prev.type === 'from' && current.type === 'import') {
            issues.push({
                code: 'wrong-alphabetical-order',
                message: `'import ${current.module}' should come before 'from' imports (import statements first).`,
                severity: vscode.DiagnosticSeverity.Information,
                range: new vscode.Range(current.line, 0, current.line, current.text.length),
                import: current,
            });
            continue;
        }

        // Within the same type sub-group, sort alphabetically
        if (prev.type === current.type) {
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
}
