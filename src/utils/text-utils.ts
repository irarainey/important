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
export function getMultilineStringLines(document: vscode.TextDocument): ReadonlyMap<number, number> {
    const mlLines = new Map<number, number>();
    let inTriple = false;
    let tripleChar = '';

    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;

        if (inTriple) {
            // Check if this line closes the triple-quote
            const closeIdx = lineText.indexOf(tripleChar);
            if (closeIdx !== -1) {
                // Closing delimiter found.  Record the column where code
                // starts (immediately after the closing `"""`).  Lines
                // like `""") + str(module.Cls.method())` have real code
                // after the delimiter — consumers use the column value to
                // skip only matches inside the string portion while still
                // analysing the code that follows.
                mlLines.set(i, closeIdx + 3);
                inTriple = false;
            } else {
                // Entire line is inside the multi-line string — no code
                // starts on this line, so use Infinity as the code-start.
                mlLines.set(i, Infinity);
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
    multilineStringLines?: ReadonlyMap<number, number>,
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

        // Skip if inside the string portion of a multi-line string.
        // The map value is the column where code starts on that line;
        // matches before that column are inside the string.
        const mlCodeStart = mlLines.get(pos.line);
        if (mlCodeStart !== undefined && pos.character < mlCodeStart) {
            continue;
        }

        // Skip if preceded by a dot — the name is part of a qualified
        // reference (e.g. `module.Symbol`) and the bare import of
        // `Symbol` is not what provides it.
        if (match.index > 0 && documentText[match.index - 1] === '.') {
            continue;
        }

        // Skip if in a string or comment.  When the line has a closing
        // multi-line string delimiter, strip the string prefix so that
        // isInStringOrComment does not mistake the closer for an opener.
        const lineText = document.lineAt(pos.line).text;
        const startCol = mlCodeStart ?? 0;
        const beforeMatch = lineText.substring(startCol, pos.character);
        if (isInStringOrComment(beforeMatch)) {
            continue;
        }

        return true;
    }

    return false;
}

/**
 * Checks whether a name is used as an assignment target in the document,
 * outside of import lines, strings, comments, and multi-line strings.
 *
 * Detects simple assignments (`name = ...`), augmented assignments
 * (`name += ...`), type-annotated bindings (`name: Type`), loop
 * variables (`for name in`), and context-manager / exception targets
 * (`as name`).  Attribute assignments (`obj.name = ...`) are ignored.
 *
 * This is used by the import fixer to detect naming conflicts before
 * introducing a new module name into the namespace.
 */
export function isNameAssignedInDocument(
    document: vscode.TextDocument,
    documentText: string,
    name: string,
    importLines: ReadonlySet<number>,
    multilineStringLines: ReadonlyMap<number, number>,
): boolean {
    // Match assignment targets: `name =` (not `==`), `name:`, augmented assignments
    const assignPattern = new RegExp(
        `\\b${escapeRegex(name)}\\s*(?:=[^=]|:[^:]|\\+=|-=|\\*=|/=|//=|%=|\\*\\*=|&=|\\|=|\\^=|>>=|<<=)`,
        'g',
    );

    if (scanForAssignment(document, documentText, assignPattern, name, importLines, multilineStringLines)) {
        return true;
    }

    // Match `for name in` and `as name` (with/except targets)
    const bindingPattern = new RegExp(
        `(?:(?:for|as)\\s+${escapeRegex(name)}\\b)`,
        'g',
    );

    return scanForAssignment(document, documentText, bindingPattern, name, importLines, multilineStringLines);
}

/**
 * Scans the document for matches of a pattern, filtering out matches
 * inside import lines, strings, comments, multi-line strings, and
 * attribute access (preceded by `.`).
 */
function scanForAssignment(
    document: vscode.TextDocument,
    documentText: string,
    pattern: RegExp,
    name: string,
    importLines: ReadonlySet<number>,
    multilineStringLines: ReadonlyMap<number, number>,
): boolean {
    let match;
    while ((match = pattern.exec(documentText)) !== null) {
        // Find the position of the name itself within the match
        const nameIdx = match[0].indexOf(name);
        const namePos = document.positionAt(match.index + nameIdx);

        if (importLines.has(namePos.line)) continue;
        const mlCodeStart = multilineStringLines.get(namePos.line);
        if (mlCodeStart !== undefined && namePos.character < mlCodeStart) continue;

        const lineText = document.lineAt(namePos.line).text;
        const startCol = mlCodeStart ?? 0;
        const before = lineText.substring(startCol, namePos.character);
        if (isInStringOrComment(before)) continue;

        // Skip attribute assignments (e.g. `self.name = ...`)
        if (namePos.character > 0 && documentText[match.index + nameIdx - 1] === '.') continue;

        return true;
    }
    return false;
}

/**
 * Check if position might be in a string or comment (not in f-string expression).
 */
export function isInStringOrComment(beforeMatch: string): boolean {
    // Walk through the text character by character, tracking string state.
    // This properly handles f-strings with nested quotes inside {} expressions.
    let i = 0;
    const len = beforeMatch.length;

    while (i < len) {
        const ch = beforeMatch[i];

        // Check for comment outside of any string
        if (ch === '#') {
            return true; // Rest of line is a comment
        }

        // Check for string opening
        if (ch === '"' || ch === "'") {
            const isFString = i > 0 && (beforeMatch[i - 1] === 'f' || beforeMatch[i - 1] === 'F');

            // Check for triple-quote
            if (i + 2 < len && beforeMatch[i + 1] === ch && beforeMatch[i + 2] === ch) {
                const closeIdx = beforeMatch.indexOf(ch + ch + ch, i + 3);
                if (closeIdx === -1) {
                    return true; // Unclosed triple-quote — we're in a string
                }
                i = closeIdx + 3;
                continue;
            }

            // Single-quoted string — walk to find the close, tracking f-string {} nesting
            const result = skipString(beforeMatch, i, ch, isFString);
            if (result === -1) {
                // Reached end of beforeMatch without closing the string.
                // We're inside this string — unless it's an f-string and
                // we're inside a {} expression (which is code, not string).
                return true;
            }
            if (result === -2) {
                // Inside an f-string {} expression at end of text — this is code
                return false;
            }
            i = result;
            continue;
        }

        i++;
    }

    return false; // Not in a string or comment
}

/**
 * Walks past a single-quoted or double-quoted string starting at position
 * `start` (the opening quote character).  Returns the index after the
 * closing quote, or `-1` if the string is unclosed at end of text (match
 * is inside the string), or `-2` if we're inside an f-string `{}`
 * expression at end of text (match is in code).
 */
function skipString(text: string, start: number, quoteChar: string, isFString: boolean): number {
    let i = start + 1; // Move past opening quote
    const len = text.length;

    while (i < len) {
        const c = text[i];
        if (c === '\\') {
            i += 2; // Skip escaped character
            continue;
        }
        if (c === quoteChar) {
            return i + 1; // Past closing quote
        }
        if (isFString && c === '{') {
            // Skip f-string expression, accounting for nested braces and strings
            i++;
            let braceDepth = 1;
            while (i < len && braceDepth > 0) {
                const ec = text[i];
                if (ec === '{') {
                    braceDepth++;
                } else if (ec === '}') {
                    braceDepth--;
                } else if (ec === '"' || ec === "'") {
                    // Skip nested string inside f-string expression
                    const q = ec;
                    i++;
                    while (i < len && text[i] !== q) {
                        if (text[i] === '\\') i++;
                        i++;
                    }
                    if (i < len) i++; // Past closing nested quote
                    continue;
                }
                if (braceDepth > 0) i++;
            }
            // If braceDepth > 0, we're still inside {} at end of text — code context
            if (braceDepth > 0) {
                return -2; // Inside f-string expression (code)
            }
            continue;
        }
        i++;
    }

    return -1; // Unclosed string
}
