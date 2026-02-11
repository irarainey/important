import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { createMockDocument } from './mocks/vscode';
import { escapeRegex, isInStringOrComment, isNameUsedOutsideLines, isNameAssignedInDocument } from '../../src/utils/text-utils';
import { isStdlibModule } from '../../src/utils/stdlib-modules';
import { STANDARD_IMPORT_ALIASES } from '../../src/utils/standard-aliases';

describe('text-utils', () => {
    // ------------------------------------------------------------------
    // escapeRegex
    // ------------------------------------------------------------------
    describe('escapeRegex', () => {
        it('escapes special regex characters', () => {
            assert.equal(escapeRegex('os.path'), 'os\\.path');
            assert.equal(escapeRegex('a+b'), 'a\\+b');
            assert.equal(escapeRegex('foo[bar]'), 'foo\\[bar\\]');
            assert.equal(escapeRegex('a*b'), 'a\\*b');
        });

        it('returns plain strings unchanged', () => {
            assert.equal(escapeRegex('hello'), 'hello');
            assert.equal(escapeRegex('my_module'), 'my_module');
        });
    });

    // ------------------------------------------------------------------
    // isInStringOrComment
    // ------------------------------------------------------------------
    describe('isInStringOrComment', () => {
        it('returns true when position is after a #', () => {
            assert.ok(isInStringOrComment('x = 1  # '));
        });

        it('returns false for code before a comment', () => {
            assert.ok(!isInStringOrComment('x = 1'));
        });

        it('returns true inside a double-quoted string', () => {
            assert.ok(isInStringOrComment('x = "hello '));
        });

        it('returns true inside a single-quoted string', () => {
            assert.ok(isInStringOrComment("x = 'hello "));
        });

        it('returns false outside strings', () => {
            assert.ok(!isInStringOrComment('x = "done" + '));
        });

        it('returns false inside f-string expression {}', () => {
            // Inside an f-string's {} is code, not string
            assert.ok(!isInStringOrComment('x = f"value={'));
        });

        it('returns false inside f-string expression with nested quotes', () => {
            // f"Valid types: {', '.join(" — the ', ' is inside {}, so we're in code
            assert.ok(!isInStringOrComment(`f"Valid types: {', '.join(`));
        });

        it('returns true inside f-string text portion', () => {
            // After closing } we're back in string text
            assert.ok(isInStringOrComment('f"hello {x} world '));
        });

        it('returns true inside regular string with braces', () => {
            // Not an f-string, braces don't create code context
            assert.ok(isInStringOrComment('"value={'));
        });

        it('returns false for # inside a string', () => {
            assert.ok(!isInStringOrComment('x = "abc#def" + '));
        });

        it('returns true for # after a closed string', () => {
            assert.ok(isInStringOrComment('x = "done"  # '));
        });
    });

    // ------------------------------------------------------------------
    // isNameUsedOutsideLines
    // ------------------------------------------------------------------
    describe('isNameUsedOutsideLines', () => {
        it('returns true when the name is used outside excluded lines', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            assert.ok(isNameUsedOutsideLines(doc as any, text, 'os', excludeLines));
        });

        it('returns false when the name only appears on excluded lines', () => {
            const doc = createMockDocument('import os\n\nx = 1');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            assert.ok(!isNameUsedOutsideLines(doc as any, text, 'os', excludeLines));
        });

        it('does not match name inside a comment', () => {
            const doc = createMockDocument('import os\n\n# os is great\nx = 1');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            assert.ok(!isNameUsedOutsideLines(doc as any, text, 'os', excludeLines));
        });

        it('does not match partial word boundaries', () => {
            const doc = createMockDocument('import os\n\nosx = "mac"');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // "osx" should not match "os" with word boundaries
            assert.ok(!isNameUsedOutsideLines(doc as any, text, 'os', excludeLines));
        });

        it('does not match dot-qualified references (module.Symbol)', () => {
            const doc = createMockDocument('from pydantic import BaseModel\n\nprint(pydantic.BaseModel)');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // "BaseModel" in "pydantic.BaseModel" is a qualified access,
            // not a bare usage of the imported name.
            assert.ok(!isNameUsedOutsideLines(doc as any, text, 'BaseModel', excludeLines));
        });

        it('matches bare usage even when qualified usage also exists', () => {
            const doc = createMockDocument('from pydantic import BaseModel\n\nx = BaseModel()\ny = pydantic.BaseModel()');
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // Bare "BaseModel()" IS a real usage
            assert.ok(isNameUsedOutsideLines(doc as any, text, 'BaseModel', excludeLines));
        });

        it('does not match names inside a multi-line docstring', () => {
            const doc = createMockDocument([
                'import os',
                '"""',
                'os is used here in the docstring',
                '"""',
                'x = 1',
            ].join('\n'));
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // "os" in the docstring should not count as usage
            assert.ok(!isNameUsedOutsideLines(doc as any, text, 'os', excludeLines));
        });

        it('matches names on the closing line of a multi-line string when code follows', () => {
            const doc = createMockDocument([
                'from mypackage import service_requests',
                '',
                'TOOL_OVERVIEW = textwrap.dedent("""',
                'text in here',
                '""") + str(service_requests.WebSearchRequest.model_json_schema())',
            ].join('\n'));
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // service_requests on the closing """ line should be detected
            assert.ok(isNameUsedOutsideLines(doc as any, text, 'service_requests', excludeLines));
        });

        it('ignores triple-quotes inside comments when tracking multi-line strings', () => {
            // Comments containing """ must not confuse the multi-line
            // string tracker — the closing-line code should still be
            // recognised as code, not string content.
            const doc = createMockDocument([
                'from other_library.helpers import greet, add',
                '',
                '# --- Case 1: after closing """ ---',
                '# The closing """ and module usage are on the same line.',
                'TOOL = textwrap.dedent("""',
                '    some text',
                '""") + str(greet("schema"))',
                '',
                '# --- Case 2: concatenation after """ ---',
                'INFO = textwrap.dedent("""',
                '    info text',
                '""") + str(add(1, 2))',
            ].join('\n'));
            const text = doc.getText();
            const excludeLines = new Set([0]);

            // Both names on closing """ lines must be detected as used
            assert.ok(isNameUsedOutsideLines(doc as any, text, 'greet', excludeLines));
            assert.ok(isNameUsedOutsideLines(doc as any, text, 'add', excludeLines));
        });
    });

    // ------------------------------------------------------------------
    // isNameAssignedInDocument
    // ------------------------------------------------------------------
    describe('isNameAssignedInDocument', () => {
        it('detects simple assignment', () => {
            const doc = createMockDocument('import foo\n\nfoo = bar()');
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('detects type-annotated assignment', () => {
            const doc = createMockDocument('import foo\n\nfoo: int = 42');
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('detects augmented assignment', () => {
            const doc = createMockDocument('import foo\n\nfoo += 1');
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('detects for-loop variable', () => {
            const doc = createMockDocument('import item\n\nfor item in items:\n    pass');
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'item', new Set([0]), new Map()));
        });

        it('detects as-target in with statement', () => {
            const doc = createMockDocument('import ctx\n\nwith open("f") as ctx:\n    pass');
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'ctx', new Set([0]), new Map()));
        });

        it('does not match comparison (==)', () => {
            const doc = createMockDocument('import foo\n\nif foo == 1:\n    pass');
            const text = doc.getText();
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('does not match attribute assignment (obj.name = ...)', () => {
            const doc = createMockDocument('import foo\n\nself.foo = 1');
            const text = doc.getText();
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('does not match names on import lines', () => {
            const doc = createMockDocument('import foo\n\nx = 1');
            const text = doc.getText();
            // 'foo' only appears on the import line (line 0)
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('does not match names inside strings', () => {
            const doc = createMockDocument('import foo\n\nx = "foo = 1"');
            const text = doc.getText();
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('does not match names inside comments', () => {
            const doc = createMockDocument('import foo\n\n# foo = 1\nx = 1');
            const text = doc.getText();
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map()));
        });

        it('does not match names inside multi-line strings', () => {
            const doc = createMockDocument([
                'import foo',
                '"""',
                'foo = something',
                '"""',
                'x = 1',
            ].join('\n'));
            const text = doc.getText();
            assert.ok(!isNameAssignedInDocument(doc as any, text, 'foo', new Set([0]), new Map([[2, Infinity]])));
        });

        it('detects real-world consent_detection conflict', () => {
            const doc = createMockDocument([
                'from src.services.consent_detection import detect_cookie_consent',
                '',
                'consent_detection = await detect_cookie_consent(screenshot, html)',
            ].join('\n'));
            const text = doc.getText();
            assert.ok(isNameAssignedInDocument(doc as any, text, 'consent_detection', new Set([0]), new Map()));
        });
    });
});

describe('stdlib-modules', () => {
    describe('isStdlibModule', () => {
        it('recognizes common stdlib modules', () => {
            assert.ok(isStdlibModule('os'));
            assert.ok(isStdlibModule('sys'));
            assert.ok(isStdlibModule('json'));
            assert.ok(isStdlibModule('collections'));
            assert.ok(isStdlibModule('typing'));
            assert.ok(isStdlibModule('pathlib'));
            assert.ok(isStdlibModule('datetime'));
            assert.ok(isStdlibModule('hashlib'));
            assert.ok(isStdlibModule('textwrap'));
            assert.ok(isStdlibModule('io'));
        });

        it('recognizes stdlib submodules via top-level lookup', () => {
            assert.ok(isStdlibModule('os.path'));
            assert.ok(isStdlibModule('collections.abc'));
        });

        it('recognizes __future__ as stdlib', () => {
            assert.ok(isStdlibModule('__future__'));
        });

        it('does not flag third-party modules', () => {
            assert.ok(!isStdlibModule('requests'));
            assert.ok(!isStdlibModule('numpy'));
            assert.ok(!isStdlibModule('pandas'));
            assert.ok(!isStdlibModule('fastmcp'));
        });

        it('does not flag typing_extensions as stdlib', () => {
            // typing_extensions is a third-party package
            assert.ok(!isStdlibModule('typing_extensions'));
        });

        it('recognizes nested stdlib paths via top-level', () => {
            assert.ok(isStdlibModule('email.mime.text'));
            assert.ok(isStdlibModule('http.server'));
            assert.ok(isStdlibModule('urllib.parse'));
        });
    });
});

describe('standard-aliases', () => {
    describe('STANDARD_IMPORT_ALIASES', () => {
        it('includes numpy → np', () => {
            assert.equal(STANDARD_IMPORT_ALIASES.get('numpy'), 'np');
        });

        it('includes pandas → pd', () => {
            assert.equal(STANDARD_IMPORT_ALIASES.get('pandas'), 'pd');
        });

        it('includes matplotlib.pyplot → plt', () => {
            assert.equal(STANDARD_IMPORT_ALIASES.get('matplotlib.pyplot'), 'plt');
        });

        it('includes datetime → dt', () => {
            assert.equal(STANDARD_IMPORT_ALIASES.get('datetime'), 'dt');
        });

        it('does not include unknown modules', () => {
            assert.equal(STANDARD_IMPORT_ALIASES.get('requests'), undefined);
        });

        it('has all expected entries', () => {
            const expectedModules = [
                'numpy', 'pandas', 'matplotlib', 'matplotlib.pyplot',
                'seaborn', 'tensorflow', 'scipy', 'polars',
                'networkx', 'sqlalchemy', 'datetime',
            ];
            for (const mod of expectedModules) {
                assert.ok(
                    STANDARD_IMPORT_ALIASES.has(mod),
                    `Expected STANDARD_IMPORT_ALIASES to contain '${mod}'`,
                );
            }
        });
    });
});
