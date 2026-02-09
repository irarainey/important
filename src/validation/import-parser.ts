import * as vscode from 'vscode';
import type { ImportStatement } from '../types';
import { getMultilineStringLines } from '../utils/text-utils';

/**
 * Strips an inline `#` comment from a fragment of an import statement.
 *
 * In import statements `#` always starts a comment — there are no
 * string literals or other constructs that could contain `#`.
 */
function stripInlineComment(text: string): string {
    const hashIndex = text.indexOf('#');
    return hashIndex === -1 ? text : text.substring(0, hashIndex);
}

/**
 * Parses a comma-separated list of imported names, extracting original
 * names and any `as` aliases into parallel structures.
 */
function parseNameList(raw: string): { names: string[]; aliases: Map<string, string> } {
    const names: string[] = [];
    const aliases = new Map<string, string>();

    for (const token of raw.split(',')) {
        const trimmed = token.trim();
        if (!trimmed || trimmed === ')') continue;

        const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
            names.push(asMatch[1]);
            aliases.set(asMatch[1], asMatch[2]);
        } else {
            names.push(trimmed);
        }
    }

    return { names, aliases };
}

/**
 * Parses a single line of Python code to extract import information.
 */
function parseImportLine(line: string, lineNumber: number): ImportStatement | undefined {
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
        const namesStr = stripInlineComment(fromMatch[3]);
        const { names, aliases } = parseNameList(namesStr);

        return {
            type: 'from',
            module: dots + module,
            names,
            aliases,
            level: dots.length,
            line: lineNumber,
            endLine: lineNumber,
            text: trimmed,
            misplaced: false,
            typeCheckingOnly: false,
        };
    }

    // Match 'import X' style
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
        const modulesStr = stripInlineComment(importMatch[1]);
        const { names: modules, aliases } = parseNameList(modulesStr);

        return {
            type: 'import',
            module: modules[0],
            names: modules,
            aliases,
            level: 0,
            line: lineNumber,
            endLine: lineNumber,
            text: trimmed,
            misplaced: false,
            typeCheckingOnly: false,
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
    let namesStr = stripInlineComment(fromMatch[3]);
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
            namesStr += stripInlineComment(line.substring(0, closingIndex));
            break;
        } else {
            namesStr += stripInlineComment(line);
        }
    }

    // Parse the collected names
    const { names, aliases } = parseNameList(namesStr);

    return {
        import: {
            type: 'from',
            module: dots + module,
            names,
            aliases,
            level: dots.length,
            line: startLine,
            endLine,
            text: fullText.trim(),
            misplaced: false,
            typeCheckingOnly: false,
        },
        endLine,
    };
}

/**
 * Parses all import statements from a document.
 *
 * Scans the **entire** file so that imports scattered below the
 * top-level block are still detected.  Imports found after the
 * top-level block ends are marked with `misplaced: true` so that
 * diagnostics can flag them and the sorter can relocate them.
 *
 * Imports inside `if TYPE_CHECKING:` blocks are marked with
 * `typeCheckingOnly: true` and exempt from runtime validation.
 *
 * The top-level block is defined as the contiguous run of import
 * statements (plus blank lines, comments, docstrings, `__all__`,
 * and `if TYPE_CHECKING` guards) that begins with the first import
 * in the file.  Once 2 consecutive non-permitted, non-import lines
 * are seen the block is considered closed; any imports found after
 * that point are misplaced.
 */
export function parseImports(document: vscode.TextDocument): ImportStatement[] {
    const imports: ImportStatement[] = [];
    let i = 0;
    let foundFirstImport = false;
    let consecutiveNonImportLines = 0;
    let topBlockEnded = false;
    let inTypeCheckingBlock = false;
    let typeCheckingIndent = 0;

    // Pre-compute lines inside multi-line strings (docstrings) so
    // import-like text inside them is never treated as real code.
    const multilineStringLines = getMultilineStringLines(document);

    while (i < document.lineCount) {
        const line = document.lineAt(i).text;
        const trimmed = line.trim();

        // Skip lines inside multi-line strings (docstrings)
        if (multilineStringLines.has(i)) {
            i++;
            continue;
        }

        // Detect entry into an `if TYPE_CHECKING:` block
        if (trimmed.startsWith('if TYPE_CHECKING') && trimmed.endsWith(':')) {
            inTypeCheckingBlock = true;
            // The body is indented relative to the `if` line
            typeCheckingIndent = line.length - line.trimStart().length;
            i++;
            continue;
        }

        // Detect exit from a TYPE_CHECKING block: any non-blank line at
        // the same or lesser indentation as the `if` line ends the block.
        if (inTypeCheckingBlock && trimmed !== '') {
            const currentIndent = line.length - line.trimStart().length;
            if (currentIndent <= typeCheckingIndent) {
                inTypeCheckingBlock = false;
            }
        }

        // Check for multiline import (from X import ( without closing ')')
        if (/^\s*from\s+\S+\s+import\s+\(/.test(line) && !line.includes(')')) {
            const multiline = parseMultilineImport(document, i);
            if (multiline) {
                imports.push({
                    ...multiline.import,
                    misplaced: topBlockEnded,
                    typeCheckingOnly: inTypeCheckingBlock,
                });
                if (!topBlockEnded) {
                    foundFirstImport = true;
                    consecutiveNonImportLines = 0;
                }
                i = multiline.endLine + 1;
                continue;
            }
        }

        // Try single-line parsing
        const parsed = parseImportLine(line, i);
        if (parsed) {
            imports.push({
                ...parsed,
                misplaced: topBlockEnded,
                typeCheckingOnly: inTypeCheckingBlock,
            });
            if (!topBlockEnded) {
                foundFirstImport = true;
                consecutiveNonImportLines = 0;
            }
        } else if (foundFirstImport && !topBlockEnded) {
            // Allow blank lines, comments, docstrings, __all__, and
            // TYPE_CHECKING guards between/after imports
            const isPermitted = trimmed === ''
                || trimmed.startsWith('#')
                || trimmed.startsWith('"""')
                || trimmed.startsWith("'''")
                || trimmed.startsWith('if TYPE_CHECKING')
                || trimmed.startsWith('__all__');

            if (isPermitted) {
                consecutiveNonImportLines = 0;
            } else {
                consecutiveNonImportLines++;
                // After 2 consecutive non-import lines the top block is over,
                // but we keep scanning for misplaced imports.
                if (consecutiveNonImportLines >= 2) {
                    topBlockEnded = true;
                }
            }
        }
        i++;
    }

    return imports;
}
