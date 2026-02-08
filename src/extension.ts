import * as vscode from 'vscode';
import { getValidation, invalidateValidation, disposeValidationCache } from './validation/validation-cache';
import { issuesToDiagnostics } from './validation/diagnostics';
import { ImportCodeActionProvider } from './providers/code-action-provider';
import { ImportHoverProvider } from './providers/hover-provider';
import { fixAllImports } from './fixes/fix-imports';
import { initModuleResolver, disposeModuleResolver, ensureModuleResolverReady, setGlobalFirstPartyModules, setScopedFirstPartyModules, getFirstPartyModulesSummary } from './utils/module-resolver';
import { readFirstPartyFromPyproject, readLineLengthFromPyproject } from './utils/pyproject-reader';
import { createOutputChannel, log, logError } from './utils/logger';
import type { ImportantConfig } from './types';

/** Effective line length for import formatting (resolved from config / pyproject.toml) */
let effectiveLineLength = 88;

/** Diagnostic collection for import validation issues */
let diagnosticCollection: vscode.DiagnosticCollection;

/** Disposables for config-dependent event handlers that may need re-registration */
let configDependentDisposables: vscode.Disposable[] = [];

/**
 * Activates the Important extension.
 */
export function activate(context: vscode.ExtensionContext): void {
    // Create the output channel for logging
    context.subscriptions.push(createOutputChannel());
    log('Important extension activating…');

    // Scan workspace for Python modules (async, non-blocking)
    log('Initialising module resolver — scanning workspace for Python files…');
    initModuleResolver(context).catch(err => logError(`Module resolver init failed: ${err}`));

    // Load first-party module configuration (async, non-blocking)
    log('Loading first-party module configuration…');
    loadFirstPartyModules().catch(err => logError(`Failed to load first-party modules: ${err}`));

    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('important');
    context.subscriptions.push(diagnosticCollection);

    // Register code action provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'python', scheme: 'file' },
            new ImportCodeActionProvider(diagnosticCollection),
            { providedCodeActionKinds: ImportCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Register hover provider for additional issue information
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'python', scheme: 'file' },
            new ImportHoverProvider(diagnosticCollection)
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('important.showFirstPartyModules', () => {
            const summary = getFirstPartyModulesSummary();
            vscode.window.showInformationMessage(summary);
        }),
        vscode.commands.registerCommand('important.fixImports', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('No Python file is currently open.');
                return;
            }

            const changesMade = await fixAllImports(editor, effectiveLineLength);

            // Revalidate after fixes to update diagnostics
            validateDocument(editor.document);

            if (changesMade === 0) {
                log('No import issues to fix.');
                vscode.window.showInformationMessage('No import issues to fix.');
            } else {
                log('Import fixes applied successfully.');
            }
        })
    );

    // Validate on document open (always active)
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'python') {
                validateDocument(doc);
            }
        })
    );

    // Revalidate when switching to a Python file (catches missed updates)
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'python') {
                validateDocument(editor.document);
            }
        })
    );

    // Revalidate when visible text editors change (catches workspace edit completions)
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                if (editor.document.languageId === 'python') {
                    scheduleValidation(editor.document);
                }
            }
        })
    );

    // Always listen to document changes - this is the most reliable way to catch
    // all changes including undo/redo, formatter changes, and typing
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'python' && event.contentChanges.length > 0) {
                const config = getConfig();
                if (config.validateOnType) {
                    scheduleValidation(event.document);
                }
            }
        })
    );

    // Clear diagnostics and validation cache when document is closed (always active)
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
            invalidateValidation(doc.uri);
        })
    );

    // Register config-dependent handlers
    registerConfigDependentHandlers();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('important')) {
                log('Configuration changed — reloading…');
                // Re-register handlers with new configuration
                registerConfigDependentHandlers();
                // Reload first-party modules in case the setting changed
                loadFirstPartyModules().catch(err => logError(`Reload failed: ${err}`));
            }
        })
    );

    // Validate already-open Python documents once the module resolver is ready
    ensureModuleResolverReady().then(() => {
        const pythonDocs = vscode.workspace.textDocuments.filter(d => d.languageId === 'python');
        if (pythonDocs.length > 0) {
            log(`Module resolver ready — validating ${pythonDocs.length} open Python document(s)…`);
            for (const document of pythonDocs) {
                validateDocument(document);
            }
        } else {
            log('Module resolver ready — no open Python documents to validate.');
        }
    }).catch(err => logError(`Module resolver failed: ${err}`));

    // Watch for pyproject.toml changes to auto-reload first-party modules
    const tomlWatcher = vscode.workspace.createFileSystemWatcher('**/pyproject.toml');
    tomlWatcher.onDidChange(() => { log('pyproject.toml changed — reloading first-party modules…'); loadFirstPartyModules().catch(err => logError(`Reload failed: ${err}`)); });
    tomlWatcher.onDidCreate(() => { log('pyproject.toml created — loading first-party modules…'); loadFirstPartyModules().catch(err => logError(`Load failed: ${err}`)); });
    tomlWatcher.onDidDelete(() => { log('pyproject.toml deleted — reloading first-party modules…'); loadFirstPartyModules().catch(err => logError(`Reload failed: ${err}`)); });
    context.subscriptions.push(tomlWatcher);

    log('Important extension activated.');
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {
    log('Important extension deactivating…');

    // Clear all pending validation timers
    for (const timer of pendingValidations.values()) {
        clearTimeout(timer);
    }
    pendingValidations.clear();

    // Dispose config-dependent handlers
    for (const d of configDependentDisposables) {
        d.dispose();
    }
    configDependentDisposables = [];

    disposeModuleResolver();
    disposeValidationCache();
    diagnosticCollection?.dispose();
}

