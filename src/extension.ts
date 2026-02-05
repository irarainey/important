import * as vscode from 'vscode';
import * as fs from 'fs';
import { validateImports, issuesToDiagnostics } from './import-validator';
import { ImportCodeActionProvider, fixAllImports } from './code-action-provider';
import { ImportHoverProvider } from './hover-provider';
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

    // Sort imports using isort
    context.subscriptions.push(
        vscode.commands.registerCommand('important.sortImportsWithIsort', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'python') {
                vscode.window.showWarningMessage('No Python file is currently open.');
                return;
            }

            // Save the document first
            await editor.document.save();

            const config = vscode.workspace.getConfiguration('important');
            let isortPath = config.get<string>('isortPath', 'isort');

            // Try to use bundled isort if not explicitly configured
            if (isortPath === 'isort') {
                const bundledPath = getBundledIsortPath(context.extensionPath);
                if (bundledPath) {
                    isortPath = bundledPath;
                }
            }

            const filePath = editor.document.uri.fsPath;

            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            try {
                // Run isort with Google profile
                await execAsync(`"${isortPath}" --profile google "${filePath}"`);
                vscode.window.showInformationMessage('Imports sorted with isort.');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                if (errorMsg.includes('not found') || errorMsg.includes('command not found')) {
                    vscode.window.showErrorMessage(
                        'isort not found. Install it with: pip install isort'
                    );
                } else {
                    vscode.window.showErrorMessage(`isort failed: ${errorMsg}`);
                }
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

/**
 * Gets the path to the bundled isort executable if it exists.
 */
function getBundledIsortPath(extensionPath: string): string | undefined {
    const platform = process.platform;
    let isortRelativePath: string;

    if (platform === 'win32') {
        isortRelativePath = 'python-runtime/win/Scripts/isort.exe';
    } else if (platform === 'darwin') {
        isortRelativePath = 'python-runtime/darwin/bin/isort';
    } else {
        isortRelativePath = 'python-runtime/linux/bin/isort';
    }

    const isortPath = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), isortRelativePath).fsPath;

    if (fs.existsSync(isortPath)) {
        return isortPath;
    }

    return undefined;
}

/** Pending validation timers keyed by document URI */
const pendingValidations = new Map<string, NodeJS.Timeout>();

/** Debounce delay for validation (ms) */
const VALIDATION_DELAY = 300;

/**
 * Registers event handlers that depend on configuration settings.
 * Disposes previous handlers before registering new ones.
 */
function registerConfigDependentHandlers(): void {
    // Dispose existing config-dependent handlers
    configDependentDisposables.forEach(d => d.dispose());
    configDependentDisposables = [];

    const config = getConfig();

    // Validate on document change - covers typing, formatting, and other modifications
    if (config.validateOnType) {
        configDependentDisposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'python') {
                    scheduleValidation(event.document);
                }
            })
        );
    }

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
    const timeout = setTimeout(() => {
        pendingValidations.delete(uri);
        // Re-fetch the document in case it changed
        const currentDoc = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === uri
        );
        if (currentDoc) {
            validateDocument(currentDoc);
        }
    }, VALIDATION_DELAY);

    pendingValidations.set(uri, timeout);
}

/**
 * Validates a document and updates diagnostics.
 */
function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'python') {
        return;
    }

    const issues: ImportIssue[] = validateImports(document);
    const diagnostics = issuesToDiagnostics(issues);

    diagnosticCollection.set(document.uri, diagnostics);
    codeActionProvider.updateIssues(document.uri, issues);
}

