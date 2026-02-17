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

        it('recognises if typing.TYPE_CHECKING: as a type checking block', () => {
            const doc = createMockDocument([
                'import typing',
                '',
                'if typing.TYPE_CHECKING:',
                '    from collections import abc',
                '',
                'import os',
            ].join('\n'));
            const imports = parseImports(doc as any);

            const tcImports = imports.filter((i: any) => i.typeCheckingOnly);
            const regularImports = imports.filter((i: any) => !i.typeCheckingOnly);

            assert.equal(tcImports.length, 1);
            assert.equal(tcImports[0].module, 'collections');
            assert.equal(regularImports.length, 2); // typing + os
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

        it('parses indented import inside a function and marks it indented', () => {
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

            // The indented import is parsed and marked as indented
            // and misplaced — it will be relocated to the top block.
            assert.equal(imports.length, 2);
            assert.equal(imports[0].module, 'os');
            assert.equal(imports[0].misplaced, false);
            assert.equal(imports[0].indented, false);
            assert.equal(imports[1].module, 'hashlib');
            assert.equal(imports[1].misplaced, true);
            assert.equal(imports[1].indented, true);
        });

        it('parses lazy from-import inside a function with docstring and marks it indented', () => {
            const doc = createMockDocument([
                'import json',
                'from typing import Any',
                '',
                'import pydantic',
                '',
                '',
                'def to_camel_case_dict(obj: pydantic.BaseModel) -> dict[str, Any]:',
                '    """Convert a Pydantic model instance to a dict with camelCase keys."""',
                '    from src.utils.serialization import snake_to_camel',
                '',
                '    return {snake_to_camel(k): v for k, v in obj.model_dump().items()}',
            ].join('\n'));
            const imports = parseImports(doc as any);

            // The indented from-import inside the function body is
            // parsed and marked as indented and misplaced.
            assert.equal(imports.length, 4);
            assert.deepEqual(
                imports.map((i: any) => i.module),
                ['json', 'typing', 'pydantic', 'src.utils.serialization'],
            );
            for (const imp of imports.slice(0, 3)) {
                assert.equal(imp.misplaced, false, `${imp.module} should not be misplaced`);
                assert.equal(imp.indented, false, `${imp.module} should not be indented`);
            }
            assert.equal(imports[3].misplaced, true, 'lazy import should be misplaced');
            assert.equal(imports[3].indented, true, 'lazy import should be indented');
        });

        it('parses indented multiline lazy import and marks it indented', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'def helper():',
                '    from some.module import (',
                '        alpha,',
                '        beta,',
                '    )',
                '    return alpha(beta())',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 2);
            assert.equal(imports[0].module, 'os');
            assert.equal(imports[0].indented, false);
            assert.equal(imports[1].module, 'some.module');
            assert.equal(imports[1].indented, true);
            assert.equal(imports[1].misplaced, true);
            assert.deepEqual([...imports[1].names], ['alpha', 'beta']);
        });

        it('indented docstring does not prevent top block from ending', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'def foo():',
                '    """docstring"""',
                '    x = 1',
                '',
                'import sys',
            ].join('\n'));
            const imports = parseImports(doc as any);

            // `def foo():` and `    """docstring"""` (indented) should both
            // count as non-permitted, ending the top block.  `import sys`
            // at column 0 is then parsed as misplaced.
            assert.equal(imports.length, 2);
            assert.equal(imports[0].module, 'os');
            assert.equal(imports[0].misplaced, false);
            assert.equal(imports[1].module, 'sys');
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

        it('ignores import-like text inside a multi-line docstring', () => {
            const doc = createMockDocument([
                '"""',
                'from other_library.core.base import BaseProcessor, ProcessorConfig',
                'from other_library.core.exceptions import ProcessingError',
                '"""',
                '',
                'import os',
                '',
                'print(os.name)',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'os');
        });

        it('ignores imports inside a module-level docstring with content', () => {
            const doc = createMockDocument([
                '"""Module docstring.',
                '',
                'Example:',
                '    from os.path import join',
                '    import sys',
                '"""',
                '',
                'import logging',
                '',
                'print(logging.getLogger())',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'logging');
        });

        it('handles single-line triple-quoted strings (not multi-line)', () => {
            const doc = createMockDocument([
                'x = """import os"""',
                'import sys',
                '',
                'print(sys.version)',
            ].join('\n'));
            const imports = parseImports(doc as any);

            // The import-like text in the single-line triple-quoted string
            // is not on a line the parser would match (it has x = prefix),
            // so only `import sys` is parsed.
            assert.equal(imports.length, 1);
            assert.equal(imports[0].module, 'sys');
        });
    });

    // ------------------------------------------------------------------
    // noqa comment parsing
    // ------------------------------------------------------------------
    describe('noqa comment parsing', () => {
        it('parses blanket noqa comment on import', () => {
            const doc = createMockDocument('import os  # noqa: important');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined, 'noqaRules should be set');
            assert.equal(imports[0].noqaRules!.size, 0, 'blanket noqa has empty set');
        });

        it('parses per-rule noqa comment', () => {
            const doc = createMockDocument('import os  # noqa: important[unused-import]');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined);
            assert.ok(imports[0].noqaRules!.has('unused-import'));
            assert.equal(imports[0].noqaRules!.size, 1);
        });

        it('parses multiple per-rule noqa codes', () => {
            const doc = createMockDocument(
                'from os import *  # noqa: important[no-wildcard-imports, unused-import]',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined);
            assert.ok(imports[0].noqaRules!.has('no-wildcard-imports'));
            assert.ok(imports[0].noqaRules!.has('unused-import'));
            assert.equal(imports[0].noqaRules!.size, 2);
        });

        it('is case-insensitive', () => {
            const doc = createMockDocument('import os  # NOQA: Important');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined);
        });

        it('does not parse unrelated comments as noqa', () => {
            const doc = createMockDocument('import os  # this is fine');
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.equal(imports[0].noqaRules, undefined);
        });

        it('parses noqa on from-import', () => {
            const doc = createMockDocument(
                'from os.path import join  # noqa: important[import-modules-not-symbols]',
            );
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined);
            assert.ok(imports[0].noqaRules!.has('import-modules-not-symbols'));
        });

        it('parses noqa on multiline import (comment on last line)', () => {
            const doc = createMockDocument([
                'from os.path import (',
                '    join,',
                '    exists,',
                ')  # noqa: important',
            ].join('\n'));
            const imports = parseImports(doc as any);

            assert.equal(imports.length, 1);
            assert.ok(imports[0].noqaRules !== undefined);
            assert.equal(imports[0].noqaRules!.size, 0, 'blanket noqa');
        });
    });
});
