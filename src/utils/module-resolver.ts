import * as vscode from 'vscode';
import type { ScopedFirstParty } from '../types';
import { log } from './logger';

/**
 * Resolves Python module paths against the workspace filesystem.
 *
 * Maintains a cached set of known Python module paths so that
 * validation can synchronously check whether an imported name
 * refers to a module (`.py` file or package directory) rather
 * than a symbol (class, function, constant).
 */

/** Cached set of workspace-relative module paths (e.g. `mcp_servers/data/company_data`). */
let knownModulePaths = new Set<string>();

/** Set of globally configured first-party module root names (from VS Code settings). */
let globalFirstPartyModules = new Set<string>();

/** Path-scoped first-party module entries (from pyproject.toml files). */
let scopedFirstPartyModules: ScopedFirstParty[] = [];

/** Whether the initial scan has completed. */
let initialized = false;

/** Resolves when the initial scan completes. */
let initPromise: Promise<void> | undefined;

/** File-system watcher disposable. */
let watcher: vscode.Disposable | undefined;

/**
 * Scans the workspace for `.py` files and `__init__.py` packages,
 * populating the module-path cache used by {@link isWorkspaceModule}.
 *
 * Call once during extension activation; subsequent file changes are
 * tracked automatically via a workspace file-system watcher.
 */
export async function initModuleResolver(context: vscode.ExtensionContext): Promise<void> {
    initPromise = rebuildCache().then(() => {
        initialized = true;
        log(`Module resolver initialised — ${knownModulePaths.size} module path(s) cached.`);
    });
    await initPromise;

    // Watch for Python file creation / deletion to keep the cache current.
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.py');

    fileWatcher.onDidCreate(() => void rebuildCache());
    fileWatcher.onDidDelete(() => void rebuildCache());

    watcher = fileWatcher;
    context.subscriptions.push(fileWatcher);
}

/**
 * Returns a promise that resolves once the initial workspace scan is
 * complete.  Safe to call multiple times — returns immediately when
 * already initialised.
 */
export async function ensureModuleResolverReady(): Promise<void> {
    if (initialized) {
        return;
    }
    if (initPromise) {
        await initPromise;
    }
}

/**
 * Checks whether an imported name resolves to a module within the
 * current workspace.
 *
 * Given an import like `from mcp_servers.data import company_data`,
 * call with `modulePath = "mcp_servers.data"` and `name = "company_data"`.
 *
 * @returns `true` when a corresponding `.py` file or `__init__.py`
 *          package exists in the workspace.
 */
export function isWorkspaceModule(modulePath: string, name: string): boolean {
    if (!initialized) {
        return false;
    }

    const basePath = modulePath.replace(/\./g, '/');
    const fullPath = `${basePath}/${name}`;

    // Check for a module file  (e.g. mcp_servers/data/company_data.py)
    if (knownModulePaths.has(fullPath)) {
        return true;
    }

    // Check for a package directory (e.g. mcp_servers/data/company_data/__init__.py)
    if (knownModulePaths.has(`${fullPath}/__init__`)) {
        return true;
    }

    return false;
}

/**
 * Checks whether a dotted module path corresponds to a `.py` file in the
 * workspace (as opposed to a package directory).
 *
 * When the module path resolves to a file, any names imported from it are
 * definitively symbols (classes, functions, constants) — a `.py` file
 * cannot contain sub-modules.
 *
 * For example, `isModuleFile("sample.service.config")` returns `true` when
 * the workspace contains a file like `src/sample/service/config.py`.
 */
