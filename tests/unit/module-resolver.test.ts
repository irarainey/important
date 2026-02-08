import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'mocha';
import { setWorkspaceFiles, Uri } from './mocks/vscode';
import {
    isWorkspaceModule,
    isModuleFile,
    isLocalModule,
    isFirstPartyModule,
    setGlobalFirstPartyModules,
    setScopedFirstPartyModules,
    disposeModuleResolver,
    initModuleResolver,
    getFirstPartyModulesSummary,
} from '../../src/utils/module-resolver';

/** Minimal mock of ExtensionContext for initModuleResolver. */
function mockContext(): any {
    return {
        subscriptions: [],
    };
}

describe('module-resolver', () => {
    afterEach(() => {
        disposeModuleResolver();
        setWorkspaceFiles([]);
        setGlobalFirstPartyModules([]);
        setScopedFirstPartyModules([]);
    });

    // ------------------------------------------------------------------
    // isWorkspaceModule
    // ------------------------------------------------------------------
    describe('isWorkspaceModule', () => {
        it('returns true when a .py file exists for the name', async () => {
            setWorkspaceFiles([
                'models/sample_models.py',
                'models/__init__.py',
            ]);
            await initModuleResolver(mockContext());

            assert.ok(isWorkspaceModule('models', 'sample_models'));
        });

        it('returns true when a package directory exists', async () => {
            setWorkspaceFiles([
                'models/__init__.py',
                'models/user/__init__.py',
            ]);
            await initModuleResolver(mockContext());

            // models/user/__init__.py means "user" is a package inside "models"
            assert.ok(isWorkspaceModule('models', 'user'));
        });

        it('returns false when no matching module exists', async () => {
            setWorkspaceFiles(['main.py']);
            await initModuleResolver(mockContext());

            assert.ok(!isWorkspaceModule('models', 'sample_models'));
        });

        it('returns false when not initialized', () => {
            // Not calling initModuleResolver
            assert.ok(!isWorkspaceModule('models', 'sample_models'));
        });
    });

    // ------------------------------------------------------------------
    // isModuleFile
    // ------------------------------------------------------------------
    describe('isModuleFile', () => {
        it('returns true for a dotted module path matching a .py file', async () => {
            setWorkspaceFiles([
                'models/sample_models.py',
                'models/__init__.py',
            ]);
            await initModuleResolver(mockContext());

            assert.ok(isModuleFile('models/sample_models'));
        });

        it('returns false for a package directory (has __init__.py)', async () => {
            setWorkspaceFiles([
                'models/__init__.py',
            ]);
            await initModuleResolver(mockContext());

            assert.ok(!isModuleFile('models'));
        });

        it('does not match single-segment suffixes (helpers/helpers.py bug fix)', async () => {
            setWorkspaceFiles([
                'helpers/__init__.py',
                'helpers/helpers.py',
            ]);
            await initModuleResolver(mockContext());

            // The bare suffix "helpers" should NOT match — it's ambiguous
            // between the package and the file inside it
            assert.ok(!isModuleFile('helpers'));
        });

        it('matches multi-segment suffixes correctly', async () => {
            setWorkspaceFiles([
                'helpers/__init__.py',
                'helpers/helpers.py',
            ]);
            await initModuleResolver(mockContext());

            // The full path suffix "helpers/helpers" should match
            assert.ok(isModuleFile('helpers/helpers'));
        });
    });

    // ------------------------------------------------------------------
    // isLocalModule
    // ------------------------------------------------------------------
    describe('isLocalModule', () => {
        it('returns true when the root package exists in the workspace', async () => {
            setWorkspaceFiles([
                'models/__init__.py',
                'models/sample_models.py',
            ]);
            await initModuleResolver(mockContext());

            assert.ok(isLocalModule('models.sample_models'));
        });

        it('returns false for a module not in the workspace', async () => {
            setWorkspaceFiles(['main.py']);
            await initModuleResolver(mockContext());

            assert.ok(!isLocalModule('requests'));
        });

        it('uses the root segment for lookup', async () => {
            setWorkspaceFiles([
                'mypackage/submodule/core.py',
            ]);
            await initModuleResolver(mockContext());

            // "mypackage" is a root segment
            assert.ok(isLocalModule('mypackage.submodule.core'));
        });
    });

    // ------------------------------------------------------------------
    // First-party modules
    // ------------------------------------------------------------------
    describe('first-party modules', () => {
        it('recognizes global first-party modules', () => {
            setGlobalFirstPartyModules(['myproject', 'mylib']);

            assert.ok(isFirstPartyModule('myproject'));
            assert.ok(isFirstPartyModule('myproject.submodule'));
            assert.ok(isFirstPartyModule('mylib.core'));
            assert.ok(!isFirstPartyModule('requests'));
        });

        it('recognizes scoped first-party modules for matching paths', () => {
            setScopedFirstPartyModules([
                { dirPath: 'packages/api', modules: ['api_core'] },
            ]);

            const apiUri = Uri.file('/workspace/packages/api/main.py');
            assert.ok(isFirstPartyModule('api_core', apiUri as any));

            // A file outside the scope should not match
            const otherUri = Uri.file('/workspace/packages/web/main.py');
            assert.ok(!isFirstPartyModule('api_core', otherUri as any));
        });

        it('root-level scope (.) matches every document', () => {
            setScopedFirstPartyModules([
                { dirPath: '.', modules: ['shared'] },
            ]);

            const uri = Uri.file('/workspace/any/path/file.py');
            assert.ok(isFirstPartyModule('shared', uri as any));
        });

        it('provides a summary of first-party modules', () => {
            setGlobalFirstPartyModules(['myproject']);
            setScopedFirstPartyModules([
                { dirPath: '.', modules: ['shared'] },
            ]);

            const summary = getFirstPartyModulesSummary();
            assert.ok(summary.includes('myproject'));
            assert.ok(summary.includes('shared'));
        });

        it('returns "No first-party modules" when none configured', () => {
            const summary = getFirstPartyModulesSummary();
            assert.ok(summary.includes('No first-party modules'));
        });
    });
});
