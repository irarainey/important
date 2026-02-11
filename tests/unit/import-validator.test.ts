import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { createMockDocument, DiagnosticSeverity } from './mocks/vscode';
import { validateImports } from '../../src/validation/import-validator';
import type { ImportIssueCode } from '../../src/types';

/** Helper: collect issue codes from a validation result. */
function issueCodes(doc: any): ImportIssueCode[] {
    return validateImports(doc).issues.map(i => i.code);
}

/** Helper: check that a specific issue code is present. */
function hasIssue(doc: any, code: ImportIssueCode): boolean {
    return issueCodes(doc).includes(code);
}

/** Helper: get issues with a specific code. */
function issuesWithCode(doc: any, code: ImportIssueCode) {
    return validateImports(doc).issues.filter(i => i.code === code);
}

describe('import-validator', () => {
    // ------------------------------------------------------------------
    // Rule 1: No relative imports
    // ------------------------------------------------------------------
    describe('Rule 1 — no-relative-imports', () => {
        it('flags a relative import', () => {
            const doc = createMockDocument('from . import utils\n\nprint(utils)');
            assert.ok(hasIssue(doc as any, 'no-relative-imports'));
        });

        it('flags a deep relative import', () => {
            const doc = createMockDocument('from ..models import User\n\nprint(User)');
            assert.ok(hasIssue(doc as any, 'no-relative-imports'));
        });

        it('does not flag an absolute import', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            assert.ok(!hasIssue(doc as any, 'no-relative-imports'));
        });

        it('suggests an absolute import fix', () => {
            const doc = createMockDocument('from .utils import helper\n\nprint(helper)');
            const issues = issuesWithCode(doc as any, 'no-relative-imports');
            assert.equal(issues.length, 1);
            assert.ok(issues[0].suggestedFix);
            assert.ok(!issues[0].suggestedFix!.includes('.'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 2: No wildcard imports
    // ------------------------------------------------------------------
    describe('Rule 2 — no-wildcard-imports', () => {
        it('flags a wildcard import', () => {
            const doc = createMockDocument('from os.path import *\n\nprint(join("a", "b"))');
            assert.ok(hasIssue(doc as any, 'no-wildcard-imports'));
        });

        it('does not flag a named import', () => {
            const doc = createMockDocument('from os.path import join\n\nprint(join("a", "b"))');
            assert.ok(!hasIssue(doc as any, 'no-wildcard-imports'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 3: No multiple imports on one line
    // ------------------------------------------------------------------
    describe('Rule 3 — no-multiple-imports', () => {
        it('flags import os, sys, json', () => {
            const doc = createMockDocument('import os, sys, json\n\nprint(os.name, sys.version, json.dumps({}))');
            assert.ok(hasIssue(doc as any, 'no-multiple-imports'));
        });

        it('suggests separate import statements', () => {
            const doc = createMockDocument('import os, sys\n\nprint(os.name, sys.version)');
            const issues = issuesWithCode(doc as any, 'no-multiple-imports');
            assert.equal(issues.length, 1);
            assert.ok(issues[0].suggestedFix!.includes('import os'));
            assert.ok(issues[0].suggestedFix!.includes('import sys'));
        });

        it('does not flag a single import', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            assert.ok(!hasIssue(doc as any, 'no-multiple-imports'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 4: Import modules, not symbols
    // ------------------------------------------------------------------
    describe('Rule 4 — import-modules-not-symbols', () => {
        it('flags from X import Symbol when X is not in exemption list', () => {
            const doc = createMockDocument('from fastmcp import FastMCP\n\nprint(FastMCP)');
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues.length, 1);
        });

        it('suggests import X for top-level module', () => {
            const doc = createMockDocument('from fastmcp import FastMCP\n\nprint(FastMCP)');
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues[0].suggestedFix, 'import fastmcp');
        });

        it('suggests from X import Y for deep module', () => {
            const doc = createMockDocument('from models.sample_models import User\n\nprint(User)');
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues.length, 1);
            assert.equal(issues[0].suggestedFix, 'from models import sample_models');
        });

        it('exempts typing module from rule 4', () => {
            const doc = createMockDocument('from typing import Optional\n\nx: Optional[int] = None');
            assert.ok(!hasIssue(doc as any, 'import-modules-not-symbols'));
        });

        it('exempts collections.abc from rule 4', () => {
            const doc = createMockDocument('from collections.abc import Mapping\n\nprint(Mapping)');
            assert.ok(!hasIssue(doc as any, 'import-modules-not-symbols'));
        });

        it('exempts typing_extensions from rule 4', () => {
            const doc = createMockDocument('from typing_extensions import Protocol\n\nclass P(Protocol): pass');
            assert.ok(!hasIssue(doc as any, 'import-modules-not-symbols'));
        });

        it('exempts __future__ imports from rule 4', () => {
            const doc = createMockDocument('from __future__ import annotations');
            assert.ok(!hasIssue(doc as any, 'import-modules-not-symbols'));
        });

        it('exempts TYPE_CHECKING block imports from rule 4', () => {
            const doc = createMockDocument([
                'from typing import TYPE_CHECKING',
                '',
                'if TYPE_CHECKING:',
                '    from models.sample_models import User',
                '',
                'x = 1',
                'y = 2',
                '',
                'def f(u: User): pass',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            // The TYPE_CHECKING import should be exempt
            const tcIssues = issues.filter(i => i.import.typeCheckingOnly);
            assert.equal(tcIssues.length, 0);
        });

        it('checks alias for dot-access when name is aliased', () => {
            // `from X import progress_reporter as progress_reporter_module`
            // Code uses `progress_reporter_module.start()` — the alias has
            // dot-access, so this is a module import and should NOT be flagged.
            const doc = createMockDocument([
                'from mypackage.orchestration import progress_reporter as progress_reporter_module',
                '',
                'progress_reporter_module.start()',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues.length, 0, 'aliased module with dot-access via alias should not be flagged');
        });

        it('flags PascalCase symbols even with dot-access (enums, classes)', () => {
            // PascalCase names like enums and classes are almost always symbols,
            // not modules. Dot-access (e.g. `StatusEnum.SUCCESS`) should NOT
            // suppress the violation — this is attribute access, not module access.
            const doc = createMockDocument([
                'from utils import StatusEnum, get_status',
                '',
                'status = StatusEnum.SUCCESS',
                'result = get_status()',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues.length, 1, 'PascalCase with dot-access should still be flagged');
        });

        it('detects dot-access on multi-line string closing line', () => {
            // When code follows a closing """ on the same line, dot-access
            // should still be detected as module usage.
            const doc = createMockDocument([
                'from aiinsights.shared_message_lib import microservice_requests',
                '',
                'TOOL_OVERVIEW = textwrap.dedent("""',
                'text in here',
                '""") + str(microservice_requests.WebSearchRequest.model_json_schema())',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'import-modules-not-symbols');
            assert.equal(issues.length, 0, 'dot-access after closing """ should suppress violation');
        });
    });

    // ------------------------------------------------------------------
    // Rule 5: Non-standard import alias
    // ------------------------------------------------------------------
    describe('Rule 5 — non-standard-import-alias', () => {
        it('flags a non-standard alias', () => {
            const doc = createMockDocument('import numpy as npy\n\nprint(npy.array([1]))');
            assert.ok(hasIssue(doc as any, 'non-standard-import-alias'));
        });

        it('does not flag the standard alias np', () => {
            const doc = createMockDocument('import numpy as np\n\nprint(np.array([1]))');
            assert.ok(!hasIssue(doc as any, 'non-standard-import-alias'));
        });

        it('does not flag standard alias pd for pandas', () => {
            const doc = createMockDocument('import pandas as pd\n\nprint(pd.DataFrame())');
            assert.ok(!hasIssue(doc as any, 'non-standard-import-alias'));
        });

        it('flags alias on a module with no known alias', () => {
            const doc = createMockDocument('import requests as req\n\nprint(req.get("url"))');
            assert.ok(hasIssue(doc as any, 'non-standard-import-alias'));
        });

        it('allows alias when the original name conflicts with a local variable', () => {
            const doc = createMockDocument([
                'import consent_detection as consent_detection_mod',
                '',
                'consent_detection = consent_detection_mod.detect()',
            ].join('\n'));
            assert.ok(!hasIssue(doc as any, 'non-standard-import-alias'));
            assert.ok(hasIssue(doc as any, 'local-name-conflict-alias'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 6: Unnecessary from-import alias
    // ------------------------------------------------------------------
    describe('Rule 6 — unnecessary-from-alias', () => {
        it('flags an unnecessary alias with no conflict', () => {
            const doc = createMockDocument('from json import loads as json_loads\n\nprint(json_loads("{}"))');
            assert.ok(hasIssue(doc as any, 'unnecessary-from-alias'));
        });

        it('allows alias when the name conflicts with another import', () => {
            const doc = createMockDocument([
                'from json import loads',
                'from pickle import loads as pickle_loads',
                '',
                'print(loads("{}"), pickle_loads(b"test"))',
            ].join('\n'));
            // "loads" appears in two imports → count >= 2 → alias is justified
            assert.ok(!hasIssue(doc as any, 'unnecessary-from-alias'));
        });

        it('flags multiline import with unnecessary alias', () => {
            const doc = createMockDocument([
                'from access_control_checker import (',
                '    datamodels as access_control_datamodels,',
                ')',
                '',
                'print(access_control_datamodels.field)',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'unnecessary-from-alias');
            assert.equal(issues.length, 1);
            // Verify the message contains the pattern used by fix-imports to identify the alias
            assert.ok(issues[0].message.includes('datamodels as access_control_datamodels'),
                `Expected message to contain 'datamodels as access_control_datamodels', got: ${issues[0].message}`);
            // Verify the import.aliases map is correctly populated
            assert.equal(issues[0].import.aliases.size, 1);
            assert.equal(issues[0].import.aliases.get('datamodels'), 'access_control_datamodels');
        });

        it('flags single-line import with unnecessary alias', () => {
            const doc = createMockDocument([
                'from access_control_checker import datamodels as access_control_datamodels',
                '',
                'print(access_control_datamodels.field)',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'unnecessary-from-alias');
            assert.equal(issues.length, 1);
            // Verify the message contains the pattern
            assert.ok(issues[0].message.includes('datamodels as access_control_datamodels'));
            // Verify the import.aliases map
            assert.equal(issues[0].import.aliases.get('datamodels'), 'access_control_datamodels');
        });

        it('message pattern matches for fix logic', () => {
            // This test simulates what the fix logic does to find the alias
            const doc = createMockDocument([
                'from access_control_checker import datamodels as access_control_datamodels',
                '',
                'print(access_control_datamodels.field)',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'unnecessary-from-alias');
            assert.equal(issues.length, 1);

            const issue = issues[0];
            let matchFound = false;

            // Simulate the fix logic's pattern matching
            for (const [original, alias] of issue.import.aliases) {
                const pattern = `${original} as ${alias}`;
                if (issue.message.includes(pattern)) {
                    matchFound = true;
                    assert.equal(original, 'datamodels');
                    assert.equal(alias, 'access_control_datamodels');
                }
            }

            assert.ok(matchFound, `Fix logic pattern match failed. Message: ${issue.message}, Aliases: ${Array.from(issue.import.aliases.entries())}`);
        });

        it('allows alias when the original name conflicts with a local variable', () => {
            const doc = createMockDocument([
                'from src.services import consent_detection as consent_detection_mod',
                '',
                'consent_detection = consent_detection_mod.detect()',
            ].join('\n'));
            assert.ok(!hasIssue(doc as any, 'unnecessary-from-alias'));
            assert.ok(hasIssue(doc as any, 'local-name-conflict-alias'));
        });

        it('allows alias when original is a for-loop variable', () => {
            const doc = createMockDocument([
                'from src.services import item as item_mod',
                '',
                'for item in item_mod.get_items():',
                '    print(item)',
            ].join('\n'));
            assert.ok(!hasIssue(doc as any, 'unnecessary-from-alias'));
            assert.ok(hasIssue(doc as any, 'local-name-conflict-alias'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 7: Unused imports
    // ------------------------------------------------------------------
    describe('Rule 7 — unused-import', () => {
        it('flags an import that is not used', () => {
            const doc = createMockDocument('import os\nimport sys\n\nprint(os.name)');
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues.length, 1);
            assert.ok(issues[0].message.includes('sys'));
        });

        it('flags partially unused from-import names', () => {
            const doc = createMockDocument(
                'from os.path import join, exists\n\nprint(join("a", "b"))',
            );
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues.length, 1);
            assert.ok(issues[0].message.includes('exists'));
            // Suggested fix keeps only the used name
            assert.ok(issues[0].suggestedFix!.includes('join'));
            assert.ok(!issues[0].suggestedFix!.includes('exists'));
        });

        it('flags entirely unused from-import', () => {
            const doc = createMockDocument('from os.path import join\n\nx = 1');
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues.length, 1);
            assert.equal(issues[0].suggestedFix, ''); // Empty = delete
        });

        it('does not flag used imports', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            assert.ok(!hasIssue(doc as any, 'unused-import'));
        });

        it('does not flag __future__ imports as unused', () => {
            const doc = createMockDocument('from __future__ import annotations');
            assert.ok(!hasIssue(doc as any, 'unused-import'));
        });

        it('does not flag wildcard imports as unused', () => {
            const doc = createMockDocument('from os.path import *\n\nprint(join("a"))');
            assert.ok(!hasIssue(doc as any, 'unused-import'));
        });

        it('checks alias name for usage instead of original name', () => {
            const doc = createMockDocument('import numpy as np\n\nprint(np.array([1]))');
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues.length, 0);
        });

        it('flags unused import when alias is defined but alias is not used', () => {
            const doc = createMockDocument('import numpy as np\n\nx = 1');
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues.length, 1);
        });
    });

    // ------------------------------------------------------------------
    // Rule 8: Wrong import order (category ordering)
    // ------------------------------------------------------------------
    describe('Rule 8 — wrong-import-order', () => {
        it('flags third-party before stdlib', () => {
            const doc = createMockDocument([
                'import requests',
                'import os',
                '',
                'print(requests.__version__, os.name)',
            ].join('\n'));
            assert.ok(hasIssue(doc as any, 'wrong-import-order'));
        });

        it('does not flag correct order: stdlib then third-party', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'import requests',
                '',
                'print(os.name, requests.__version__)',
            ].join('\n'));
            assert.ok(!hasIssue(doc as any, 'wrong-import-order'));
        });

        it('flags local before stdlib', () => {
            const doc = createMockDocument([
                'from . import utils',
                'import os',
                '',
                'print(utils, os.name)',
            ].join('\n'));
            assert.ok(hasIssue(doc as any, 'wrong-import-order'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 9: Wrong alphabetical order
    // ------------------------------------------------------------------
    describe('Rule 9 — wrong-alphabetical-order', () => {
        it('flags stdlib imports not in alphabetical order', () => {
            const doc = createMockDocument([
                'import sys',
                'import os',
                '',
                'print(sys.version, os.name)',
            ].join('\n'));
            assert.ok(hasIssue(doc as any, 'wrong-alphabetical-order'));
        });

        it('does not flag alphabetically ordered imports', () => {
            const doc = createMockDocument([
                'import json',
                'import os',
                'import sys',
                '',
                'print(json.dumps({}), os.name, sys.version)',
            ].join('\n'));
            assert.ok(!hasIssue(doc as any, 'wrong-alphabetical-order'));
        });

        it('flags import statements after from statements in same group', () => {
            const doc = createMockDocument([
                'from os.path import join',
                'import os',
                '',
                'print(join("a"), os.name)',
            ].join('\n'));
            assert.ok(hasIssue(doc as any, 'wrong-alphabetical-order'));
        });
    });

    // ------------------------------------------------------------------
    // Rule 10: Misplaced import
    // ------------------------------------------------------------------
    describe('Rule 10 — misplaced-import', () => {
        it('flags imports not at the top of the file', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'x = 1',
                'y = 2',
                '',
                'import sys',
                '',
                'print(os.name, sys.version)',
            ].join('\n'));
            assert.ok(hasIssue(doc as any, 'misplaced-import'));
        });

        it('does not flag TYPE_CHECKING imports as misplaced', () => {
            // TYPE_CHECKING imports are exempt from misplaced detection
            const doc = createMockDocument([
                'import os',
                'from typing import TYPE_CHECKING',
                '',
                'if TYPE_CHECKING:',
                '    from typing import Protocol',
                '',
                'print(os.name)',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'misplaced-import');
            assert.equal(issues.length, 0);
        });
    });

    // ------------------------------------------------------------------
    // Categories
    // ------------------------------------------------------------------
    describe('category assignment', () => {
        it('assigns future category to __future__', () => {
            const doc = createMockDocument('from __future__ import annotations');
            const result = validateImports(doc as any);
            const cat = result.categories.get(result.imports[0]);
            assert.equal(cat, 'future');
        });

        it('assigns stdlib category to os', () => {
            const doc = createMockDocument('import os\n\nprint(os.name)');
            const result = validateImports(doc as any);
            const cat = result.categories.get(result.imports[0]);
            assert.equal(cat, 'stdlib');
        });

        it('assigns third-party category to unknown modules', () => {
            const doc = createMockDocument('import requests\n\nprint(requests.__version__)');
            const result = validateImports(doc as any);
            const cat = result.categories.get(result.imports[0]);
            assert.equal(cat, 'third-party');
        });

        it('assigns local category to relative imports', () => {
            const doc = createMockDocument('from . import utils\n\nprint(utils)');
            const result = validateImports(doc as any);
            const cat = result.categories.get(result.imports[0]);
            assert.equal(cat, 'local');
        });
    });

    // ------------------------------------------------------------------
    // Severity levels
    // ------------------------------------------------------------------
    describe('severity levels', () => {
        it('reports relative imports as Warning', () => {
            const doc = createMockDocument('from . import utils\n\nprint(utils)');
            const issues = issuesWithCode(doc as any, 'no-relative-imports');
            assert.equal(issues[0].severity, DiagnosticSeverity.Warning);
        });

        it('reports wildcard imports as Warning', () => {
            const doc = createMockDocument('from os.path import *\n\nprint(join(""))');
            const issues = issuesWithCode(doc as any, 'no-wildcard-imports');
            assert.equal(issues[0].severity, DiagnosticSeverity.Warning);
        });

        it('reports unused imports as Hint', () => {
            const doc = createMockDocument('import os\n\nx = 1');
            const issues = issuesWithCode(doc as any, 'unused-import');
            assert.equal(issues[0].severity, DiagnosticSeverity.Hint);
        });

        it('reports ordering issues as Information', () => {
            const doc = createMockDocument('import sys\nimport os\n\nprint(sys.version, os.name)');
            const issues = issuesWithCode(doc as any, 'wrong-alphabetical-order');
            assert.equal(issues[0].severity, DiagnosticSeverity.Information);
        });

        it('reports misplaced imports as Warning', () => {
            const doc = createMockDocument([
                'import os',
                '',
                'x = 1',
                'y = 2',
                '',
                'import sys',
                '',
                'print(os.name, sys.version)',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'misplaced-import');
            assert.equal(issues[0].severity, DiagnosticSeverity.Warning);
        });

        it('reports local-name-conflict aliases as Hint', () => {
            const doc = createMockDocument([
                'from src.services import consent_detection as consent_detection_mod',
                '',
                'consent_detection = consent_detection_mod.detect()',
            ].join('\n'));
            const issues = issuesWithCode(doc as any, 'local-name-conflict-alias');
            assert.equal(issues.length, 1);
            assert.equal(issues[0].severity, DiagnosticSeverity.Hint);
        });
    });

    // ------------------------------------------------------------------
    // Unused names map
    // ------------------------------------------------------------------
    describe('unusedNames map', () => {
        it('populates unused names correctly', () => {
            const doc = createMockDocument(
                'from os.path import join, exists, abspath\n\nprint(join("a"))',
            );
            const result = validateImports(doc as any);
            const unused = result.unusedNames.get(result.imports[0])!;
            assert.ok(unused.includes('exists'));
            assert.ok(unused.includes('abspath'));
            assert.ok(!unused.includes('join'));
        });

        it('returns empty array for __future__ imports', () => {
            const doc = createMockDocument('from __future__ import annotations');
            const result = validateImports(doc as any);
            const unused = result.unusedNames.get(result.imports[0])!;
            assert.deepEqual([...unused], []);
        });
    });

    // ------------------------------------------------------------------
    // Clean file (no issues)
    // ------------------------------------------------------------------
    describe('clean files', () => {
        it('reports no issues for a correctly structured file', () => {
            const doc = createMockDocument([
                'import dataclasses',
                'import datetime',
                'import typing',
                '',
                '',
                '@dataclasses.dataclass',
                'class User:',
                '    id: int',
                '    name: str',
                '    created_at: datetime.datetime = dataclasses.field(',
                '        default_factory=datetime.datetime.now',
                '    )',
                '    tags: typing.List[str] = dataclasses.field(default_factory=list)',
            ].join('\n'));
            const result = validateImports(doc as any);
            assert.equal(result.issues.length, 0);
        });
    });
});
