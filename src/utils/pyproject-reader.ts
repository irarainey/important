import * as vscode from 'vscode';
import { log } from './logger';

/**
 * Reads `known-first-party` entries from `[tool.ruff.lint.isort]` in a
 * workspace `pyproject.toml`.
 *
 * Uses a lightweight regex-based parser — no TOML library dependency.
 * Returns an empty array when no file is found or the section doesn't exist.
 */
export async function readFirstPartyFromPyproject(): Promise<readonly string[]> {
    const files = await vscode.workspace.findFiles('**/pyproject.toml', '**/node_modules/**', 5);

    if (files.length === 0) {
        log('No pyproject.toml found in workspace.');
        return [];
    }

    log(`Found ${files.length} pyproject.toml file(s) — scanning for [tool.ruff.lint.isort]…`);
    const results = new Set<string>();

    for (const file of files) {
        const modules = await parseFirstPartyFromFile(file);
        if (modules.length > 0) {
            log(`${vscode.workspace.asRelativePath(file)}: known-first-party = [${modules.join(', ')}]`);
        }
        for (const m of modules) {
            results.add(m);
        }
    }

    return [...results];
}

/**
 * Parses a single `pyproject.toml` for `known-first-party` under
 * `[tool.ruff.lint.isort]`.
 */
async function parseFirstPartyFromFile(uri: vscode.Uri): Promise<string[]> {
    let content: string;
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(bytes).toString('utf-8');
    } catch {
        return [];
    }

    // Find the [tool.ruff.lint.isort] section.
    // Also accept [tool.ruff.isort] which is a deprecated but still common form.
    const sectionPattern = /^\[tool\.ruff(?:\.lint)?\.isort\]\s*$/m;
    const sectionMatch = sectionPattern.exec(content);
    if (!sectionMatch) {
        return [];
    }

    // Extract the section body (everything until the next [header] or EOF)
    const sectionStart = sectionMatch.index + sectionMatch[0].length;
    const nextSectionMatch = /^\[/m.exec(content.slice(sectionStart));
    const sectionBody = nextSectionMatch
        ? content.slice(sectionStart, sectionStart + nextSectionMatch.index)
        : content.slice(sectionStart);

    // Look for  known-first-party = ["mod1", "mod2"]
    // The value can span multiple lines in TOML (array with trailing bracket).
    const keyPattern = /known-first-party\s*=\s*\[([^\]]*)\]/s;
    const keyMatch = keyPattern.exec(sectionBody);
    if (!keyMatch) {
        return [];
    }

    const arrayContent = keyMatch[1];

    // Extract quoted strings (single or double)
    const stringPattern = /["']([^"']+)["']/g;
    const modules: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = stringPattern.exec(arrayContent)) !== null) {
        const value = m[1].trim();
        if (value.length > 0) {
            modules.push(value);
        }
    }

    return modules;
}
