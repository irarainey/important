import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { createMockDocument } from './mocks/vscode';
import { parseImports } from '../../src/validation/import-parser';

describe('import-parser', () => {
    // ------------------------------------------------------------------
    // Basic single-line imports
    // ------------------------------------------------------------------
    describe('single-line imports', () => {
        it('parses a plain `import` statement', () => {
            const doc = createMockDocument('import os');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].type, 'import');
            assert.equal(imports[0].module, 'os');
            assert.deepEqual(imports[0].names, ['os']);
            assert.equal(imports[0].level, 0);
            assert.equal(imports[0].line, 0);
            assert.equal(imports[0].endLine, 0);
        });

        it('parses a `from X import Y` statement', () => {
            const doc = createMockDocument('from os.path import join');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].type, 'from');
            assert.equal(imports[0].module, 'os.path');
            assert.deepEqual(imports[0].names, ['join']);
            assert.equal(imports[0].level, 0);
        });

        it('parses multiple names in a from-import', () => {
            const doc = createMockDocument('from os.path import join, exists, abspath');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.deepEqual(imports[0].names, ['join', 'exists', 'abspath']);
        });

        it('parses import with alias', () => {
            const doc = createMockDocument('import numpy as np');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'numpy');
            assert.equal(imports[0].aliases.get('numpy'), 'np');
        });

        it('parses from-import with alias', () => {
            const doc = createMockDocument('from datetime import datetime as dt');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'datetime');
            assert.deepEqual(imports[0].names, ['datetime']);
            assert.equal(imports[0].aliases.get('datetime'), 'dt');
        });

        it('parses multiple imports on separate lines', () => {
            const doc = createMockDocument('import os\nimport sys\nimport json');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 3);
            assert.equal(imports[0].module, 'os');
            assert.equal(imports[1].module, 'sys');
            assert.equal(imports[2].module, 'json');
        });

        it('parses multiple module imports on one line (import os, sys)', () => {
            const doc = createMockDocument('import os, sys, json');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].type, 'import');
            assert.deepEqual(imports[0].names, ['os', 'sys', 'json']);
        });

        it('parses wildcard import', () => {
            const doc = createMockDocument('from os.path import *');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.deepEqual(imports[0].names, ['*']);
        });

        it('parses relative import', () => {
            const doc = createMockDocument('from . import utils');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].level, 1);
            assert.equal(imports[0].module, '.');
        });

        it('parses deep relative import', () => {
            const doc = createMockDocument('from ..models import User');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].level, 2);
            assert.equal(imports[0].module, '..models');
            assert.deepEqual(imports[0].names, ['User']);
        });

        it('strips inline comments from imports', () => {
            const doc = createMockDocument('import os  # operating system');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'os');
            // Ensure comment is not part of module name
            assert.ok(!imports[0].module.includes('#'));
        });
    });

    // ------------------------------------------------------------------
    // Multiline imports (parenthesised)
    // ------------------------------------------------------------------
    describe('multiline imports', () => {
        it('parses a parenthesised multiline import', () => {
            const doc = createMockDocument(
                'from models.sample_models import (\n    Project,\n    Task,\n)',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'models.sample_models');
            assert.deepEqual(imports[0].names, ['Project', 'Task']);
            assert.equal(imports[0].line, 0);
            assert.equal(imports[0].endLine, 3);
        });

        it('parses multiline import with aliases', () => {
            const doc = createMockDocument(
                'from typing import (\n    List as L,\n    Dict as D,\n)',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.deepEqual(imports[0].names, ['List', 'Dict']);
            assert.equal(imports[0].aliases.get('List'), 'L');
            assert.equal(imports[0].aliases.get('Dict'), 'D');
        });

        it('handles multiline with trailing comma', () => {
            const doc = createMockDocument(
                'from os import (\n    getcwd,\n    listdir,\n)',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.deepEqual(imports[0].names, ['getcwd', 'listdir']);
        });
    });

    // ------------------------------------------------------------------
    // TYPE_CHECKING block detection
    // ------------------------------------------------------------------
    describe('TYPE_CHECKING blocks', () => {
        it('marks imports inside if TYPE_CHECKING: as typeCheckingOnly', () => {
            const doc = createMockDocument(
                'import os\n\nif TYPE_CHECKING:\n    from typing import Protocol\n\nimport sys',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 3);
            assert.equal(imports[0].typeCheckingOnly, false); // import os
            assert.equal(imports[1].typeCheckingOnly, true);  // from typing import Protocol
            assert.equal(imports[2].typeCheckingOnly, false); // import sys
        });

        it('detects exit from TYPE_CHECKING block by indentation', () => {
            const doc = createMockDocument([
                'from typing import TYPE_CHECKING',
                '',
                'if TYPE_CHECKING:',
                '    from typing import Protocol',
                '    from typing import Any',
                '',
                'import os',
            ].join('\n'));
            const imports = parseImports(doc as any);

            const tcImports = imports.filter((i: any) => i.typeCheckingOnly);
            const regularImports = imports.filter((i: any) => !i.typeCheckingOnly);

            assert.equal(tcImports.length, 2);
            assert.equal(regularImports.length, 2); // TYPE_CHECKING + os
        });

        it('handles embedded TYPE_CHECKING block between regular imports', () => {
            const doc = createMockDocument([
                'from __future__ import annotations',
                'from typing import TYPE_CHECKING',
                'from other_library.core import base',
                'if TYPE_CHECKING:',
                '    from other_library.core.base import BaseProcessor',
                '    from other_library.core.exceptions import ProcessingError',
                'from models import sample_models',
            ].join('\n'));
            const imports = parseImports(doc as any);

            const tcImports = imports.filter((i: any) => i.typeCheckingOnly);
            const regularImports = imports.filter((i: any) => !i.typeCheckingOnly);

            assert.equal(tcImports.length, 2);
            assert.equal(regularImports.length, 4);
            // All regular imports should be !misplaced (part of top block)
            for (const imp of regularImports) {
                assert.equal(imp.misplaced, false, `${imp.module} should not be misplaced`);
            }
        });
    });

    // ------------------------------------------------------------------
    // Misplaced import detection
    // ------------------------------------------------------------------
    describe('misplaced imports', () => {
        it('marks imports after the top-level block as misplaced', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'def main():',
                '    pass',
                '',
                'import sys',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 2);
            assert.equal(imports[0].misplaced, false);
            assert.equal(imports[1].misplaced, true);
        });

        it('does not flag imports in the top block separated by blank lines', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'import sys',
                '',
                'import json',
            ].join('\n'));
            const imports = parseImports(doc as any);

            for (const imp of imports) {
                assert.equal(imp.misplaced, false, `${imp.module} should not be misplaced`);
            }
        });

        it('allows comments between top-block imports', () => {
            const doc = createMockDocument([
                'import os',
                '# stdlib',
                'import sys',
                '',
                '# third-party',
                'import requests',
            ].join('\n'));
            const imports = parseImports(doc as any);

            for (const imp of imports) {
                assert.equal(imp.misplaced, false, `${imp.module} should not be misplaced`);
            }
        });

        it('detects misplaced import inside a function', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'x = 1',
                'y = 2',
                '',
                'def task():',
                '    import hashlib',
                '    return hashlib.md5(b"test")',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 2);
            assert.equal(imports[0].misplaced, false);
            assert.equal(imports[1].misplaced, true);
        });
    });

    // ------------------------------------------------------------------
    // Edge cases
    // ------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles an empty document', () => {
            const doc = createMockDocument('');
            const imports = parseImports(doc as any);
            assert.equal(imports.length, 0);
        });

        it('handles a document with no imports', () => {
            const doc = createMockDocument('x = 1\nprint(x)');
            const imports = parseImports(doc as any);
            assert.equal(imports.length, 0);
        });

        it('ignores non-import lines that look similar', () => {
            const doc = createMockDocument([
                'import os',
                'x = "import sys"',  // string that looks like import
                '# import json',     // comment
            ].join('\n'));
            const imports = parseImports(doc as any);
            assert.equal(imports.length, 1);
        });

        it('handles __future__ import', () => {
            const doc = createMockDocument('from __future__ import annotations');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, '__future__');
            assert.deepEqual(imports[0].names, ['annotations']);
        });
    });
});
