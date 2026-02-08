/**
 * Mock for the `vscode` module used throughout the extension.
 *
 * Provides lightweight implementations of Position, Range, Uri,
 * DiagnosticSeverity, TextDocument, WorkspaceEdit, and workspace
 * utilities — just enough to run the parser, validator, and sorter
 * in a plain Node.js / Mocha environment.
 */

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------
export class Position {
    constructor(
        public readonly line: number,
        public readonly character: number,
    ) { }

    translate(lineDelta = 0, characterDelta = 0): Position {
        return new Position(this.line + lineDelta, this.character + characterDelta);
    }

    isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }

    isBefore(other: Position): boolean {
        return this.line < other.line || (this.line === other.line && this.character < other.character);
    }

    isAfter(other: Position): boolean {
        return other.isBefore(this);
    }

    compareTo(other: Position): number {
        if (this.line < other.line) return -1;
        if (this.line > other.line) return 1;
        if (this.character < other.character) return -1;
        if (this.character > other.character) return 1;
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------
export class Range {
    public readonly start: Position;
    public readonly end: Position;

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    constructor(start: Position, end: Position);
    constructor(
        startOrLine: Position | number,
        endOrCharacter: Position | number,
        endLine?: number,
        endCharacter?: number,
    ) {
        if (typeof startOrLine === 'number') {
            this.start = new Position(startOrLine, endOrCharacter as number);
            this.end = new Position(endLine!, endCharacter!);
        } else {
            this.start = startOrLine;
            this.end = endOrCharacter as Position;
        }
    }

    get isEmpty(): boolean {
        return this.start.isEqual(this.end);
    }

    contains(positionOrRange: Position | Range): boolean {
        if (positionOrRange instanceof Range) {
            return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
        }
        const pos = positionOrRange;
        return !pos.isBefore(this.start) && !pos.isAfter(this.end);
    }
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------
export class Uri {
    public readonly scheme: string;
    public readonly path: string;
    public readonly fsPath: string;

    private constructor(scheme: string, path: string) {
        this.scheme = scheme;
        this.path = path;
        this.fsPath = path;
    }

    static file(path: string): Uri {
        return new Uri('file', path);
    }

    static parse(value: string): Uri {
        const m = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)/);
        if (m) {
            return new Uri(m[1], m[2]);
        }
        return new Uri('file', value);
    }

    toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

// ---------------------------------------------------------------------------
// DiagnosticSeverity
// ---------------------------------------------------------------------------
export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------
export class Diagnostic {
    public code?: string | number;
    public source?: string;

    constructor(
        public range: Range,
        public message: string,
        public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
    ) { }
}

// ---------------------------------------------------------------------------
// TextLine (internal helper)
// ---------------------------------------------------------------------------
class TextLine {
    public readonly lineNumber: number;
    public readonly text: string;
    public readonly range: Range;
    public readonly rangeIncludingLineBreak: Range;
    public readonly firstNonWhitespaceCharacterIndex: number;
    public readonly isEmptyOrWhitespace: boolean;

    constructor(lineNumber: number, text: string, lastLine: boolean) {
        this.lineNumber = lineNumber;
        this.text = text;
        this.range = new Range(lineNumber, 0, lineNumber, text.length);
        this.rangeIncludingLineBreak = lastLine
            ? this.range
            : new Range(lineNumber, 0, lineNumber + 1, 0);
        const match = text.match(/\S/);
        this.firstNonWhitespaceCharacterIndex = match ? match.index! : text.length;
        this.isEmptyOrWhitespace = this.firstNonWhitespaceCharacterIndex === text.length;
    }
}

// ---------------------------------------------------------------------------
// TextDocument
// ---------------------------------------------------------------------------
export class MockTextDocument {
    public readonly uri: Uri;
    public readonly fileName: string;
    public readonly languageId: string;
    public readonly version: number;
    private readonly _lines: string[];

    constructor(content: string, fileName = 'test.py', languageId = 'python') {
        this._lines = content.split('\n');
        this.uri = Uri.file(fileName);
        this.fileName = fileName;
        this.languageId = languageId;
        this.version = 1;
    }

    get lineCount(): number {
        return this._lines.length;
    }

    lineAt(line: number): TextLine {
        if (line < 0 || line >= this._lines.length) {
            throw new Error(`Illegal line number ${line} (lineCount ${this._lines.length})`);
        }
        return new TextLine(line, this._lines[line], line === this._lines.length - 1);
    }

    getText(range?: Range): string {
        if (!range) {
            return this._lines.join('\n');
        }
        const startLine = range.start.line;
        const endLine = range.end.line;
        if (startLine === endLine) {
            return this._lines[startLine].substring(range.start.character, range.end.character);
        }
        const parts: string[] = [];
        parts.push(this._lines[startLine].substring(range.start.character));
        for (let i = startLine + 1; i < endLine; i++) {
            parts.push(this._lines[i]);
        }
        parts.push(this._lines[endLine].substring(0, range.end.character));
        return parts.join('\n');
    }

    positionAt(offset: number): Position {
        let remaining = offset;
        for (let i = 0; i < this._lines.length; i++) {
            const lineLen = this._lines[i].length + 1; // +1 for newline
            if (remaining < lineLen || i === this._lines.length - 1) {
                return new Position(i, Math.min(remaining, this._lines[i].length));
            }
            remaining -= lineLen;
        }
        return new Position(this._lines.length - 1, this._lines[this._lines.length - 1].length);
    }

    offsetAt(position: Position): number {
        let offset = 0;
        for (let i = 0; i < position.line && i < this._lines.length; i++) {
            offset += this._lines[i].length + 1;
        }
        offset += Math.min(position.character, this._lines[position.line]?.length ?? 0);
        return offset;
    }
}

// ---------------------------------------------------------------------------
// TextEdit
// ---------------------------------------------------------------------------
export class TextEdit {
    constructor(
        public range: Range,
        public newText: string,
    ) { }

    static replace(range: Range, newText: string): TextEdit {
        return new TextEdit(range, newText);
    }

    static insert(position: Position, newText: string): TextEdit {
        return new TextEdit(new Range(position, position), newText);
    }

    static delete(range: Range): TextEdit {
        return new TextEdit(range, '');
    }
}

// ---------------------------------------------------------------------------
// WorkspaceEdit
// ---------------------------------------------------------------------------
export class WorkspaceEdit {
    private _edits: Array<{ uri: Uri; edit: TextEdit }> = [];

    replace(uri: Uri, range: Range, newText: string): void {
        this._edits.push({ uri, edit: TextEdit.replace(range, newText) });
    }

    delete(uri: Uri, range: Range): void {
        this._edits.push({ uri, edit: TextEdit.delete(range) });
    }

    insert(uri: Uri, position: Position, newText: string): void {
        this._edits.push({ uri, edit: TextEdit.insert(position, newText) });
    }

    entries(): Array<[Uri, TextEdit[]]> {
        const map = new Map<string, { uri: Uri; edits: TextEdit[] }>();
        for (const { uri, edit } of this._edits) {
            const key = uri.toString();
            const entry = map.get(key);
            if (entry) {
                entry.edits.push(edit);
            } else {
                map.set(key, { uri, edits: [edit] });
            }
        }
        return [...map.values()].map(e => [e.uri, e.edits]);
    }

    get size(): number {
        return new Set(this._edits.map(e => e.uri.toString())).size;
    }

    /** Return all collected edits for testing inspection. */
    allEdits(): Array<{ uri: Uri; edit: TextEdit }> {
        return [...this._edits];
    }
}

// ---------------------------------------------------------------------------
// workspace stub
// ---------------------------------------------------------------------------
export const workspace = {
    /** Resolve a path relative to the workspace root. */
    asRelativePath(pathOrUri: string | Uri, _includeWorkspace?: boolean): string {
        const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
        // Strip a leading workspace-root prefix if present
        return p.replace(/^\/workspace\//, '');
    },

    /** Stub findFiles — tests can override via `setWorkspaceFiles`. */
    findFiles: async (_include: string, _exclude?: string): Promise<Uri[]> => {
        return _mockWorkspaceFiles.map(f => Uri.file(f));
    },

    /** Stub applyEdit — records the edit and returns true. */
    applyEdit: async (_edit: WorkspaceEdit): Promise<boolean> => {
        _lastAppliedEdit = _edit;
        return true;
    },

    /** Open a text document by URI — not implemented for unit tests. */
    openTextDocument: async (_uri: Uri): Promise<any> => {
        throw new Error('workspace.openTextDocument is not mocked');
    },

    /** Stub createFileSystemWatcher. */
    createFileSystemWatcher: (_pattern: string) => ({
        onDidCreate: () => ({ dispose: () => { } }),
        onDidDelete: () => ({ dispose: () => { } }),
        onDidChange: () => ({ dispose: () => { } }),
        dispose: () => { },
    }),

    /** Stub getConfiguration. */
    getConfiguration: (_section?: string) => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    }),

    /** Stub fs. */
    fs: {
        stat: async (_uri: Uri) => ({ type: 1 }),
        readFile: async (_uri: Uri) => new Uint8Array(0),
    },
};

