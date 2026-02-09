import * as vscode from 'vscode';
import type { ImportCategory, ImportStatement, ValidationResult } from '../types';
import { CATEGORY_ORDER } from '../types';

interface NormalizedImport {
    module: string;
    type: 'import' | 'from';
    names: string[];
    /** Maps original name → alias for names with `as` clauses. */
    aliases: Map<string, string>;
    category: ImportCategory;
}

/**
 * Sorts all imports in a document according to Google style.
 *
 * Consumes a pre-computed {@link ValidationResult} so that parsing,
 * categorisation, and unused-name detection are performed exactly once
 * and shared with diagnostics — eliminating duplicate scans.
 *
 * Expands multi-imports, removes unused, groups by category, sorts alphabetically.
 */
export async function sortImportsInDocument(
    document: vscode.TextDocument,
    result: ValidationResult,
    lineLength: number,
): Promise<boolean> {
    const { imports, categories, unusedNames } = result;
    if (imports.length === 0) {
        return false;
    }

    // Normalize imports: expand multi-imports, filter unused
    const normalized: NormalizedImport[] = [];

    for (const imp of imports) {
        // Skip TYPE_CHECKING block imports — they are managed
        // separately and must not be moved or filtered.
        if (imp.typeCheckingOnly) {
            continue;
        }

        const category = categories.get(imp)!;
        const unused = new Set(unusedNames.get(imp) ?? []);

        if (imp.type === 'import') {
            // Expand 'import os, sys' into separate imports
            for (const name of imp.names) {
                if (!unused.has(name)) {
                    const alias = imp.aliases.get(name);
                    const entryAliases = new Map<string, string>();
                    if (alias) entryAliases.set(name, alias);
                    normalized.push({
                        module: name,
                        type: 'import',
                        names: [name],
                        aliases: entryAliases,
                        category,
                    });
                }
            }
        } else if (imp.module === '__future__') {
            // Always preserve __future__ imports — their names are
            // directives, not symbols referenced elsewhere in code.
            normalized.push({
                module: imp.module,
                type: 'from',
                names: [...imp.names],
                aliases: new Map(imp.aliases),
                category,
            });
        } else if (imp.names.includes('*')) {
            // Keep wildcard imports as-is
            normalized.push({
                module: imp.module,
                type: 'from',
                names: ['*'],
                aliases: new Map<string, string>(),
                category,
            });
        } else {
            // Filter to only used names (those NOT in the unused set)
            const usedNames = imp.names.filter(name => !unused.has(name));
            if (usedNames.length > 0) {
                const filteredAliases = new Map<string, string>();
                for (const name of usedNames) {
                    const alias = imp.aliases.get(name);
                    if (alias) filteredAliases.set(name, alias);
                }
                normalized.push({
                    module: imp.module,
                    type: 'from',
                    names: usedNames,
                    aliases: filteredAliases,
                    category,
                });
            }
        }
    }

    // Group by category
    const groups: Record<ImportCategory, NormalizedImport[]> = {
        'future': [],
        'stdlib': [],
        'third-party': [],
        'first-party': [],
        'local': [],
    };

    // Deduplicate imports (merge from imports for same module, skip duplicate imports)
    const seenImports = new Map<string, NormalizedImport>();

    for (const imp of normalized) {
        const key = `${imp.type}:${imp.module}`;

        const existing = seenImports.get(key);
        if (existing) {
            if (imp.type === 'from' && !imp.names.includes('*') && !existing.names.includes('*')) {
                // Merge names for from imports
                for (const name of imp.names) {
                    if (!existing.names.includes(name)) {
                        existing.names.push(name);
                    }
                    const alias = imp.aliases.get(name);
                    if (alias) {
                        existing.aliases.set(name, alias);
                    }
                }
            }
            // For 'import' type, duplicate is just ignored
        } else {
            seenImports.set(key, imp);
        }
    }

    for (const imp of seenImports.values()) {
        groups[imp.category].push(imp);
    }

    // Sort within each group: `import` statements before `from` statements,
    // then alphabetically by module name within each sub-group (ignoring case).
    // This matches Ruff/isort default behaviour (force_sort_within_sections = false).
    for (const category of Object.keys(groups) as ImportCategory[]) {
        groups[category].sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'import' ? -1 : 1;
            }
            return a.module.toLowerCase().localeCompare(b.module.toLowerCase());
        });
    }

    // Build the sorted import text
    const sortedBlocks: string[] = [];

    for (const category of CATEGORY_ORDER) {
        const categoryImports = groups[category];
        if (categoryImports.length > 0) {
            const lines = categoryImports.map(imp => {
                if (imp.type === 'import') {
                    const alias = imp.aliases.get(imp.module);
                    return alias ? `import ${imp.module} as ${alias}` : `import ${imp.module}`;
                } else {
                    // Sort names alphabetically within each from-import
                    // to match Ruff/isort default behaviour.
                    const sortedNames = [...imp.names].sort((a, b) =>
                        a.toLowerCase().localeCompare(b.toLowerCase()),
                    );
                    const nameFragments = sortedNames.map(n => {
                        const alias = imp.aliases.get(n);
                        return alias ? `${n} as ${alias}` : n;
                    });
                    return formatFromImport(imp.module, nameFragments, lineLength);
                }
            });
            sortedBlocks.push(lines.join('\n'));
        }
    }

    const sortedImportsText = sortedBlocks.join('\n\n');

    // --- TYPE_CHECKING block sorting ---
    // Only process TC imports when validation found TC-specific issues
    // (ordering, unused, alphabetical, etc.).  This prevents the sorter
    // from reformatting already-valid TC imports (e.g. collapsing
    // multi-line imports to single-line) as a side effect of fixing
    // unrelated issues outside the block.
    const tcImports = imports.filter(imp => imp.typeCheckingOnly);
    const hasTcIssues = result.issues.some(i => i.import.typeCheckingOnly);
    const sortedTcText = hasTcIssues
        ? buildSortedTypeCheckingBlock(tcImports, categories, unusedNames, lineLength, document)
        : undefined;

    // Separate top-block and misplaced imports (excluding TYPE_CHECKING imports)
    const topBlockImports = imports.filter(imp => !imp.misplaced && !imp.typeCheckingOnly);
    const misplacedImports = imports.filter(imp => imp.misplaced && !imp.typeCheckingOnly);

    // Find the contiguous top-block range (only among non-misplaced imports)
    const topFirstLine = topBlockImports.length > 0
        ? Math.min(...topBlockImports.map(i => i.line))
        : 0;
    let topLastLine = topFirstLine;
    for (const imp of topBlockImports) {
        if (imp.endLine > topLastLine) {
            topLastLine = imp.endLine;
        }
    }

    // Detect whether the TYPE_CHECKING block is embedded within the
    // top-block range (regular imports exist both before and after it).
    // When embedded, replacing the top-block range with only the sorted
    // regular imports would destroy the TC block.  Instead we build a
    // single combined replacement that includes both sections.
    let tcEmbedded = false;
    let tcHeaderLine = -1;
    let tcBlockFirstLine = -1;
    let tcBlockLastLine = -1;

    if (tcImports.length > 0) {
        tcBlockFirstLine = Math.min(...tcImports.map(i => i.line));
        tcBlockLastLine = Math.max(...tcImports.map(i => i.endLine));

        if (tcBlockFirstLine > topFirstLine && tcBlockLastLine <= topLastLine) {
            // Find the `if TYPE_CHECKING:` header line by scanning backward
            for (let l = tcBlockFirstLine - 1; l >= 0; l--) {
                const lineText = document.lineAt(l).text.trim();
                if (lineText.startsWith('if TYPE_CHECKING') && lineText.endsWith(':')) {
                    tcHeaderLine = l;
                    break;
                }
            }
            tcEmbedded = tcHeaderLine >= 0;
        }
    }

    if (tcEmbedded) {
        // Build combined text: sorted regular imports, then the
        // `if TYPE_CHECKING:` header and its (optionally re-sorted) body.
        const tcHeaderText = document.lineAt(tcHeaderLine).text;
        const tcBody = sortedTcText ?? document.getText(
            new vscode.Range(
                new vscode.Position(tcBlockFirstLine, 0),
                new vscode.Position(tcBlockLastLine, document.lineAt(tcBlockLastLine).text.length),
            ),
        );
        const combinedText = sortedImportsText + '\n\n' + tcHeaderText + '\n' + tcBody;

        // The replacement range spans from the first regular import to
        // whichever ends later — the last regular import or the TC block.
        const rangeFirstLine = Math.min(topFirstLine, tcHeaderLine);
        const rangeLastLine = Math.max(topLastLine, tcBlockLastLine);
        const fullRange = new vscode.Range(
            new vscode.Position(rangeFirstLine, 0),
            new vscode.Position(rangeLastLine, document.lineAt(rangeLastLine).text.length),
        );

        if (misplacedImports.length === 0) {
            const currentText = document.getText(fullRange);
            if (currentText === combinedText) {
                return false;
            }
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, combinedText);
            return vscode.workspace.applyEdit(edit);
        }

        // Misplaced imports exist — delete them then replace with combined text
        const edit = new vscode.WorkspaceEdit();
        const sortedMisplaced = [...misplacedImports].sort((a, b) => b.line - a.line);
        for (const imp of sortedMisplaced) {
            const startPos = new vscode.Position(imp.line, 0);
            const endLine = imp.endLine + 1 < document.lineCount
                ? imp.endLine + 1
                : imp.endLine;
            const endPos = imp.endLine + 1 < document.lineCount
                ? new vscode.Position(endLine, 0)
                : new vscode.Position(imp.endLine, document.lineAt(imp.endLine).text.length);
            edit.delete(document.uri, new vscode.Range(startPos, endPos));
        }
        edit.replace(document.uri, fullRange, combinedText);
        return vscode.workspace.applyEdit(edit);
    }

    // --- Non-embedded TC block path (TC block is outside the top-block range) ---
    let tcNeedsChange = false;
    let tcRange: vscode.Range | undefined;
    if (tcImports.length > 0 && sortedTcText !== undefined) {
        tcRange = new vscode.Range(
            new vscode.Position(tcBlockFirstLine, 0),
            new vscode.Position(tcBlockLastLine, document.lineAt(tcBlockLastLine).text.length),
        );
        const currentTcText = document.getText(tcRange);
        tcNeedsChange = currentTcText !== sortedTcText;
    }

    // When there are no misplaced imports, check if the top block is already sorted
    if (misplacedImports.length === 0) {
        const startPos = new vscode.Position(topFirstLine, 0);
        const endPos = new vscode.Position(topLastLine, document.lineAt(topLastLine).text.length);
        const importRange = new vscode.Range(startPos, endPos);
        const currentText = document.getText(importRange);

        const topNeedsChange = currentText !== sortedImportsText;

        if (!topNeedsChange && !tcNeedsChange) {
            return false; // Already sorted
        }

        const edit = new vscode.WorkspaceEdit();
        // Apply TYPE_CHECKING edit first (higher line numbers)
        if (tcNeedsChange && tcRange && sortedTcText !== undefined) {
            edit.replace(document.uri, tcRange, sortedTcText);
        }
        if (topNeedsChange) {
            edit.replace(document.uri, importRange, sortedImportsText);
        }
        return vscode.workspace.applyEdit(edit);
    }

    // Misplaced imports exist — delete them from their original
    // positions and merge into the sorted top block.
    //
    // Process deletions bottom-up so that earlier line numbers remain
    // valid as we delete later lines.
    const edit = new vscode.WorkspaceEdit();

    // Apply TYPE_CHECKING edit first (higher line numbers, won't affect top-block)
    if (tcNeedsChange && tcRange && sortedTcText !== undefined) {
        edit.replace(document.uri, tcRange, sortedTcText);
    }

    const sortedMisplaced = [...misplacedImports].sort((a, b) => b.line - a.line);
    for (const imp of sortedMisplaced) {
        const startPos = new vscode.Position(imp.line, 0);
        // Delete the import line(s) and the following newline so we
        // don't leave blank gaps in the file body.
        const endLine = imp.endLine + 1 < document.lineCount
            ? imp.endLine + 1
            : imp.endLine;
        const endPos = imp.endLine + 1 < document.lineCount
            ? new vscode.Position(endLine, 0)
            : new vscode.Position(imp.endLine, document.lineAt(imp.endLine).text.length);
        edit.delete(document.uri, new vscode.Range(startPos, endPos));
    }

    // Replace the top-block range with the merged sorted imports
    const topStart = new vscode.Position(topFirstLine, 0);
    const topEnd = new vscode.Position(topLastLine, document.lineAt(topLastLine).text.length);
    edit.replace(document.uri, new vscode.Range(topStart, topEnd), sortedImportsText);

    return vscode.workspace.applyEdit(edit);
}

