import * as vscode from 'vscode';
import type { ImportStatement, ImportIssue, ImportCategory } from '../types';
import { CATEGORY_ORDER } from '../types';
import { isStdlibModule } from '../utils/stdlib-modules';
import { escapeRegex, isNameUsedOutsideLines } from '../utils/text-utils';
import { isWorkspaceModule, isModuleFile, isLocalModule, isFirstPartyModule } from '../utils/module-resolver';
import { parseImports } from './import-parser';

/** Modules exempt from Rule 4 (import-modules-not-symbols) per Google style 2.2.4.1. */
const SYMBOL_IMPORT_EXEMPTIONS = ['typing', 'typing_extensions', 'collections.abc', 'six.moves'] as const;

/**
 * Well-known standard abbreviations for `import y as z` (Google style 2.2.4).
 *
 * Only these aliases are accepted without a warning. The map is keyed by
 * the full module name; the value is the conventional short alias.
 */
const STANDARD_IMPORT_ALIASES: ReadonlyMap<string, string> = new Map([
    ['numpy', 'np'],
    ['pandas', 'pd'],
    ['matplotlib', 'mpl'],
    ['matplotlib.pyplot', 'plt'],
    ['seaborn', 'sns'],
    ['tensorflow', 'tf'],
    ['scipy', 'sp'],
    ['polars', 'pl'],
    ['networkx', 'nx'],
    ['sqlalchemy', 'sa'],
    ['datetime', 'dt'],
]);

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

/**
 * Builds a Range that spans the full extent of an import statement,
 * correctly covering multi-line imports (those using parentheses).
 */
function importRange(document: vscode.TextDocument, imp: ImportStatement): vscode.Range {
    const endLineText = document.lineAt(imp.endLine).text;
    return new vscode.Range(imp.line, 0, imp.endLine, endLineText.length);
}

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
 * Builds a set of line numbers covered by an import statement.
 */
function importLineSet(imp: ImportStatement): Set<number> {
    const lines = new Set<number>();
    for (let line = imp.line; line <= imp.endLine; line++) {
        lines.add(line);
    }
    return lines;
}

/**
 * Finds names from an import statement that are not used in the document.
 * When a name has an alias (`as` clause), the alias is checked for usage
 * instead of the original name.
 */
function findUnusedNames(document: vscode.TextDocument, documentText: string, imp: ImportStatement): string[] {
    const excludeLines = importLineSet(imp);
    return imp.names.filter(name => {
        if (name === '*') return false;
        const usageName = imp.aliases.get(name) ?? name;
        return !isNameUsedOutsideLines(document, documentText, usageName, excludeLines);
    });
}

/**
 * Validates import statements according to Google Python Style Guide rules.
 */
