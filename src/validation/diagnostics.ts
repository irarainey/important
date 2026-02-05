import * as vscode from 'vscode';
import type { ImportIssue } from '../types';

/**
 * Converts ImportIssues to VS Code Diagnostics.
 */
export function issuesToDiagnostics(issues: readonly ImportIssue[]): vscode.Diagnostic[] {
    return issues.map(issue => {
        const diagnostic = new vscode.Diagnostic(
            issue.range,
            issue.message,
            issue.severity
        );
        diagnostic.code = issue.code;
        diagnostic.source = 'Important';
        return diagnostic;
    });
}
