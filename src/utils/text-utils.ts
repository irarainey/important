import * as vscode from 'vscode';

/**
 * Text utility functions for import validation.
 */

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the set of line numbers that fall inside a multi-line string
 * (triple-quoted `\"\"\"` or `'''`).  Lines containing only the opening
 * or closing delimiter are **not** included — only the interior lines
 * that definitely hold string content.
 *
 * This is used to prevent the import parser and symbol-usage scanner
 * from treating import-like text inside docstrings as real code.
 */
export function getMultilineStringLines(document: vscode.TextDocument): ReadonlySet<number> {
    const mlLines = new Set<number>();
    let inTriple = false;
    let tripleChar = '';

    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;

        if (inTriple) {
            // Check if this line closes the triple-quote
            const closeIdx = lineText.indexOf(tripleChar);
            if (closeIdx !== -1) {
                // Closing delimiter found — the portion before it is
                // still string content, so mark this line.
                mlLines.add(i);
                inTriple = false;
            } else {
                mlLines.add(i);
            }
        } else {
            // Look for an opening triple-quote that is NOT closed on the same line.
            // We need to handle both `"""` and `'''`.
            for (const delim of ['"""', "'''"] as const) {
                const openIdx = lineText.indexOf(delim);
                if (openIdx === -1) continue;

                // Check if there's a matching close on the same line
                // (after the opening delimiter).
                const afterOpen = openIdx + 3;
                const closeIdx = lineText.indexOf(delim, afterOpen);
                if (closeIdx !== -1) {
                    // Single-line triple-quoted string — not multi-line
                    continue;
                }

                // Triple-quote opened but not closed on this line
                inTriple = true;
                tripleChar = delim;
                break;
            }
        }
    }

    return mlLines;
}

/**
 * Checks if a name is used anywhere in the document outside a set of
 * excluded lines (typically the import lines themselves).
 */
export function isNameUsedOutsideLines(
    document: vscode.TextDocument,
    documentText: string,
    name: string,
    excludeLines: ReadonlySet<number>,
    multilineStringLines?: ReadonlySet<number>,
): boolean {
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
    const mlLines = multilineStringLines ?? getMultilineStringLines(document);

    let match;
    while ((match = pattern.exec(documentText)) !== null) {
        const pos = document.positionAt(match.index);

        // Skip if this is on an excluded line (import lines)
        if (excludeLines.has(pos.line)) {
            continue;
        }

        // Skip if inside a multi-line string (docstring)
        if (mlLines.has(pos.line)) {
            continue;
        }

        // Skip if preceded by a dot — the name is part of a qualified
        // reference (e.g. `module.Symbol`) and the bare import of
        // `Symbol` is not what provides it.
        if (match.index > 0 && documentText[match.index - 1] === '.') {
            continue;
        }

        // Skip if in a string or comment
        const lineText = document.lineAt(pos.line).text;
        const beforeMatch = lineText.substring(0, pos.character);
        if (isInStringOrComment(beforeMatch)) {
            continue;
        }

        return true;
    }

    return false;
}

/**
 * Check if position might be in a string or comment (not in f-string expression).
 */
export function isInStringOrComment(beforeMatch: string): boolean {
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