export function isModuleFile(moduleName: string): boolean {
    if (!initialized) {
        return false;
    }

    const moduleSlashPath = moduleName.replace(/\./g, '/');

    for (const known of knownModulePaths) {
        // Match if the cached path ends with the module's slash path
        // and is either the full path or preceded by a /
        // e.g. "src/sample/service/config" ends with "sample/service/config"
        if (known === moduleSlashPath || known.endsWith(`/${moduleSlashPath}`)) {
            // Ensure it's a file, not a package directory (__init__)
            if (!known.endsWith('/__init__')) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks whether a module name corresponds to a local project module
 * by looking up its root package in the workspace filesystem.
 *
 * For example, given `from models.sample_models import User`, calling
 * `isLocalModule("models.sample_models")` returns `true` when the
 * workspace contains `src/models/sample_models.py` (or similar).
 *
 * This enables correct import grouping: stdlib → third-party → local,
 * matching the ordering that Ruff / isort enforce.
 */
export function isLocalModule(moduleName: string): boolean {
    if (!initialized) {
        return false;
    }

    const rootModule = moduleName.split('.')[0];

    for (const known of knownModulePaths) {
        // Split the workspace-relative path into segments and check for
        // an exact segment match against the root module name.
        // e.g. "src/models/sample_models" has segments ["src","models","sample_models"]
        //      → matches rootModule "models"
        const segments = known.split('/');
        if (segments.includes(rootModule)) {
            return true;
        }
    }

    return false;
}

/**
 * Disposes the file watcher and clears the cache.
 */
export function disposeModuleResolver(): void {
    watcher?.dispose();
    watcher = undefined;
    knownModulePaths.clear();
    globalFirstPartyModules.clear();
    scopedFirstPartyModules = [];
    initialized = false;
    initPromise = undefined;
}

/**
 * Sets the globally configured first-party module root names
 * (from the `important.knownFirstParty` VS Code setting).
 *
 * These apply to every document regardless of workspace path.
 */
export function setGlobalFirstPartyModules(modules: readonly string[]): void {
    globalFirstPartyModules = new Set(modules);
}

/**
 * Sets path-scoped first-party module entries discovered from
 * `pyproject.toml` files.
 *
 * Each entry's modules only apply when validating a document whose
 * workspace-relative path is within that entry's directory subtree.
 */
export function setScopedFirstPartyModules(scoped: readonly ScopedFirstParty[]): void {
    scopedFirstPartyModules = [...scoped];
}

/**
 * Returns a human-readable summary of all first-party module entries
 * (both global and scoped).
 */
export function getFirstPartyModulesSummary(): string {
    const parts: string[] = [];

    if (globalFirstPartyModules.size > 0) {
        parts.push(`Global: ${[...globalFirstPartyModules].join(', ')}`);
    }

    for (const entry of scopedFirstPartyModules) {
        const label = entry.dirPath === '.' ? 'Workspace root (pyproject.toml)' : entry.dirPath;
        parts.push(`${label}: ${entry.modules.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('\n') : 'No first-party modules configured.';
}

/**
 * Returns `true` when the given module (or its root package) is
 * considered first-party for a document at the given URI.
 *
 * Resolution order:
 *  1. Global first-party modules (always apply)
 *  2. Scoped entries whose {@link ScopedFirstParty.dirPath} is an ancestor
 *     of the document's workspace-relative path
 */
export function isFirstPartyModule(moduleName: string, documentUri?: vscode.Uri): boolean {
    const rootModule = moduleName.split('.')[0];

    // Global modules always apply
    if (globalFirstPartyModules.has(rootModule)) {
        return true;
    }

    // Without a document URI we can only check global
    if (!documentUri) {
        return false;
    }

    const docRelative = vscode.workspace.asRelativePath(documentUri, false);

    for (const entry of scopedFirstPartyModules) {
        // Root-level scope (".") matches every document
        if (entry.dirPath === '.' || docRelative.startsWith(entry.dirPath + '/')) {
            if (entry.modules.includes(rootModule)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Glob pattern that excludes directories containing third-party or
 * environment packages.  These should never be treated as local modules.
 */
const EXCLUDE_PATTERN = '{**/node_modules/**,**/.venv/**,**/venv/**,**/.env/**,**/env/**,**/__pypackages__/**,**/.tox/**,**/.nox/**,**/.pyenv/**,**/site-packages/**}';

/**
 * Rebuilds the module-path cache from all `.py` files in the workspace.
 */
async function rebuildCache(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.py', EXCLUDE_PATTERN);
    const paths = new Set<string>();

    for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file, false);
        // Strip the .py extension to get the module path
        // e.g. "mcp_servers/data/company_data.py" → "mcp_servers/data/company_data"
        const modulePath = relativePath.replace(/\.py$/, '');
        paths.add(modulePath);
    }

    knownModulePaths = paths;
    log(`Module cache rebuilt — ${paths.size} Python file(s) indexed.`);
}
