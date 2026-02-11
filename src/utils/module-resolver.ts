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

/**
 * Set of top-level (root) directory and file names that exist in the
 * workspace.  Used by {@link isLocalModule} for O(1) lookups to decide
 * whether an imported module originates from the workspace.
 *
 * Only the **first** segment of each workspace-relative path is
 * indexed — deeper segments are not root-level Python packages and
 * must not trigger a "local" classification (e.g. a file at
 * `tests/fixtures/pydantic.py` should not make `isLocalModule('pydantic')`
 * return `true`).
 */
let rootModuleIndex = new Set<string>();

/**
 * Set of slash-path suffixes for non-`__init__` modules.  Used by
 * {@link isModuleFile} for fast suffix lookups.
 */
let moduleFileSuffixes = new Set<string>();

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

    // Push the watcher and its event subscriptions into context.subscriptions
    // so they are deterministically disposed when the extension deactivates.
    context.subscriptions.push(
        fileWatcher,
        fileWatcher.onDidCreate(uri => addToCache(uri)),
        fileWatcher.onDidDelete(uri => removeFromCache(uri)),
    );

    watcher = fileWatcher;
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
    return moduleFileSuffixes.has(moduleSlashPath);
}

/**
 * Checks whether a module name corresponds to a local project module
 * by looking up its root package in the workspace filesystem.
 *
 * Only top-level (root) directories and files in the workspace are
 * considered — deeply nested directory names do not qualify.  For
 * example, `isLocalModule("models")` returns `true` when the workspace
 * has `models/user.py` at the root, but NOT when `models` only exists
 * as a subdirectory like `src/models/user.py`.
 *
 * For packages inside a `src/` layout (where the root package is not a
 * top-level workspace directory), configure them as first-party via
 * `pyproject.toml` or the `important.knownFirstParty` setting.
 */
export function isLocalModule(moduleName: string): boolean {
    if (!initialized) {
        return false;
    }

    const rootModule = moduleName.split('.')[0];
    return rootModuleIndex.has(rootModule);
}

/**
 * Disposes the file watcher and clears the cache.
 */
export function disposeModuleResolver(): void {
    watcher?.dispose();
    watcher = undefined;
    knownModulePaths.clear();
    rootModuleIndex.clear();
    moduleFileSuffixes.clear();
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
 * Shared with `pyproject-reader.ts` for consistent file discovery.
 */
export const WORKSPACE_EXCLUDE_PATTERN = '{**/node_modules/**,**/.venv/**,**/venv/**,**/.env/**,**/env/**,**/__pypackages__/**,**/.tox/**,**/.nox/**,**/.pyenv/**,**/site-packages/**}';

/**
 * Resolves a relative import to an absolute module path by using the
 * document's location and the workspace module cache.
 *
 * For example, given a file at `src/utils/retry.py` with
 * `from .logger import create_logger` (level=1, module="logger"),
 * this returns `"src.utils.logger"` when `src/utils/logger.py` exists
 * in the workspace.
 *
 * The algorithm:
 *  1. Compute the file's package path by walking up from the file's
 *     directory and collecting directory names that contain `__init__.py`.
 *  2. Go up `level` packages to find the base package.
 *  3. Append the relative module name.
 *  4. Verify the resulting path exists in the module cache.
 *
 * @returns The absolute dotted module path, or `undefined` if it cannot
 *          be resolved (e.g. no `__init__.py` chain, or the target module
 *          is not in the workspace cache).
 */
export function resolveRelativeImport(
    documentUri: vscode.Uri,
    level: number,
    moduleName: string,
): string | undefined {
    if (!initialized) {
        return undefined;
    }

    // Strip leading dots from the module name — the `level` parameter
    // already encodes the relative depth, so dots in the name are redundant.
    const cleanModule = moduleName.replace(/^\.+/, '');

    const docRelative = vscode.workspace.asRelativePath(documentUri, false);
    const parts = docRelative.replace(/\\/g, '/').split('/');

    // Remove the filename to get the directory segments
    parts.pop();

    // Go up `level` directories (level=1 means current package, level=2 parent, etc.)
    // level=1 refers to the current directory, so we go up (level - 1) extra levels
    for (let i = 1; i < level; i++) {
        if (parts.length === 0) {
            return undefined; // Can't go above workspace root
        }
        parts.pop();
    }

    // Build the candidate module path
    const basePath = parts.join('/');
    const modulePath = cleanModule
        ? (basePath ? `${basePath}/${cleanModule.replace(/\./g, '/')}` : cleanModule.replace(/\./g, '/'))
        : basePath;

    if (!modulePath) {
        return undefined;
    }

    // Check if the module exists in the cache (as a .py file or package)
    if (knownModulePaths.has(modulePath) || knownModulePaths.has(`${modulePath}/__init__`)) {
        // Walk up from the module path to find the package root — the
        // deepest ancestor that does NOT have an `__init__.py`.
        const resolvedParts = modulePath.split('/');
        let packageRoot = 0;
        for (let i = 0; i < resolvedParts.length - 1; i++) {
            const prefix = resolvedParts.slice(0, i + 1).join('/');
            if (!knownModulePaths.has(`${prefix}/__init__`)) {
                packageRoot = i + 1;
            }
        }
        if (packageRoot >= resolvedParts.length) {
            return undefined;
        }
        return resolvedParts.slice(packageRoot).join('.');
    }

    return undefined;
}

/**
 * Rebuilds the module-path cache and derived indices from all `.py`
 * files in the workspace.
 */
async function rebuildCache(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.py', WORKSPACE_EXCLUDE_PATTERN);
    const paths = new Set<string>();

    for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file, false);
        // Strip the .py extension to get the module path
        // e.g. "mcp_servers/data/company_data.py" → "mcp_servers/data/company_data"
        const modulePath = relativePath.replace(/\.py$/, '');
        paths.add(modulePath);
    }

    knownModulePaths = paths;
    rebuildIndices();
    log(`Module cache rebuilt — ${paths.size} Python file(s) indexed.`);
}