/**
 * Builds the sorted text for imports inside a `TYPE_CHECKING` block.
 *
 * Uses the same normalisation, deduplication, grouping, and formatting
 * logic as the main import sorter — but with the block's indentation
 * applied to each line.  Returns `undefined` when no TYPE_CHECKING
 * imports exist, or the sorted text (ready for direct comparison /
 * replacement of the range spanning the first to last TC import).
 */
function buildSortedTypeCheckingBlock(
    tcImports: readonly ImportStatement[],
    categories: ReadonlyMap<ImportStatement, ImportCategory>,
    unusedNames: ReadonlyMap<ImportStatement, readonly string[]>,
    lineLength: number,
    document: vscode.TextDocument,
): string | undefined {
    if (tcImports.length === 0) {
        return undefined;
    }

    // Detect indentation from the first TYPE_CHECKING import
    const firstTcLine = document.lineAt(tcImports[0].line).text;
    const indent = firstTcLine.match(/^(\s*)/)?.[1] ?? '    ';

    // Normalize TYPE_CHECKING imports (same logic as main sorter)
    const normalized: NormalizedImport[] = [];
    for (const imp of tcImports) {
        const category = categories.get(imp)!;
        const unused = new Set(unusedNames.get(imp) ?? []);

        if (imp.type === 'import') {
            for (const name of imp.names) {
                if (!unused.has(name)) {
                    const alias = imp.aliases.get(name);
                    const entryAliases = new Map<string, string>();
                    if (alias) entryAliases.set(name, alias);
                    normalized.push({
                        module: name, type: 'import', names: [name],
                        aliases: entryAliases, category,
                    });
                }
            }
        } else if (imp.names.includes('*')) {
            normalized.push({
                module: imp.module, type: 'from', names: ['*'],
                aliases: new Map<string, string>(), category,
            });
        } else {
            const usedNames = imp.names.filter(name => !unused.has(name));
            if (usedNames.length > 0) {
                const filteredAliases = new Map<string, string>();
                for (const name of usedNames) {
                    const alias = imp.aliases.get(name);
                    if (alias) filteredAliases.set(name, alias);
                }
                normalized.push({
                    module: imp.module, type: 'from', names: usedNames,
                    aliases: filteredAliases, category,
                });
            }
        }
    }

    if (normalized.length === 0) {
        return undefined;
    }

    // Deduplicate
    const seenImports = new Map<string, NormalizedImport>();
    for (const imp of normalized) {
        const key = `${imp.type}:${imp.module}`;
        const existing = seenImports.get(key);
        if (existing) {
            if (imp.type === 'from' && !imp.names.includes('*') && !existing.names.includes('*')) {
                for (const name of imp.names) {
                    if (!existing.names.includes(name)) {
                        existing.names.push(name);
                    }
                    const alias = imp.aliases.get(name);
                    if (alias) existing.aliases.set(name, alias);
                }
            }
        } else {
            seenImports.set(key, imp);
        }
    }

    // Group by category
    const groups: Record<ImportCategory, NormalizedImport[]> = {
        'future': [], 'stdlib': [], 'third-party': [], 'first-party': [], 'local': [],
    };
    for (const imp of seenImports.values()) {
        groups[imp.category].push(imp);
    }

    // Sort within each group
    for (const category of Object.keys(groups) as ImportCategory[]) {
        groups[category].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'import' ? -1 : 1;
            return a.module.toLowerCase().localeCompare(b.module.toLowerCase());
        });
    }

    // Effective line length for the indented content
    const effectiveLineLength = lineLength > 0 ? lineLength - indent.length : 0;

    // Build sorted text with indentation
    const sortedBlocks: string[] = [];
    for (const category of CATEGORY_ORDER) {
        const categoryImports = groups[category];
        if (categoryImports.length > 0) {
            const lines = categoryImports.map(imp => {
                if (imp.type === 'import') {
                    const alias = imp.aliases.get(imp.module);
                    return alias
                        ? `${indent}import ${imp.module} as ${alias}`
                        : `${indent}import ${imp.module}`;
                } else {
                    // Sort names alphabetically within each from-import
                    // to match Ruff/isort default behaviour.
                    const sortedNames = [...imp.names].sort((a, b) =>
                        a.toLowerCase().localeCompare(b.toLowerCase()),
                    );
                    const nameFragments = sortedNames.map(n => {
                        const alias = imp.aliases.get(n);
                        return alias ? `${n} as ${alias}` : n;
                    });
                    return formatFromImportIndented(imp.module, nameFragments, effectiveLineLength, indent);
                }
            });
            sortedBlocks.push(lines.join('\n'));
        }
    }

    return sortedBlocks.join('\n\n');
}

