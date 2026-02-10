import * as vscode from 'vscode';
import type { ImportStatement, ImportIssue, ImportCategory, ValidationResult } from '../types';
import { CATEGORY_ORDER } from '../types';
import { isStdlibModule } from '../utils/stdlib-modules';
import { STANDARD_IMPORT_ALIASES } from '../utils/standard-aliases';
import { escapeRegex, isInStringOrComment, isNameUsedOutsideLines, getMultilineStringLines, isNameAssignedInDocument } from '../utils/text-utils';
import { isWorkspaceModule, isModuleFile, isLocalModule, isFirstPartyModule, resolveRelativeImport } from '../utils/module-resolver';
import { parseImports } from './import-parser';

/**
 * Modules exempt from Rule 4 (import-modules-not-symbols) per Google style 2.2.4.1.
 * Includes `__future__` because these are compiler directives, not regular imports.
 */
const SYMBOL_IMPORT_EXEMPTIONS = ['__future__', 'typing', 'typing_extensions', 'collections.abc', 'six.moves'] as const;

/**
 * Builds a Range that spans the full extent of an import statement,
 * correctly covering multi-line imports (those using parentheses).
 */
function importRange(document: vscode.TextDocument, imp: ImportStatement): vscode.Range {
    const endLineText = document.lineAt(imp.endLine).text;
    return new vscode.Range(imp.line, 0, imp.endLine, endLineText.length);
}

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
function getImportCategory(importStmt: ImportStatement, documentUri?: vscode.Uri): ImportCategory {
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
 * Finds names from an import statement that are not used in the document.
 *
 * Uses the full set of import line numbers so that a name appearing
 * only inside another import statement is correctly treated as unused.
 * When a name has an alias (`as` clause), the alias is checked for
 * usage instead of the original name.
 */
function findUnusedNames(
    document: vscode.TextDocument,
    documentText: string,
    imp: ImportStatement,
    allImportLines: ReadonlySet<number>,
    multilineStringLines: ReadonlySet<number>,
): string[] {
    return imp.names.filter(name => {
        if (name === '*') return false;
        const usageName = imp.aliases.get(name) ?? name;
        return !isNameUsedOutsideLines(document, documentText, usageName, allImportLines, multilineStringLines);
    });
}

/**
 * Validates import statements according to Google Python Style Guide rules.
 *
 * Returns a {@link ValidationResult} containing parsed imports, their
 * categories, detected issues, and unused-name mappings.  This is the
 * **single scan** that should be consumed by diagnostics, fixes, and
 * the import sorter — ensuring they all operate on the same data.
 */
export function validateImports(document: vscode.TextDocument): ValidationResult {
    const issues: ImportIssue[] = [];
    const imports = parseImports(document);
    const documentText = document.getText();

    // Build the set of ALL import line numbers once — used to exclude
    // import lines from usage checks so that a name appearing only
    // inside another import statement is not treated as "used".
    const importLines = new Set<number>();
    for (const imp of imports) {
        for (let line = imp.line; line <= imp.endLine; line++) {
            importLines.add(line);
        }
    }

    // Compute import categories once — reused across Rules 4, 8, 9
    // and consumed downstream by the sorter and fix commands.
    const categories = new Map<ImportStatement, ImportCategory>();
    for (const imp of imports) {
        categories.set(imp, getImportCategory(imp, document.uri));
    }

    // Pre-compute lines inside multi-line strings (docstrings) so that
    // import-like text and name occurrences inside them are ignored.
    const multilineStringLines = getMultilineStringLines(document);

    // Pre-compute unused names for every import — reused in Rule 7 and
    // by the sorter (which filters unused names when rebuilding the
    // import block).  Using `importLines` (all import lines) ensures
    // consistent results everywhere.
    const unusedNamesMap = new Map<ImportStatement, readonly string[]>();
    for (const imp of imports) {
        if (imp.module === '__future__' || imp.names.includes('*')) {
            // __future__ directives and wildcard imports are never flagged as unused.
            unusedNamesMap.set(imp, []);
        } else {
            unusedNamesMap.set(imp, findUnusedNames(document, documentText, imp, importLines, multilineStringLines));
        }
    }

    // Pre-compute for Rule 6: original name counts and effective namespace
    // names across all imports, for fast conflict detection.  Effective
    // names use the alias (if present) instead of the original name.
    const originalNameCounts = new Map<string, number>();
    const allEffectiveNames = new Set<string>();
    for (const imp of imports) {
        for (const n of imp.names) {
            originalNameCounts.set(n, (originalNameCounts.get(n) ?? 0) + 1);
            allEffectiveNames.add(imp.aliases.get(n) ?? n);
        }
    }

    for (const imp of imports) {
        // Rule 1: No relative imports
        if (imp.level > 0) {
            // Try to resolve the relative import to an absolute module
            // path for a more accurate suggested fix.
            const absoluteModule = resolveRelativeImport(document.uri, imp.level, imp.module);
            const fallbackFix = imp.text.replace(/^from\s+\.+/, 'from ');

            const suggestedFix = absoluteModule
                ? (imp.type === 'from' && imp.names.length > 0
                    ? `from ${absoluteModule} import ${imp.names.map(n => {
                        const alias = imp.aliases.get(n);
                        return alias ? `${n} as ${alias}` : n;
                    }).join(', ')}`
                    : `import ${absoluteModule}`)
                : fallbackFix;

            issues.push({
                code: 'no-relative-imports',
                message: 'Relative imports are not allowed (Google Python Style Guide). Use absolute imports instead.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: importRange(document, imp),
                import: imp,
                suggestedFix,
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
                suggestedFix: imp.names.map(n => {
                    const alias = imp.aliases.get(n);
                    return alias ? `import ${n} as ${alias}` : `import ${n}`;
                }).join('\n'),
            });
        }

        // Rule 4: Import modules, not symbols (for non-stdlib 'from x.y import Z' style)
        // Google style prefers: import module, then use module.Symbol
        // or: from package import module, then use module.Symbol
        // Exemptions per 2.2.4.1: typing, collections.abc, typing_extensions
        // Also exempt inside `if TYPE_CHECKING:` — symbol imports for type
        // annotations are explicitly allowed by the style guide.
        const isExempt = imp.typeCheckingOnly || SYMBOL_IMPORT_EXEMPTIONS.some(
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
            //     to snake_case names for local modules (Python module convention).
            //     For third-party packages (where we can't verify via
            //     the filesystem), dot access is checked for all names
            //     regardless of case, since PascalCase sub-modules like
            //     `PIL.Image` are common in third-party packages.
            const isThirdParty = !isLocalModule(imp.module);
            const isModuleImport = !confirmedSymbolImport && imp.names.some(name => {
                // Filesystem check: does a .py file or package exist?
                if (isWorkspaceModule(imp.module, name)) {
                    return true;
                }

                // Dot-access check: is the name used with dot access?
                // For local (workspace) modules, only applies to snake_case
                // names — PascalCase names are almost certainly classes/types
                // whose dot access (e.g. Config.from_dict()) should not
                // suppress the violation.  For third-party packages, we
                // can't verify the module structure, so dot access is
                // checked for all names regardless of case (e.g.
                // PIL.Image.open() where Image is a sub-module).
                // When the name has an alias (e.g. `import Y as Z`), check
                // the alias for dot-access too — code uses the alias, not
                // the original name.
                const alias = imp.aliases.get(name);
                const namesToCheck = alias ? [name, alias] : [name];
                for (const checkName of namesToCheck) {
                    const isPascalCase = /^[A-Z]/.test(checkName);
                    if (isThirdParty || !isPascalCase) {
                        const dotAccessPattern = new RegExp(`\\b${escapeRegex(checkName)}\\.\\w`, 'g');
                        let dotMatch;
                        while ((dotMatch = dotAccessPattern.exec(documentText)) !== null) {
                            const pos = document.positionAt(dotMatch.index);
                            if (pos.line >= imp.line && pos.line <= imp.endLine) continue;
                            if (multilineStringLines.has(pos.line)) continue;
                            const lineText = document.lineAt(pos.line).text;
                            const beforeText = lineText.substring(0, pos.character);
                            if (isInStringOrComment(beforeText)) continue;
                            return true;
                        }
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

        // Rule 5: Validate `import y as z` aliases (Google style 2.2.4)
        // Only standard abbreviations are permitted for plain import aliases.
        if (imp.type === 'import' && imp.aliases.size > 0) {
            for (const [original, alias] of imp.aliases) {
                const standardAlias = STANDARD_IMPORT_ALIASES.get(original);
                if (standardAlias !== alias) {
                    // Allow if the original name is used as a local variable
                    // (assignment target, loop variable, etc.) — the alias
                    // exists to avoid shadowing the module import.
                    if (isNameAssignedInDocument(document, documentText, original, importLines, multilineStringLines)) {
                        issues.push({
                            code: 'local-name-conflict-alias',
                            message: `'import ${original} as ${alias}' — aliased because '${original}' is used as a local variable.`,
                            severity: vscode.DiagnosticSeverity.Hint,
                            range: importRange(document, imp),
                            import: imp,
                        });
                        continue;
                    }
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

        // Rule 6: Validate `from x import y as z` aliases (Google style 2.2.4)
        // Aliasing should only be used when a naming conflict or length
        // warrants it.  We can automatically detect duplicate-name conflicts
        // across the file's imports; the remaining conditions are subjective
        // so we flag any alias that has no detectable justification.
        if (imp.type === 'from' && imp.aliases.size > 0) {
            for (const [original, alias] of imp.aliases) {
                // Allow if another import also imports a name called `original`
                // (count >= 2 means at least one OTHER import has it too)
                if ((originalNameCounts.get(original) ?? 0) >= 2) {
                    continue;
                }
                // Allow if `original` is an effective namespace name from
                // another import (e.g. `import X as original` makes it taken).
                // This import contributes `alias` (not `original`) to the
                // namespace, so any presence indicates a genuine conflict.
                if (allEffectiveNames.has(original)) {
                    continue;
                }
                // Allow if `original` is used as a local variable
                // (assignment target, loop variable, etc.) — the alias
                // exists to avoid shadowing the module import.
                if (isNameAssignedInDocument(document, documentText, original, importLines, multilineStringLines)) {
                    issues.push({
                        code: 'local-name-conflict-alias',
                        message: `'from ${imp.module} import ${original} as ${alias}' — aliased because '${original}' is used as a local variable.`,
                        severity: vscode.DiagnosticSeverity.Hint,
                        range: importRange(document, imp),
                        import: imp,
                    });
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

        // Rule 7: Check for unused imports (uses pre-computed map)
        const unusedNames = unusedNamesMap.get(imp) ?? [];
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

        // Rule 10: Misplaced import (not in the top-level import block)
        // TYPE_CHECKING imports are exempt — they belong inside their guard block.
        if (imp.misplaced && !imp.typeCheckingOnly) {
            issues.push({
                code: 'misplaced-import',
                message: 'Import should be at the top of the file (Google Python Style Guide). It will be moved when imports are fixed.',
                severity: vscode.DiagnosticSeverity.Warning,
                range: importRange(document, imp),
                import: imp,
            });
        }
    }

    // Rules 8-9 only apply to top-block imports — misplaced imports will
    // be relocated by the sorter, so checking their order is meaningless.
    // TYPE_CHECKING imports are checked separately below.
    const topBlockImports = imports.filter(imp => !imp.misplaced && !imp.typeCheckingOnly);

    // Rule 8: Check import ordering (__future__ → stdlib → third-party → first-party → local)
    let lastCategory: ImportCategory | undefined;

    for (const imp of topBlockImports) {
        const category = categories.get(imp)!;
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

    // Rule 9: Check alphabetical ordering within groups
    let currentGroupCategory: ImportCategory | undefined;
    let currentGroupImports: ImportStatement[] = [];

    for (const imp of topBlockImports) {
        const category = categories.get(imp)!;

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

    // Rules 8-9 also apply within the TYPE_CHECKING block.
    const typeCheckingImports = imports.filter(imp => imp.typeCheckingOnly);
    if (typeCheckingImports.length > 0) {
        // Rule 8 for TYPE_CHECKING block
        let lastTcCategory: ImportCategory | undefined;
        for (const imp of typeCheckingImports) {
            const category = categories.get(imp)!;
            const currentCategoryIndex = CATEGORY_ORDER.indexOf(category);
            const lastCategoryIndex = lastTcCategory ? CATEGORY_ORDER.indexOf(lastTcCategory) : -1;

            if (lastTcCategory && currentCategoryIndex < lastCategoryIndex) {
                issues.push({
                    code: 'wrong-import-order',
                    message: `Import ordering violation: ${category} imports should come before ${lastTcCategory} imports (Google Python Style Guide).`,
                    severity: vscode.DiagnosticSeverity.Information,
                    range: importRange(document, imp),
                    import: imp,
                });
            }

            if (category !== lastTcCategory) {
                lastTcCategory = category;
            }
        }

        // Rule 9 for TYPE_CHECKING block
        let tcGroupCategory: ImportCategory | undefined;
        let tcGroupImports: ImportStatement[] = [];
        for (const imp of typeCheckingImports) {
            const category = categories.get(imp)!;
            if (category !== tcGroupCategory) {
                checkAlphabeticalOrder(document, tcGroupImports, issues);
                tcGroupCategory = category;
                tcGroupImports = [imp];
            } else {
                tcGroupImports.push(imp);
            }
        }
        checkAlphabeticalOrder(document, tcGroupImports, issues);
    }

    return { imports, categories, issues, unusedNames: unusedNamesMap, importLines };
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
