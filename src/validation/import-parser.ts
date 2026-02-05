import * as vscode from 'vscode';
import type { ImportStatement } from '../types';

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