/**
 * Formats a `from … import …` statement with a leading indent, wrapping
 * to multiple lines when the single-line version exceeds the line length.
 * Used for imports inside `if TYPE_CHECKING:` blocks.
 */
function formatFromImportIndented(
    module: string,
    nameFragments: string[],
    effectiveLineLength: number,
    indent: string,
): string {
    const singleLine = `${indent}from ${module} import ${nameFragments.join(', ')}`;
    if (effectiveLineLength <= 0 || singleLine.length <= indent.length + effectiveLineLength) {
        return singleLine;
    }

    const innerIndent = indent + '    ';
    const wrapped = nameFragments.map(n => `${innerIndent}${n},`).join('\n');
    return `${indent}from ${module} import (\n${wrapped}\n${indent})`;
}

/**
 * Formats a `from … import …` statement, wrapping to multiple lines
 * (parenthesised with trailing comma, 4-space indent) when the
 * single-line version exceeds the configured line length.
 *
 * Matches Ruff's default formatting style.
 */
function formatFromImport(module: string, nameFragments: string[], lineLength: number): string {
    const singleLine = `from ${module} import ${nameFragments.join(', ')}`;
    if (lineLength <= 0 || singleLine.length <= lineLength) {
        return singleLine;
    }

    const indent = '    ';
    const wrapped = nameFragments.map(n => `${indent}${n},`).join('\n');
    return `from ${module} import (\n${wrapped}\n)`;
}