// ---------------------------------------------------------------------------
// window stub
// ---------------------------------------------------------------------------
export const window = {
    showInformationMessage: async (_msg: string, ..._items: any[]) => undefined,
    showWarningMessage: async (_msg: string, ..._items: any[]) => undefined,
    showErrorMessage: async (_msg: string, ..._items: any[]) => undefined,
    createOutputChannel: (_name: string) => ({
        appendLine: () => { },
        append: () => { },
        show: () => { },
        clear: () => { },
        dispose: () => { },
    }),
};

// ---------------------------------------------------------------------------
// languages stub
// ---------------------------------------------------------------------------
export const languages = {
    createDiagnosticCollection: (_name?: string) => ({
        set: () => { },
        delete: () => { },
        clear: () => { },
        dispose: () => { },
    }),
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let _mockWorkspaceFiles: string[] = [];
let _lastAppliedEdit: WorkspaceEdit | undefined;

/**
 * Sets the list of workspace file paths returned by `workspace.findFiles`.
 */
export function setWorkspaceFiles(files: string[]): void {
    _mockWorkspaceFiles = files;
}

/**
 * Returns the last `WorkspaceEdit` passed to `workspace.applyEdit`.
 */
export function getLastAppliedEdit(): WorkspaceEdit | undefined {
    return _lastAppliedEdit;
}

/**
 * Clears any recorded applied edits.
 */
export function clearLastAppliedEdit(): void {
    _lastAppliedEdit = undefined;
}

/**
 * Creates a `MockTextDocument` from a string.  Convenience alias.
 */
export function createMockDocument(content: string, fileName = 'test.py'): MockTextDocument {
    return new MockTextDocument(content, fileName);
}
