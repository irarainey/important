import * as vscode from 'vscode';

/**
 * Provides code actions (quick fixes) for import validation issues.
 *
 * Reads diagnostics from the shared diagnostic collection rather than
 * re-running validation, avoiding duplicate work on every code-action
 * request.
 */
export class ImportCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    constructor(
        private readonly diagnosticCollection: vscode.DiagnosticCollection
    ) { }

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        const diagnostics = this.diagnosticCollection.get(document.uri) ?? [];

        // Filter to Important diagnostics only
        const importDiagnostics = [...diagnostics].filter(d => d.source === 'Important');

        if (importDiagnostics.length === 0) {
            return undefined;
        }

        // Check if we're on a line with an issue for context-specific actions
        const diagnosticAtCursor = importDiagnostics.find(d =>
            d.range.intersection(range) !== undefined
        );

        const actions: vscode.CodeAction[] = [];

        // If on a specific issue, provide a targeted fix (from diagnostic relatedInformation
        // is not available, but we can offer the fix-all command)
        if (diagnosticAtCursor) {
            // Note: individual fixes are handled by the fixAll command
            // We still show a context-aware label
            const fixAction = new vscode.CodeAction(
                `Fix: ${diagnosticAtCursor.message.split('.')[0]}`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.command = {
                command: 'important.fixImports',
                title: 'Fix all import issues',
            };
            fixAction.isPreferred = true;
            actions.push(fixAction);
        }

        // Always provide "Fix All" action if there are any issues in the file
        const fixAllAction = new vscode.CodeAction(
            `Fix all import issues (${importDiagnostics.length} issue${importDiagnostics.length > 1 ? 's' : ''})`,
            vscode.CodeActionKind.QuickFix
        );
        fixAllAction.command = {
            command: 'important.fixImports',
            title: 'Fix all import issues',
        };
        actions.push(fixAllAction);

        return actions.length > 0 ? actions : undefined;
    }
}
