import * as vscode from 'vscode';

/** Shared output channel for the Important extension. */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Creates the output channel.  Call once during extension activation.
 * Returns the channel so it can be added to `context.subscriptions`.
 */
export function createOutputChannel(): vscode.OutputChannel {
    outputChannel = vscode.window.createOutputChannel('Important');
    return outputChannel;
}

/**
 * Logs an informational message to the Output channel.
 *
 * Messages are prefixed with a timestamp for easy chronological tracking.
 */
export function log(message: string): void {
    outputChannel?.appendLine(`[${timestamp()}] ${message}`);
}

/**
 * Logs a warning-level message to the Output channel.
 */
export function logWarn(message: string): void {
    outputChannel?.appendLine(`[${timestamp()}] ⚠ ${message}`);
}

/**
 * Logs an error-level message to the Output channel.
 */
export function logError(message: string): void {
    outputChannel?.appendLine(`[${timestamp()}] ✖ ${message}`);
}

/**
 * Returns an `HH:MM:SS.mmm` timestamp for log line prefixing.
 */
function timestamp(): string {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}
