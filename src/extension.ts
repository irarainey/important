import * as vscode from 'vscode';
import { validateImports } from './validation/import-validator';
import { issuesToDiagnostics } from './validation/diagnostics';
import { ImportCodeActionProvider } from './providers/code-action-provider';
import { ImportHoverProvider } from './providers/hover-provider';
import { fixAllImports } from './fixes/fix-imports';
import type { ImportIssue, ImportantConfig } from './types';

/** Diagnostic collection for import validation issues */
let diagnosticCollection: vscode.DiagnosticCollection;

/** Code action provider instance (shared for issue caching) */
let codeActionProvider: ImportCodeActionProvider;

/** Disposables for config-dependent event handlers that may need re-registration */
let configDependentDisposables: vscode.Disposable[] = [];

/**
 * Activates the Important extension.
 */
export function activate(context: vscode.ExtensionContext): void {
    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection('important');
    context.subscriptions.push(diagnosticCollection);

    // Create and register code action provider
    codeActionProvider = new ImportCodeActionProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'python', scheme: 'file' },
            codeActionProvider,
            { providedCodeActionKinds: ImportCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Register hover provider for additional issue information
    const hoverProvider = new ImportHoverProvider(diagnosticCollection);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'python', scheme: 'file' },
            hoverProvider
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('important.fixImports', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('No Python file is currently open.');
                return;
            }

            const fixedCount = await fixAllImports(editor);

            // Revalidate after fixes to update diagnostics
            await new Promise(resolve => setTimeout(resolve, 50));
            validateDocument(editor.document);

            if (fixedCount > 0) {
                vscode.window.showInformationMessage(`Fixed ${fixedCount} import issue(s).`);
            } else {
                vscode.window.showInformationMessage('No fixable import issues found.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('important.validateImports', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('No Python file is currently open.');
                return;
            }

            validateDocument(editor.document);
            const diagnostics = diagnosticCollection.get(editor.document.uri);
            const count = diagnostics?.length ?? 0;

            if (count > 0) {
                vscode.window.showWarningMessage(`Found ${count} import issue(s).`);
            } else {
                vscode.window.showInformationMessage('No import issues found.');
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

    // Clear diagnostics when document is closed (always active)
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
            codeActionProvider.clearIssues(doc.uri);
        })
    );

    // Register config-dependent handlers
    registerConfigDependentHandlers();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('important')) {
                // Re-register handlers with new configuration
                registerConfigDependentHandlers();
            }
        })
    );

    // Validate already-open Python documents
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'python') {
            validateDocument(document);
        }
    }
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {
    // Clear all pending validation timers
    pendingValidations.forEach(timer => clearTimeout(timer));
    pendingValidations.clear();

    // Dispose config-dependent handlers
    configDependentDisposables.forEach(d => d.dispose());
    configDependentDisposables = [];

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
    };
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
    configDependentDisposables.forEach(d => d.dispose());
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
 */
export function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'python') {
        return;
    }

    const issues: ImportIssue[] = validateImports(document);
    const diagnostics = issuesToDiagnostics(issues);

    diagnosticCollection.set(document.uri, diagnostics);
    codeActionProvider.updateIssues(document.uri, issues);
}

