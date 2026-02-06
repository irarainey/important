import * as vscode from 'vscode';

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

/** Whether the initial scan has completed. */
let initialized = false;

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
    await rebuildCache();
    initialized = true;

    // Watch for Python file creation / deletion to keep the cache current.
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.py');

    fileWatcher.onDidCreate(() => void rebuildCache());
    fileWatcher.onDidDelete(() => void rebuildCache());

    watcher = fileWatcher;
    context.subscriptions.push(fileWatcher);
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
 * Disposes the file watcher and clears the cache.
 */
export function disposeModuleResolver(): void {
    watcher?.dispose();
    watcher = undefined;
    knownModulePaths.clear();
    initialized = false;
}

/**
 * Rebuilds the module-path cache from all `.py` files in the workspace.
 */
async function rebuildCache(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
    const paths = new Set<string>();

    for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file, false);
        // Strip the .py extension to get the module path
        // e.g. "mcp_servers/data/company_data.py" → "mcp_servers/data/company_data"
        const modulePath = relativePath.replace(/\.py$/, '');
        paths.add(modulePath);
    }

    knownModulePaths = paths;
}