export function validateImports(document: vscode.TextDocument): ImportIssue[] {
    const issues: ImportIssue[] = [];
    const imports = parseImports(document);
    const documentText = document.getText();

    // Cache import categories — avoids recomputing in Rules 5 and 6
    const categoryCache = new Map<ImportStatement, ImportCategory>();
    for (const imp of imports) {
        categoryCache.set(imp, getImportCategory(imp, document.uri));
    }

    for (const imp of imports) {
        // Rule 1: No relative imports
        if (imp.level > 0) {
            issues.push({
                code: 'no-relative-imports',
                message: 'Relative imports are not allowed (Google Python Style Guide). Use absolute imports instead.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: importRange(document, imp),
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
                range: importRange(document, imp),
                import: imp,
            });
        }

        // Rule 3: No multiple imports on one line (for 'import X, Y' style)
        if (imp.type === 'import' && imp.names.length > 1) {
            issues.push({
                code: 'no-multiple-imports',
                message: 'Multiple imports on one line are not allowed (Google Python Style Guide). Use separate import statements.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: importRange(document, imp),
                import: imp,
                suggestedFix: imp.names.map(n => `import ${n}`).join('\n'),
            });
        }

        // Rule 4: Import modules, not symbols (for non-stdlib 'from x.y import Z' style)
        // Google style prefers: import module, then use module.Symbol
        // or: from package import module, then use module.Symbol
        // Exemptions per 2.2.4.1: typing, collections.abc, typing_extensions
        const isExempt = SYMBOL_IMPORT_EXEMPTIONS.some(
            exempt => imp.module === exempt || imp.module.startsWith(`${exempt}.`)
        );

        if (imp.type === 'from' && imp.level === 0 && !imp.names.includes('*') && !isExempt) {
            const moduleParts = imp.module.split('.');

            // Definitive filesystem check: if the module path resolves to
            // an actual .py file, then everything imported from it is
            // certainly a symbol — a .py file cannot contain sub-modules.
            // Skip the heuristics and treat as a symbol import.
            const confirmedSymbolImport = isModuleFile(imp.module);

            // Determine whether the imported names are symbols (classes,
            // functions, constants) rather than sub-modules.  We combine
            // checks – any one passing means "this is a module import,
            // don't flag it":
            //
            //  1. Workspace filesystem: a matching .py file or package exists
            //     for the imported name itself.
            //  2. Usage pattern: the name is used with dot access (name.attr),
            //     which strongly indicates module-like usage.  Only applies
            //     to snake_case names (Python module convention).
            const isModuleImport = !confirmedSymbolImport && imp.names.some(name => {
                // Filesystem check: does a .py file or package exist?
                if (moduleParts.length >= 2 && isWorkspaceModule(imp.module, name)) {
                    return true;
                }

                // Dot-access check: is the name used with dot access?
                // Only applies to snake_case names (Python module convention).
                // PascalCase names are almost certainly classes/types whose
                // dot access (e.g. Config.from_dict()) should not suppress
                // the violation.
                const isPascalCase = /^[A-Z]/.test(name);
                if (!isPascalCase) {
                    const dotAccessPattern = new RegExp(`\\b${escapeRegex(name)}\\.\\w`, 'g');
                    let dotMatch;
                    while ((dotMatch = dotAccessPattern.exec(documentText)) !== null) {
                        const pos = document.positionAt(dotMatch.index);
                        if (pos.line >= imp.line && pos.line <= imp.endLine) continue;
                        const lineText = document.lineAt(pos.line).text;
                        const beforeText = lineText.substring(0, pos.character);
                        if (beforeText.includes('#')) continue;
                        return true;
                    }
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
                        range: importRange(document, imp),
                        import: imp,
                        suggestedFix: `from ${parentPackage} import ${moduleName}`,
                    });
                } else {
                    // Top-level module: from fastmcp import FastMCP → import fastmcp
                    issues.push({
                        code: 'import-modules-not-symbols',
                        message: `Import modules, not symbols (Google Python Style Guide). Use 'import ${imp.module}' and access as '${imp.module}.${imp.names[0]}'.`,
                        severity: vscode.DiagnosticSeverity.Information,
                        range: importRange(document, imp),
                        import: imp,
                        suggestedFix: `import ${imp.module}`,
                    });
                }
            }
        }

        // Rule 8: Validate `import y as z` aliases (Google style 2.2.4)
        // Only standard abbreviations are permitted for plain import aliases.
        if (imp.type === 'import' && imp.aliases.size > 0) {
            for (const [original, alias] of imp.aliases) {
                const standardAlias = STANDARD_IMPORT_ALIASES.get(original);
                if (standardAlias !== alias) {
                    const hint = standardAlias
                        ? `The standard alias for '${original}' is '${standardAlias}'.`
                        : `No standard abbreviation is known for '${original}'.`;
                    issues.push({
                        code: 'non-standard-import-alias',
                        message: `'import ${original} as ${alias}' uses a non-standard alias (Google Python Style Guide). ${hint}`,
                        severity: vscode.DiagnosticSeverity.Information,
                        range: importRange(document, imp),
                        import: imp,
                        suggestedFix: standardAlias ? `import ${original} as ${standardAlias}` : `import ${original}`,
                    });
                }
            }
        }

        // Rule 9: Validate `from x import y as z` aliases (Google style 2.2.4)
        // Aliasing should only be used when a naming conflict or length
        // warrants it.  We can automatically detect duplicate-name conflicts
        // across the file's imports; the remaining conditions are subjective
        // so we flag any alias that has no detectable justification.
        if (imp.type === 'from' && imp.aliases.size > 0) {
            // Collect all imported names across every import in this file
            // to check for duplicate-name conflicts.
            const allImportedNames = new Set<string>();
            for (const other of imports) {
                if (other === imp) continue;
                for (const n of other.names) {
                    allImportedNames.add(n);
                }
            }

            for (const [original, alias] of imp.aliases) {
                // Allow if another import brings in the same name (conflict)
                if (allImportedNames.has(original)) {
                    continue;
                }
                issues.push({
                    code: 'unnecessary-from-alias',
                    message: `'from ${imp.module} import ${original} as ${alias}' — aliasing should only be used when two imports share the same name, or the name conflicts with a local definition, is inconveniently long, or is too generic (Google Python Style Guide).`,
                    severity: vscode.DiagnosticSeverity.Information,
                    range: importRange(document, imp),
                    import: imp,
                });
            }
        }

        // Rule 7: Check for unused imports
        // Skip __future__ imports — their names are directives, not symbols
        const unusedNames = imp.module === '__future__' ? [] : findUnusedNames(document, documentText, imp);
        if (unusedNames.length > 0 && !imp.names.includes('*')) {
            if (unusedNames.length === imp.names.length) {
                // All names are unused - entire import is unused
                issues.push({
                    code: 'unused-import',
                    message: `Unused import: ${imp.type === 'import' ? imp.module : unusedNames.join(', ')}`,
                    severity: vscode.DiagnosticSeverity.Hint,
                    range: importRange(document, imp),
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
                    range: importRange(document, imp),
                    import: imp,
                    suggestedFix: `from ${imp.module} import ${usedNames.join(', ')}`,
                });
            }
        }
    }

    // Rule 5: Check import ordering (__future__ → stdlib → third-party → first-party → local)
    let lastCategory: ImportCategory | undefined;

    for (const imp of imports) {
        const category = categoryCache.get(imp)!;
        const currentCategoryIndex = CATEGORY_ORDER.indexOf(category);
        const lastCategoryIndex = lastCategory ? CATEGORY_ORDER.indexOf(lastCategory) : -1;

        if (lastCategory && currentCategoryIndex < lastCategoryIndex) {
            issues.push({
                code: 'wrong-import-order',
                message: `Import ordering violation: ${category} imports should come before ${lastCategory} imports (Google Python Style Guide).`,
                severity: vscode.DiagnosticSeverity.Information,
                range: importRange(document, imp),
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
        const category = categoryCache.get(imp)!;

        if (category !== currentGroupCategory) {
            // Check alphabetical order of previous group
            checkAlphabeticalOrder(document, currentGroupImports, issues);
            currentGroupCategory = category;
            currentGroupImports = [imp];
        } else {
            currentGroupImports.push(imp);
        }
    }
    // Check the last group
    checkAlphabeticalOrder(document, currentGroupImports, issues);

    return issues;
}

/**
 * Checks if imports within a group are sorted correctly:
 * `import` statements before `from` statements, then alphabetically
 * by module path within each sub-group (ignoring case).
 *
 * This matches Ruff/isort default behaviour (force_sort_within_sections = false).
 */
function checkAlphabeticalOrder(document: vscode.TextDocument, imports: ImportStatement[], issues: ImportIssue[]): void {
    for (let i = 1; i < imports.length; i++) {
        const prev = imports[i - 1];
        const current = imports[i];

        // `import` statements must come before `from` statements
        if (prev.type === 'from' && current.type === 'import') {
            issues.push({
                code: 'wrong-alphabetical-order',
                message: `'import ${current.module}' should come before 'from' imports (import statements first).`,
                severity: vscode.DiagnosticSeverity.Information,
                range: importRange(document, current),
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
                    range: importRange(document, current),
                    import: current,
                });
            }
        }
    }
}