/**
 * Gets the extension configuration.
 */
function getConfig(): ImportantConfig {
    const config = vscode.workspace.getConfiguration('important');
    return {
        validateOnSave: config.get<boolean>('validateOnSave', true),
        validateOnType: config.get<boolean>('validateOnType', true),
        styleGuide: config.get<'google'>('styleGuide', 'google'),
        knownFirstParty: config.get<string[]>('knownFirstParty', []),
        readFromPyprojectToml: config.get<boolean>('readFromPyprojectToml', true),
        lineLength: config.get<number>('lineLength', 0),
    };
}

/**
 * Loads first-party module names from the extension config and,
 * optionally, from `pyproject.toml`.  Merges both sources and
 * updates the module resolver.
 */
async function loadFirstPartyModules(): Promise<void> {
    const config = getConfig();

    // Global first-party modules from VS Code settings — apply to all documents
    if (config.knownFirstParty.length > 0) {
        log(`First-party modules from settings (global): ${config.knownFirstParty.join(', ')}`);
    }
    setGlobalFirstPartyModules(config.knownFirstParty);

    // Scoped first-party modules from pyproject.toml files
    if (config.readFromPyprojectToml) {
        const scoped = await readFirstPartyFromPyproject();
        setScopedFirstPartyModules(scoped);
        if (scoped.length > 0) {
            for (const entry of scoped) {
                log(`First-party modules from pyproject.toml (${entry.dirPath}): ${entry.modules.join(', ')}`);
            }
        }
    } else {
        log('pyproject.toml reading is disabled.');
        setScopedFirstPartyModules([]);
    }

    // Resolve effective line length: explicit setting > pyproject.toml > Ruff default (88)
    if (config.lineLength > 0) {
        effectiveLineLength = config.lineLength;
        log(`Line length from settings: ${effectiveLineLength}`);
    } else if (config.readFromPyprojectToml) {
        effectiveLineLength = await readLineLengthFromPyproject();
        log(`Line length (auto-detected): ${effectiveLineLength}`);
    } else {
        effectiveLineLength = 88;
        log(`Line length (default): ${effectiveLineLength}`);
    }
}

/** Pending validation timers keyed by document URI */
const pendingValidations = new Map<string, NodeJS.Timeout>();

/** Debounce delay for validation (ms) - kept short for responsive feedback */
const VALIDATION_DELAY = 50;

/**
 * Registers event handlers that depend on configuration settings.
 * Disposes previous handlers before registering new ones.
 */
function registerConfigDependentHandlers(): void {
    // Dispose existing config-dependent handlers
    for (const d of configDependentDisposables) {
        d.dispose();
    }
    configDependentDisposables = [];

    const config = getConfig();

    // Validate on save (if enabled)
    if (config.validateOnSave) {
        configDependentDisposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.languageId === 'python') {
                    validateDocument(doc);
                }
            })
        );
    }
}

/**
 * Schedules a debounced validation for a document.
 */
function scheduleValidation(document: vscode.TextDocument): void {
    const uri = document.uri.toString();

    // Clear any pending validation
    const existing = pendingValidations.get(uri);
    if (existing) {
        clearTimeout(existing);
    }

    // Schedule new validation
    const timeout = setTimeout(async () => {
        pendingValidations.delete(uri);
        // Use openTextDocument to get a fresh reference to the document
        try {
            const currentDoc = await vscode.workspace.openTextDocument(document.uri);
            validateDocument(currentDoc);
        } catch {
            // Document may have been closed
        }
    }, VALIDATION_DELAY);

    pendingValidations.set(uri, timeout);
}

/**
 * Validates a document and updates diagnostics.
 * Ensures the module resolver is ready before running validation
 * so that import categorisation (stdlib / third-party / local) is accurate.
 */
function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'python') {
        return;
    }

    void ensureModuleResolverReady().then(() => {
        const { issues } = getValidation(document);
        const diagnostics = issuesToDiagnostics(issues);
        diagnosticCollection.set(document.uri, diagnostics);
    });
}

