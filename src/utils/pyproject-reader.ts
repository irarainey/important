import * as vscode from 'vscode';
import type { ScopedFirstParty } from '../types';
import { log } from './logger';
import { WORKSPACE_EXCLUDE_PATTERN } from './module-resolver';

/** Ruff's default line length when not configured anywhere. */
const RUFF_DEFAULT_LINE_LENGTH = 88;

/**
 * Reads `known-first-party` entries from `[tool.ruff.lint.isort]` in every
 * `pyproject.toml` found in the workspace.
 *
 * Returns one {@link ScopedFirstParty} entry per file that declares modules,
 * sorted root-first so that the most general scope takes precedence during
 * iteration.
 *
 * Uses a lightweight regex-based parser — no TOML library dependency.
 */
export async function readFirstPartyFromPyproject(): Promise<readonly ScopedFirstParty[]> {
    const files = await vscode.workspace.findFiles('**/pyproject.toml', WORKSPACE_EXCLUDE_PATTERN);

    if (files.length === 0) {
        log('No pyproject.toml found in workspace.');
        return [];
    }

    // Sort by depth (root-level first) so callers can rely on ordering.
    files.sort((a, b) => {
        const aDepth = vscode.workspace.asRelativePath(a, false).split('/').length;
        const bDepth = vscode.workspace.asRelativePath(b, false).split('/').length;
        return aDepth - bDepth;
    });

    log(`Found ${files.length} pyproject.toml file(s) — scanning for [tool.ruff.lint.isort]…`);
    const results: ScopedFirstParty[] = [];

    for (const file of files) {
        const modules = await parseFirstPartyFromFile(file);
        if (modules.length > 0) {
            const relativePath = vscode.workspace.asRelativePath(file, false);
            // Directory containing the pyproject.toml.  "pyproject.toml" at
            // the workspace root produces "." via this logic.
            const lastSlash = relativePath.lastIndexOf('/');
            const dirPath = lastSlash === -1 ? '.' : relativePath.slice(0, lastSlash);
            log(`${relativePath}: known-first-party = [${modules.join(', ')}]`);
            results.push({ dirPath, modules });
        }
    }

    return results;
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

/**
 * Reads `line-length` from the `[tool.ruff]` section in the root
 * `pyproject.toml`.
 *
 * Returns the configured value, or the Ruff default (88) when no
 * `line-length` key is found.
 */
export async function readLineLengthFromPyproject(): Promise<number> {
    const files = await vscode.workspace.findFiles('**/pyproject.toml', WORKSPACE_EXCLUDE_PATTERN);
    if (files.length === 0) {
        return RUFF_DEFAULT_LINE_LENGTH;
    }

    // Sort shallowest first — use the root-level pyproject.toml.
    files.sort((a, b) => {
        const aDepth = vscode.workspace.asRelativePath(a, false).split('/').length;
        const bDepth = vscode.workspace.asRelativePath(b, false).split('/').length;
        return aDepth - bDepth;
    });

    for (const file of files) {
        const length = await parseLineLengthFromFile(file);
        if (length !== undefined) {
            const relativePath = vscode.workspace.asRelativePath(file, false);
            log(`${relativePath}: line-length = ${length}`);
            return length;
        }
    }

    return RUFF_DEFAULT_LINE_LENGTH;
}

/**
 * Parses `line-length` from `[tool.ruff]` in a single `pyproject.toml`.
 */
async function parseLineLengthFromFile(uri: vscode.Uri): Promise<number | undefined> {
    let content: string;
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(bytes).toString('utf-8');
    } catch {
        return undefined;
    }

    // Find the [tool.ruff] section (not [tool.ruff.lint] etc.)
    const sectionPattern = /^\[tool\.ruff\]\s*$/m;
    const sectionMatch = sectionPattern.exec(content);
    if (!sectionMatch) {
        return undefined;
    }

    // Extract the section body (until next [header] or EOF)
    const sectionStart = sectionMatch.index + sectionMatch[0].length;
    const nextSectionMatch = /^\[/m.exec(content.slice(sectionStart));
    const sectionBody = nextSectionMatch
        ? content.slice(sectionStart, sectionStart + nextSectionMatch.index)
        : content.slice(sectionStart);

    // Match line-length = <number>
    const keyPattern = /line-length\s*=\s*(\d+)/;
    const keyMatch = keyPattern.exec(sectionBody);
    if (!keyMatch) {
        return undefined;
    }

    const value = parseInt(keyMatch[1], 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