/**
 * Derives the secondary indices ({@link rootModuleIndex} and
 * {@link moduleFileSuffixes}) from {@link knownModulePaths}.
 */
function rebuildIndices(): void {
    const roots = new Set<string>();
    const suffixes = new Set<string>();

    for (const modulePath of knownModulePaths) {
        // Only index the first (root-level) segment — deeper segments
        // are not root-level Python packages and must not cause
        // third-party modules to be miscategorised as local.
        const firstSlash = modulePath.indexOf('/');
        const rootSegment = firstSlash === -1 ? modulePath : modulePath.substring(0, firstSlash);
        roots.add(rootSegment);

        // Build suffix set for isModuleFile: store the path itself and
        // every unique slash-suffix, excluding __init__ paths.
        // Skip single-segment suffixes — they are ambiguous between a
        // package name and a same-named file inside the package (e.g.
        // `helpers/helpers.py` produces suffix `helpers` which collides
        // with the `helpers` package itself).
        if (!modulePath.endsWith('/__init__')) {
            suffixes.add(modulePath);
            let idx = modulePath.indexOf('/');
            while (idx !== -1) {
                const suffix = modulePath.slice(idx + 1);
                if (suffix.includes('/')) {
                    suffixes.add(suffix);
                }
                idx = modulePath.indexOf('/', idx + 1);
            }
        }
    }

    rootModuleIndex = roots;
    moduleFileSuffixes = suffixes;
}

/**
 * Incrementally adds a single `.py` file to the cache and indices.
 */
function addToCache(uri: vscode.Uri): void {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const modulePath = relativePath.replace(/\.py$/, '');

    if (knownModulePaths.has(modulePath)) {
        return;
    }

    knownModulePaths.add(modulePath);

    // Update rootModuleIndex — only the first segment
    const firstSlash = modulePath.indexOf('/');
    const rootSegment = firstSlash === -1 ? modulePath : modulePath.substring(0, firstSlash);
    rootModuleIndex.add(rootSegment);

    // Update moduleFileSuffixes (skip single-segment suffixes)
    if (!modulePath.endsWith('/__init__')) {
        moduleFileSuffixes.add(modulePath);
        let idx = modulePath.indexOf('/');
        while (idx !== -1) {
            const suffix = modulePath.slice(idx + 1);
            if (suffix.includes('/')) {
                moduleFileSuffixes.add(suffix);
            }
            idx = modulePath.indexOf('/', idx + 1);
        }
    }

    log(`Module cache updated (+${relativePath})`);
}

/**
 * Incrementally removes a single `.py` file from the cache.
 * Rebuilds indices fully since suffix/segment removal is non-trivial.
 */
function removeFromCache(uri: vscode.Uri): void {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const modulePath = relativePath.replace(/\.py$/, '');

    if (!knownModulePaths.delete(modulePath)) {
        return;
    }

    // Full index rebuild — removal of shared segments/suffixes requires it
    rebuildIndices();
    log(`Module cache updated (-${relativePath})`);
}
