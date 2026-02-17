import * as vscode from 'vscode';
import type { ImportIssueCode } from '../types';

/**
 * Regex matching an existing `# noqa: important` comment, with an optional
 * bracketed rule list.  Used to detect whether a noqa comment is already
 * present so we can extend it rather than adding a duplicate.
 */
const EXISTING_NOQA = /# *noqa: *important(?:\[([^\]]*)\])?/i;

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

        // Collect all diagnostics that intersect the cursor / selection
        const diagnosticsAtCursor = importDiagnostics.filter(d =>
            d.range.intersection(range) !== undefined
        );

        const actions: vscode.CodeAction[] = [];

        if (diagnosticsAtCursor.length > 0) {
            // Context-aware fix action using the first diagnostic's message
            const fixAction = new vscode.CodeAction(
                `Fix: ${diagnosticsAtCursor[0].message.split('.')[0]}`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.command = {
                command: 'important.fixImports',
                title: 'Fix all import issues',
            };
            fixAction.isPreferred = true;
            actions.push(fixAction);

            // Offer a suppress action for each diagnostic at the cursor
            for (const diag of diagnosticsAtCursor) {
                const ruleCode = diag.code as ImportIssueCode;
                const noqaAction = buildNoqaAction(document, diag, ruleCode);
                if (noqaAction) {
                    actions.push(noqaAction);
                }
            }

            // When multiple diagnostics exist, offer a single action that
            // suppresses all of them at once with one noqa comment
            if (diagnosticsAtCursor.length > 1) {
                const ruleCodes = [...new Set(
                    diagnosticsAtCursor.map(d => d.code as ImportIssueCode)
                )];
                const suppressAllAction = buildNoqaActionForMultiple(
                    document, diagnosticsAtCursor, ruleCodes,
                );
                if (suppressAllAction) {
                    actions.push(suppressAllAction);
                }
            }
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

/**
 * Builds a code action that adds or extends a `# noqa: important[rule]`
 * comment on the import line targeted by the given diagnostic.
 *
 * If the line already has a blanket `# noqa: important` (no brackets),
 * the rule is already suppressed — no action is returned.
 *
 * If the line already has `# noqa: important[other-rule]`, the new rule
 * code is appended: `# noqa: important[other-rule, new-rule]`.
 */
function buildNoqaAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    ruleCode: ImportIssueCode,
): vscode.CodeAction | undefined {
    // Determine the line to annotate — use the start of the diagnostic range
    // which corresponds to the import's first line.  For multiline imports
    // the closing `)` line would also work, but the first line is more visible.
    const lineNumber = diagnostic.range.start.line;
    const lineText = document.lineAt(lineNumber).text;

    const existingMatch = lineText.match(EXISTING_NOQA);

    if (existingMatch) {
        // Blanket noqa (no brackets) — already suppresses everything.
        if (existingMatch[0].match(/important\s*$/i)) {
            return undefined;
        }

        // Bracketed noqa — check if this rule is already listed.
        const existingRules = existingMatch[1] ?? '';
        const ruleList = existingRules.split(',').map(s => s.trim()).filter(Boolean);
        if (ruleList.includes(ruleCode)) {
            return undefined; // Already suppressed
        }

        // Append the new rule code inside the existing brackets.
        const updatedRules = [...ruleList, ruleCode].join(', ');
        const updatedComment = `# noqa: important[${updatedRules}]`;

        const action = new vscode.CodeAction(
            `Suppress '${ruleCode}' with noqa comment`,
            vscode.CodeActionKind.QuickFix,
        );
        const edit = new vscode.WorkspaceEdit();
        const matchStart = lineText.indexOf(existingMatch[0]);
        const matchEnd = matchStart + existingMatch[0].length;
        edit.replace(
            document.uri,
            new vscode.Range(lineNumber, matchStart, lineNumber, matchEnd),
            updatedComment,
        );
        action.edit = edit;
        action.diagnostics = [diagnostic];
        return action;
    }

    // No existing noqa comment — append one at the end of the line.
    const comment = `  # noqa: important[${ruleCode}]`;
    const action = new vscode.CodeAction(
        `Suppress '${ruleCode}' with noqa comment`,
        vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    const endOfLine = new vscode.Position(lineNumber, lineText.length);
    edit.insert(document.uri, endOfLine, comment);
    action.edit = edit;
    action.diagnostics = [diagnostic];
    return action;
}

/**
 * Builds a single code action that suppresses multiple rule codes at once
 * by inserting or extending a `# noqa: important[rule1, rule2, ...]` comment.
 */
function buildNoqaActionForMultiple(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    ruleCodes: ImportIssueCode[],
): vscode.CodeAction | undefined {
    if (ruleCodes.length === 0) {
        return undefined;
    }

    const lineNumber = diagnostics[0].range.start.line;
    const lineText = document.lineAt(lineNumber).text;

    const existingMatch = lineText.match(EXISTING_NOQA);

    if (existingMatch) {
        // Blanket noqa — already suppresses everything.
        if (existingMatch[0].match(/important\s*$/i)) {
            return undefined;
        }

        // Merge new rule codes with existing ones, deduplicating.
        const existingRules = (existingMatch[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const merged = [...new Set([...existingRules, ...ruleCodes])];

        // If nothing new to add, skip.
        if (merged.length === existingRules.length) {
            return undefined;
        }

        const updatedComment = `# noqa: important[${merged.join(', ')}]`;
        const action = new vscode.CodeAction(
            `Suppress all (${ruleCodes.length}) with noqa comment`,
            vscode.CodeActionKind.QuickFix,
        );
        const edit = new vscode.WorkspaceEdit();
        const matchStart = lineText.indexOf(existingMatch[0]);
        const matchEnd = matchStart + existingMatch[0].length;
        edit.replace(
            document.uri,
            new vscode.Range(lineNumber, matchStart, lineNumber, matchEnd),
            updatedComment,
        );
        action.edit = edit;
        action.diagnostics = diagnostics;
        return action;
    }

    // No existing noqa comment — append one with all rule codes.
    const comment = `  # noqa: important[${ruleCodes.join(', ')}]`;
    const action = new vscode.CodeAction(
        `Suppress all (${ruleCodes.length}) with noqa comment`,
        vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    const endOfLine = new vscode.Position(lineNumber, lineText.length);
    edit.insert(document.uri, endOfLine, comment);
    action.edit = edit;
    action.diagnostics = diagnostics;
    return action;
}
