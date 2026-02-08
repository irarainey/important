import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { createMockDocument } from './mocks/vscode';
import { issuesToDiagnostics } from '../../src/validation/diagnostics';
import { validateImports } from '../../src/validation/import-validator';
import { getValidation, invalidateValidation, disposeValidationCache } from '../../src/validation/validation-cache';

describe('diagnostics', () => {
    describe('issuesToDiagnostics', () => {
        it('converts import issues to VS Code Diagnostic objects', () => {
            const doc = createMockDocument('from . import utils\n\nprint(utils)');
            const result = validateImports(doc as any);

            const diagnostics = issuesToDiagnostics(result.issues);

            assert.ok(diagnostics.length > 0);
            for (const diag of diagnostics) {
                assert.ok(diag.range);
                assert.ok(diag.message);
                assert.ok(typeof diag.severity === 'number');
                assert.equal(diag.source, 'Important');
            }
        });

        it('preserves issue codes on diagnostics', () => {
            const doc = createMockDocument('from . import utils\n\nprint(utils)');
            const result = validateImports(doc as any);
            const diagnostics = issuesToDiagnostics(result.issues);

            assert.ok(diagnostics.some(d => d.code === 'no-relative-imports'));
        });

        it('returns an empty array for a clean file', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const result = validateImports(doc as any);
            const diagnostics = issuesToDiagnostics(result.issues);
            assert.equal(diagnostics.length, 0);
        });
    });
});

describe('validation-cache', () => {
    afterEach(() => {
        disposeValidationCache();
    });

    describe('getValidation', () => {
        it('returns a ValidationResult for a document', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const result = getValidation(doc as any);

            assert.ok(result.imports);
            assert.ok(result.categories);
            assert.ok(result.issues);
            assert.ok(result.unusedNames);
            assert.ok(result.importLines);
        });

        it('returns cached result for same document version', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const result1 = getValidation(doc as any);
            const result2 = getValidation(doc as any);

            // Same object (cached)
            assert.strictEqual(result1, result2);
        });
    });

    describe('invalidateValidation', () => {
        it('removes a document from the cache', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const result1 = getValidation(doc as any);

            invalidateValidation(doc.uri as any);

            const result2 = getValidation(doc as any);
            // After invalidation, a new result is created
            assert.notStrictEqual(result1, result2);
        });
    });

    describe('disposeValidationCache', () => {
        it('clears all cached results', () => {
            const doc1 = createMockDocument('import os\n\nprint(os.name)', 'file1.py');
            const doc2 = createMockDocument('import sys\n\nprint(sys.version)', 'file2.py');

            const r1 = getValidation(doc1 as any);
            const r2 = getValidation(doc2 as any);

            disposeValidationCache();

            const r1b = getValidation(doc1 as any);
            const r2b = getValidation(doc2 as any);

            assert.notStrictEqual(r1, r1b);
            assert.notStrictEqual(r2, r2b);
        });
    });
});
