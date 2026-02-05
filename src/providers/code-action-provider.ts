import * as vscode from 'vscode';
import { validateImports } from '../validation/import-validator';

/**
 * Provides code actions (quick fixes) for import validation issues.
 */
export class ImportCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        const issues = validateImports(document);

        // No issues means no code actions
        if (issues.length === 0) {
            return undefined;
        }

        // Check if we're on a line with an issue for context-specific actions
        const issueAtCursor = issues.find(issue =>
            issue.range.intersection(range) !== undefined
        );

        const actions: vscode.CodeAction[] = [];

        // If on a specific issue, provide a targeted fix (if available)
        if (issueAtCursor?.suggestedFix !== undefined) {
            const fixAction = new vscode.CodeAction(
                `Fix: ${issueAtCursor.message.split('.')[0]}`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.edit = new vscode.WorkspaceEdit();
            fixAction.edit.replace(document.uri, issueAtCursor.range, issueAtCursor.suggestedFix);
            fixAction.isPreferred = true;
            actions.push(fixAction);
        }

        // Always provide "Fix All" action if there are any issues in the file
        // (will fix what it can and leave unfixable issues alone)
        const fixAllAction = new vscode.CodeAction(
            `Fix all import issues (${issues.length} issue${issues.length > 1 ? 's' : ''})`,
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
