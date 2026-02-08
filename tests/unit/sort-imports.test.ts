import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { createMockDocument, getLastAppliedEdit, clearLastAppliedEdit, setWorkspaceFiles } from './mocks/vscode';
import { validateImports } from '../../src/validation/import-validator';
import { sortImportsInDocument } from '../../src/fixes/sort-imports';
import { initModuleResolver, disposeModuleResolver } from '../../src/utils/module-resolver';

/** Minimal mock of ExtensionContext. */
function mockContext(): any {
    return { subscriptions: [] };
}

/**
 * Helper: validate and sort a document, returning the replacement text
 * from the first WorkspaceEdit replace operation.
 */
async function sortAndGetText(content: string, lineLength = 0): Promise<string | null> {
    const doc = createMockDocument(content);
    const result = validateImports(doc as any);
    clearLastAppliedEdit();

    const changed = await sortImportsInDocument(doc as any, result, lineLength);
    if (!changed) return null;

    const edit = getLastAppliedEdit();
    if (!edit) return null;

    const edits = edit.allEdits();
    // Find the replace edit (not a delete)
    const replaceEdit = edits.find(e => e.edit.newText.length > 0);
    return replaceEdit?.edit.newText ?? null;
}

describe('sort-imports', () => {
    beforeEach(async () => {
        setWorkspaceFiles([]);
        await initModuleResolver(mockContext());
    });

    afterEach(() => {
        disposeModuleResolver();
        clearLastAppliedEdit();
    });

    // ------------------------------------------------------------------
    // Category grouping
    // ------------------------------------------------------------------
    describe('category grouping', () => {
        it('groups stdlib and third-party with a blank line separator', async () => {
            const sorted = await sortAndGetText([
                'import requests',
                'import os',
                '',
                'print(os.name, requests.__version__)',
            ].join('\n'));

            assert.ok(sorted);
            const lines = sorted!.split('\n');
            // stdlib first
            assert.ok(lines[0].includes('os'));
            // blank separator
            assert.ok(lines.includes(''));
            // third-party after
            assert.ok(sorted!.includes('import requests'));
        });

        it('puts __future__ before stdlib', async () => {
            const sorted = await sortAndGetText([
                'import os',
                'from __future__ import annotations',
                '',
                'print(os.name)',
            ].join('\n'));

            assert.ok(sorted);
            const lines = sorted!.split('\n');
            assert.ok(lines[0].includes('__future__'));
        });
    });

    // ------------------------------------------------------------------
    // Alphabetical sorting
    // ------------------------------------------------------------------
    describe('alphabetical sorting', () => {
        it('sorts imports alphabetically within a group', async () => {
            const sorted = await sortAndGetText([
                'import sys',
                'import os',
                'import json',
                '',
                'print(json.dumps({}), os.name, sys.version)',
            ].join('\n'));

            assert.ok(sorted);
            const lines = sorted!.split('\n').filter(l => l.startsWith('import'));
            assert.equal(lines[0], 'import json');
            assert.equal(lines[1], 'import os');
            assert.equal(lines[2], 'import sys');
        });

        it('puts import-style before from-style in the same group', async () => {
            const sorted = await sortAndGetText([
                'from os.path import join',
                'import os',
                '',
                'print(os.name, join("a", "b"))',
            ].join('\n'));

            assert.ok(sorted);
            const lines = sorted!.split('\n').filter(l => l.trim());
            // import os should come before from os.path import join
            const importIdx = lines.findIndex(l => l === 'import os');
            const fromIdx = lines.findIndex(l => l.startsWith('from os.path'));
            assert.ok(importIdx < fromIdx);
        });
    });

    // ------------------------------------------------------------------
    // Multi-import expansion
    // ------------------------------------------------------------------
    describe('multi-import expansion', () => {
        it('expands import os, sys, json into separate lines', async () => {
            const sorted = await sortAndGetText([
                'import os, sys, json',
                '',
                'print(os.name, sys.version, json.dumps({}))',
            ].join('\n'));

            assert.ok(sorted);
            assert.ok(sorted!.includes('import json'));
            assert.ok(sorted!.includes('import os'));
            assert.ok(sorted!.includes('import sys'));
            // Should not contain comma-separated
            assert.ok(!sorted!.includes('import os, sys'));
        });
    });

    // ------------------------------------------------------------------
    // Unused import removal
    // ------------------------------------------------------------------
    describe('unused import removal', () => {
        it('removes unused imports', async () => {
            const sorted = await sortAndGetText([
                'import os',
                'import sys',
                '',
                'print(os.name)',
            ].join('\n'));

            assert.ok(sorted);
            assert.ok(sorted!.includes('import os'));
            assert.ok(!sorted!.includes('import sys'));
        });

        it('removes unused names from from-imports', async () => {
            const sorted = await sortAndGetText([
                'from os.path import join, exists, abspath',
                '',
                'print(join("a"))',
            ].join('\n'));

            assert.ok(sorted);
            assert.ok(sorted!.includes('join'));
            assert.ok(!sorted!.includes('exists'));
            assert.ok(!sorted!.includes('abspath'));
        });
    });

    // ------------------------------------------------------------------
    // Deduplication
    // ------------------------------------------------------------------
    describe('deduplication', () => {
        it('merges duplicate from-imports for the same module', async () => {
            const sorted = await sortAndGetText([
                'from os.path import join',
                'from os.path import exists',
                '',
                'print(join("a"), exists("b"))',
            ].join('\n'));

            assert.ok(sorted);
            // Should be a single from os.path import line
            const fromLines = sorted!.split('\n').filter(l => l.startsWith('from os.path'));
            assert.equal(fromLines.length, 1);
            assert.ok(fromLines[0].includes('join'));
            assert.ok(fromLines[0].includes('exists'));
        });
    });

    // ------------------------------------------------------------------
    // Already sorted (no change)
    // ------------------------------------------------------------------
    describe('no-op on sorted imports', () => {
        it('returns false when imports are already correctly sorted', async () => {
            const content = [
                'import json',
                'import os',
                '',
                'print(json.dumps({}), os.name)',
            ].join('\n');
            const doc = createMockDocument(content);
            const result = validateImports(doc as any);
            clearLastAppliedEdit();

            const changed = await sortImportsInDocument(doc as any, result, 0);
            assert.equal(changed, false);
        });
    });

    // ------------------------------------------------------------------
    // TYPE_CHECKING block preservation
    // ------------------------------------------------------------------
    describe('TYPE_CHECKING block handling', () => {
        it('preserves TYPE_CHECKING imports when sorting regular imports', async () => {
            const content = [
                'import os',
                'from typing import TYPE_CHECKING',
                '',
                'if TYPE_CHECKING:',
                '    from typing import Protocol',
                '',
                'import sys',
                '',
                'print(os.name, sys.version)',
            ].join('\n');

            const doc = createMockDocument(content);
            const result = validateImports(doc as any);

            // If there are sorting issues, sort should preserve TC block
            if (result.issues.length > 0) {
                clearLastAppliedEdit();
                const changed = await sortImportsInDocument(doc as any, result, 0);
                if (changed) {
                    const edit = getLastAppliedEdit();
                    const allEdits = edit!.allEdits();
                    // Check that no edit destroys the TYPE_CHECKING block
                    for (const { edit: e } of allEdits) {
                        if (e.newText.length > 0) {
                            // If the new text replaces a range containing TC block,
                            // it must include the TC content
                            assert.ok(
                                !e.newText.includes('if TYPE_CHECKING') ||
                                e.newText.includes('Protocol'),
                                'TYPE_CHECKING block content must be preserved',
                            );
                        }
                    }
                }
            }
        });

        it('handles embedded TYPE_CHECKING block between regular imports', async () => {
            const content = [
                'from __future__ import annotations',
                'from typing import TYPE_CHECKING',
                'from other_library.core import base',
                'if TYPE_CHECKING:',
                '    from other_library.core.base import BaseProcessor',
                '    from other_library.core.exceptions import ProcessingError',
                'from models import sample_models',
                '',
                'print(base, sample_models, BaseProcessor, ProcessingError)',
            ].join('\n');

            const doc = createMockDocument(content);
            const result = validateImports(doc as any);

            if (result.issues.length > 0) {
                clearLastAppliedEdit();
                const changed = await sortImportsInDocument(doc as any, result, 0);
                if (changed) {
                    const edit = getLastAppliedEdit();
                    const allEdits = edit!.allEdits();
                    // The combined replacement must include the TC header and body
                    const replaceEdits = allEdits.filter(e => e.edit.newText.length > 0);
                    const combinedText = replaceEdits.map(e => e.edit.newText).join('\n');
                    assert.ok(
                        combinedText.includes('if TYPE_CHECKING:'),
                        'Embedded TC header must be in the replacement',
                    );
                    assert.ok(
                        combinedText.includes('BaseProcessor'),
                        'TC body must be preserved',
                    );
                }
            }
        });
    });

    // ------------------------------------------------------------------
    // Misplaced import relocation
    // ------------------------------------------------------------------
    describe('misplaced import relocation', () => {
        it('relocates misplaced imports to the top block', async () => {
            const content = [
                'import os',
                '',
                'x = 1',
                'y = 2',
                '',
                'import sys',
                '',
                'print(os.name, sys.version)',
            ].join('\n');

            const doc = createMockDocument(content);
            const result = validateImports(doc as any);

            assert.ok(result.issues.some(i => i.code === 'misplaced-import'));

            clearLastAppliedEdit();
            const changed = await sortImportsInDocument(doc as any, result, 0);
            assert.ok(changed);

            const edit = getLastAppliedEdit()!;
            const allEdits = edit.allEdits();

            // Should have a delete (for the misplaced import) and a replace (for the top block)
            const deletes = allEdits.filter(e => e.edit.newText === '');
            const replaces = allEdits.filter(e => e.edit.newText.length > 0);

            assert.ok(deletes.length >= 1, 'Should delete misplaced import');
            assert.ok(replaces.length >= 1, 'Should replace top block');

            // The replacement text should contain both os and sys
            const replaceText = replaces[0].edit.newText;
            assert.ok(replaceText.includes('import os'));
            assert.ok(replaceText.includes('import sys'));
        });
    });

    // ------------------------------------------------------------------
    // Line-length wrapping
    // ------------------------------------------------------------------
    describe('line-length wrapping', () => {
        it('wraps long from-import lines to multiline format', async () => {
            const sorted = await sortAndGetText([
                'from os.path import join, exists, abspath, dirname, basename, normpath, realpath',
                '',
                'print(join("a"), exists("b"), abspath("c"), dirname("d"), basename("e"), normpath("f"), realpath("g"))',
            ].join('\n'), 40);

            assert.ok(sorted);
            // Should be wrapped with parentheses
            assert.ok(sorted!.includes('('));
            assert.ok(sorted!.includes(')'));
        });

        it('does not wrap short lines', async () => {
            const sorted = await sortAndGetText([
                'from os.path import join',
                '',
                'print(join("a"))',
            ].join('\n'), 88);

            // Either no change or single-line output
            if (sorted) {
                assert.ok(!sorted.includes('('));
            }
        });
    });

    // ------------------------------------------------------------------
    // Alias preservation
    // ------------------------------------------------------------------
    describe('alias preservation', () => {
        it('preserves standard aliases through sorting', async () => {
            const sorted = await sortAndGetText([
                'import pandas as pd',
                'import numpy as np',
                '',
                'print(np.array([1]), pd.DataFrame())',
            ].join('\n'));

            assert.ok(sorted);
            assert.ok(sorted!.includes('import numpy as np'));
            assert.ok(sorted!.includes('import pandas as pd'));
        });
    });
});
