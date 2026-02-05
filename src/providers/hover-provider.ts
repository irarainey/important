import * as vscode from 'vscode';

/**
 * Provides hover information for import validation diagnostics.
 */
export class ImportHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly diagnosticCollection: vscode.DiagnosticCollection
    ) { }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | undefined {
        const diagnostics = this.diagnosticCollection.get(document.uri) ?? [];
        const matchingDiagnostic = [...diagnostics].find(d =>
            d.range.contains(position)
        );

        if (matchingDiagnostic) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**Important**: ${matchingDiagnostic.message}\n\n`);
            markdown.appendMarkdown(`*Rule: \`${matchingDiagnostic.code}\`*`);
            return new vscode.Hover(markdown);
        }

        return undefined;
    }
}
