## 0.3.3

- **Fix: Imports inside docstrings no longer parsed**: The import parser now pre-computes which lines fall inside multi-line strings (triple-quoted `"""` or `'''`) and skips them entirely. Previously, import-like text inside module docstrings (e.g. example code blocks) was parsed as real imports, causing phantom imports to appear in the sorted output and the docstring content to be destroyed.
- **Fix: Symbol replacement skips docstrings**: The `replaceSymbolUsagesOutsideImports()` function and `isNameUsedOutsideLines()` now skip lines inside multi-line strings. Previously, `isInStringOrComment()` only examined text before the match on the same line, so it could not detect that a match was inside a multi-line docstring whose opening `"""` was on a prior line. This caused symbol rewrites (e.g. `BaseProcessor` → `base.BaseProcessor`) to occur inside docstrings, and on subsequent fix passes produced double-qualified names like `base.base.BaseProcessor`.
- **Fix: Dot-qualified references no longer count as bare usage**: `isNameUsedOutsideLines()` now skips matches preceded by a `.` character. After the `import-modules-not-symbols` fixer rewrites `Symbol` → `module.Symbol`, the regex `\bSymbol\b` previously still matched inside `module.Symbol` (since `.` is a word boundary), incorrectly treating the original `from X import Symbol` line as still used. The import was then preserved instead of being removed, and Ruff would flag it.
- **Fix: Names within `from` imports sorted alphabetically**: The import sorter now sorts names within each `from X import (a, b, c)` statement alphabetically before emitting them. Previously names were emitted in encounter/merge order, producing output like `shared_enums, agent_chat, conversation` instead of Ruff's expected `agent_chat, conversation, shared_enums`. This applies to both the main import sorter and the `TYPE_CHECKING` block sorter.
- **Fix: Ruff/isort `order-by-type` name sorting**: Names within `from` imports are now sorted using Ruff/isort's `order-by-type` convention (enabled by default in Ruff): `CONSTANT_CASE` names first, then `CamelCase`, then `snake_case`, with alphabetical sorting within each tier. Previously, simple case-insensitive alphabetical sorting produced `from typing import Annotated, TYPE_CHECKING` which Ruff corrected to `from typing import TYPE_CHECKING, Annotated`.
- **Fix: `if typing.TYPE_CHECKING:` block recognition**: The parser, validator, and sorter now recognise `if typing.TYPE_CHECKING:` (dot-qualified form) in addition to `if TYPE_CHECKING:`. Previously, using `import typing` followed by `if typing.TYPE_CHECKING:` caused the block to be treated as regular code, and imports inside it were not marked as type-checking-only.
- **Fix: Aliased from-imports kept separate (Ruff compatibility)**: `from X import a` and `from X import b as c` are no longer merged into a single `from X import (a, b as c)` statement. Ruff/isort keeps aliased imports as separate statements, so merging them created a fix→Ruff→fix cycle. The deduplicator now uses separate keys for aliased and non-aliased from-imports, and within each group non-aliased imports sort before aliased ones.
- **Fix: Aliased module dot-access detection**: The `import-modules-not-symbols` dot-access heuristic now checks the alias name in addition to the original imported name. Previously, `from X import progress_reporter as progress_reporter_module` was flagged as a symbol import even though code used `progress_reporter_module.start()` — the regex only searched for `progress_reporter.\w` (the original name), missing the alias-based dot-access. The import was flagged but could not be fixed, creating a persistent unfixable violation.

## 0.3.2

- **Fix: Embedded `if TYPE_CHECKING` block preservation**: The import sorter now correctly handles `if TYPE_CHECKING:` blocks that are sandwiched between regular (runtime) imports. Previously, when regular imports existed both above and below the TC block, the sorter's replacement range spanned the entire region and destroyed the TC block and its header. The sorter now detects this embedded layout, locates the `if TYPE_CHECKING:` header line, and builds a single combined replacement that includes both the sorted regular imports and the preserved (or re-sorted) TC block — eliminating overlapping edits.
- **Fix: `isModuleFile` false positives for same-name packages**: The `moduleFileSuffixes` index no longer generates single-segment suffixes. Previously, a file like `helpers/helpers.py` produced the bare suffix `helpers`, causing `isModuleFile('helpers')` to incorrectly return `true` for the `helpers` package. Single-segment suffixes are inherently ambiguous — they cannot distinguish a package directory from a same-named file within it. Only multi-segment suffixes (containing `/`) are now indexed, resolving the entire class of same-name package/module collisions (e.g. `helpers/helpers.py`, `utils/utils.py`). Both the full `rebuildIndices()` and incremental `addToCache()` paths are fixed.
- **Fix: `isWorkspaceModule` check for top-level modules**: The filesystem check `isWorkspaceModule(imp.module, name)` in Rule 4 (`import-modules-not-symbols`) was previously gated behind `moduleParts.length >= 2`, meaning it was never called for single-segment module names like `from helpers import helpers`. This caused the import to be incorrectly flagged as a symbol import after an initial fix, leading to a double-fix loop that progressively degraded the code (`from helpers import helpers` → `import helpers` → `helpers.helpers.format_output`). The guard has been removed so the filesystem check runs for all module depths.
- **Unit test suite**: Added comprehensive unit tests (142 tests, 7 test files) covering import parsing, validation, module resolution, import sorting, diagnostics, types, and text utilities. The suite runs via `npm run test` using Mocha with a custom `vscode` module mock, compiled through a separate `tsconfig.test.json` (CommonJS output). Tests are located in `tests/unit/`.
- **ESLint test configuration**: Added a test-file override in `eslint.config.mjs` that disables `@typescript-eslint/no-explicit-any` (mock objects require `as any` casts for `vscode` types) and allows underscore-prefixed unused parameters in mock stubs.

## 0.3.1

- Added `__future__` to `SYMBOL_IMPORT_EXEMPTIONS` — `from __future__ import annotations` is now exempt from the `import-modules-not-symbols` rule. These are compiler directives, not regular imports, and linters like Ruff explicitly exempt them from unused-import checks (F401) and unnecessary-future-import checks (UP010).
- **Fix command skips when no issues**: The "Fix Imports in This File" command now returns immediately when validation reports zero issues, preventing the sort step from reformatting already-valid imports.
- **Multi-line import formatting**: When the sort/fix step rebuilds import lines it now respects a configurable line length. Single-line `from` imports that exceed the limit are wrapped into Ruff-style parenthesised multi-line imports with trailing commas and 4-space indentation. This prevents Ruff from flagging reformatted imports as too long (E501).
- **`important.lineLength` setting**: New integer setting (default `0`). When `0`, the extension auto-detects `line-length` from the `[tool.ruff]` section in `pyproject.toml`, falling back to Ruff's default of 88. Any positive value overrides auto-detection.
- **`line-length` auto-detection from `pyproject.toml`**: The extension reads `line-length` from `[tool.ruff]` during initialisation and whenever `pyproject.toml` changes, using the same file-watcher already in place for first-party modules.
- **`if TYPE_CHECKING` block support**: Imports inside `if TYPE_CHECKING:` blocks are detected by indentation and marked `typeCheckingOnly`. Google style guide rules still apply within the block — ordering, alphabetical sorting, no relative imports, no wildcards, alias validation, and unused-import detection all run normally. The only exemption is Rule 4 (`import-modules-not-symbols`): symbol imports are allowed inside TYPE_CHECKING because they exist purely for type annotations. The sorter sorts TYPE_CHECKING imports in-place (grouped by category, alphabetised, with correct indentation) without moving them out of the block. Multi-line formatting respects the configured line length inside the block. The `from typing import TYPE_CHECKING` import itself is treated as a regular import with normal usage detection (the `if TYPE_CHECKING:` guard counts as a reference).

## 0.3.0

- **Unified validation architecture**: A single scan now produces a `ValidationResult` (parsed imports, categories, issues, unused-name mappings) cached by document URI and version. Diagnostics, the fix command, and the import sorter all consume the same cached result — eliminating duplicate scans and ensuring consistency between what is reported and what is fixed.
- **Full-file import scanning**: The parser scans the entire file instead of stopping after the top-level import block. Imports found later are marked `misplaced: true`, flagged with a `misplaced-import` diagnostic (Warning), and automatically relocated to the top block on fix. Ordering rules only evaluate top-block imports to avoid misleading diagnostics for imports that will be relocated.
- **Inline comment stripping**: The parser now strips `# ...` comments from import lines before parsing names — preventing inline comments containing commas from corrupting the parsed name list and silently dropping aliases.
- **Alias validation rules**: Added `non-standard-import-alias` (flags `import y as z` when `z` is not a recognised standard abbreviation) and `unnecessary-from-alias` (flags `from x import y as z` when no naming conflict is detected).
- **Alias-aware fixes**: The import parser preserves `as` aliases throughout the pipeline. Non-standard aliases are auto-fixed with full reference updates (e.g. `import os as operating_system` → `import os`, all `operating_system.xxx` → `os.xxx`). Symbol-import fixes (`import-modules-not-symbols`) correctly search for the alias in code rather than the original name, and reuse an existing `import X [as Y]` instead of creating duplicates. Unused-import detection checks alias usage, and sorting preserves `as` clauses.
- **Multi-import alias fix correctness**: Non-standard alias fixing now groups issues by import line, so `import datetime as dt, collections as col` correctly fixes only the flagged module (`col` → `collections`) while preserving unflagged modules (`datetime as dt`) unchanged. Previously the entire line was replaced with only the first module's fix, dropping other imports and corrupting code references.
- **Alias-preserving multi-import split**: The `no-multiple-imports` rule now preserves `as` aliases in its suggested fix (`import datetime as dt, collections as col` → `import datetime as dt\nimport collections as col` instead of dropping aliases).
- **Consolidated symbol replacement**: The `replaceSymbolUsagesOutsideImports()` function is now shared across wildcard, alias, and symbol-import fix steps — eliminating duplicated inline logic and the dead `usedSymbols` tracking array from the wildcard step.
- **Removed setTimeout delays**: All artificial delays (100ms between fix steps, 50ms in the command handler) have been removed — edits are applied sequentially without unnecessary pauses.
- **Pre-computed Rule 6 conflict maps**: `originalNameCounts` and `allEffectiveNames` are built once before the validation loop for O(1) conflict detection in the `unnecessary-from-alias` rule, including alias values for namespace conflict checks.
- **Shared workspace exclude pattern**: `WORKSPACE_EXCLUDE_PATTERN` is now exported from `module-resolver.ts` and reused by `pyproject-reader.ts`, replacing a narrower duplicate pattern.
- **Robust multiline import detection**: The parser now uses `^\s*from\s+\S+\s+import\s+\(` regex instead of the fragile `line.includes('import (')` check for detecting multi-line parenthesized imports.
- **Improved Rule 4 dot-access detection**: The dot-access heuristic in `import-modules-not-symbols` now uses `isInStringOrComment()` instead of a simple `beforeText.includes('#')` check, correctly handling `#` inside string literals.
- **Consistent unused-import detection**: Unused-name detection now excludes **all** import lines (not just the current import's own lines), preventing a name appearing inside another import statement from suppressing diagnostics.
- **Stdlib Rule 4 enforcement**: `import-modules-not-symbols` now applies to stdlib modules (e.g. `from os.path import join` is flagged). Only the four modules listed in Google style 2.2.4.1 (`typing`, `collections.abc`, `typing_extensions`, `six.moves`) are exempt.
- **Dead code removal**: Removed unused `replaceSymbolUsages()` function, removed unnecessary exports (`validateDocument`, `getImportCategory`, `MODULE_SYMBOLS`), consolidated duplicate logger imports.

## 0.2.1

- **Performance**: Index-based module lookups — `isLocalModule()` and `isModuleFile()` now use pre-built indices for O(1) lookups instead of iterating all module paths.
- **Performance**: Incremental module cache updates — file creation/deletion no longer triggers a full workspace scan.
- **Performance**: Import category caching — `getImportCategory()` results are computed once per validation run and reused across ordering rules.
- **Performance**: `CodeActionProvider` now reads from the existing `DiagnosticCollection` instead of re-running validation on every code-action request.
- **Performance**: Import parser stops scanning after the import block ends, avoiding full-document traversal for large files.
- Hoisted `SYMBOL_IMPORT_EXEMPTIONS` to module scope — no longer re-allocated on every loop iteration.
- Hoisted `document.getText()` call before the validation loop — no longer called per qualifying import.
- Added `.catch()` error handling to all fire-and-forget async calls, logging failures via `logError()`.
- Extracted shared `isNameUsedOutsideLines()` into `text-utils.ts`, replacing duplicate implementations in `import-validator.ts` and `sort-imports.ts`.
- Extracted shared `CATEGORY_ORDER` constant into `types.ts`, replacing duplicate arrays in `import-validator.ts` and `sort-imports.ts`.
- Standardised comment/string detection to use `isInStringOrComment()` everywhere — the previous simple `#` check could miss `#` inside strings.
- Removed dead exports: `parseImportLine` (internal to `import-parser.ts`) and `STDLIB_MODULES` (internal to `stdlib-modules.ts`).
- Fixed comment numbering in `fix-imports.ts` (was "Second:", "Second:" → now "Second:", "Third:").
- Used `endLine` directly instead of `text.split('\n')` for multi-line import line counting in `sort-imports.ts`.
- Replaced `.forEach()` with `for...of` loops for side-effect iteration.
- Removed non-null assertion in `sort-imports.ts` deduplication logic.
- Renamed test project directory from `tests/sample_project` to `tests/application`.
- Renamed test first-party package from `sample_project` to `other_library`.
- Fixed import sorting to place `import` statements before `from` statements within each group, matching Ruff/isort default behaviour (`force_sort_within_sections = false`) and resolving I001 violations.
- Updated alphabetical order validation to account for `import`-before-`from` ordering.
- **Monorepo-aware first-party modules**: `pyproject.toml` scanning is no longer limited to 5 files. Modules declared in a nested `pyproject.toml` are now **scoped** to that directory subtree, so each sub-project in a monorepo can have its own first-party list.
- First-party module settings (`important.knownFirstParty`) are treated as **global** and apply to all documents.
- `getImportCategory()` and `isFirstPartyModule()` now accept an optional document URI for path-scoped resolution.
- Added `ScopedFirstParty` type to represent directory-scoped first-party module entries.
- **Show First-Party Modules** command now displays scoped entries with their directory paths.
- Fixed multi-line import handling: added `endLine` to `ImportStatement` so diagnostic ranges, unused-name detection, and symbol replacement correctly span all lines of parenthesized imports.
- Fixed PascalCase names (e.g. `Config`, `User`) with dot access being incorrectly treated as modules by the dot-access heuristic, suppressing `import-modules-not-symbols` violations.
- Added `isModuleFile()` to definitively detect when a module path resolves to a `.py` file, guaranteeing that anything imported from it is a symbol.
- Three-tier symbol detection for `import-modules-not-symbols`: definitive filesystem check → sub-module filesystem check → snake_case dot-access heuristic.
- Moved sample project from `examples/` to `tests/application`.

## 0.2.0

- Added **first-party** import category matching Ruff's isort behaviour. Import ordering is now 5 groups: `__future__` → stdlib → third-party → first-party → local.
- Added `important.knownFirstParty` setting to explicitly configure first-party module names.
- Added `important.readFromPyprojectToml` setting (default `true`) to auto-read `known-first-party` from `[tool.ruff.lint.isort]` in `pyproject.toml`.
- Extension watches `pyproject.toml` for changes and automatically reloads first-party configuration.
- Fixed `typing_extensions` incorrectly classified as stdlib — it is now correctly treated as third-party (still exempt from Rule 4 per Google 2.2.4.1).
- Added `__future__` to the stdlib module list to prevent false Rule 4 violations on `from __future__ import annotations`.
- Fixed `__future__` imports being flagged as unused and silently removed by sort-imports.
- Updated module resolver to exclude more common virtual environment directories and `site-packages` from being treated as local modules.
- Added a promise to ensure the module resolver is fully initialized before validating already-open documents, preventing potential false positives on startup.
- Added **Output channel logging** — extension activity is now visible in the "Important" Output panel (`View → Output → Important`).
- Added **Important: Show First-Party Modules** command to display the resolved first-party module list.
- Added keyboard shortcut `Ctrl+K, Ctrl+Shift+F` (`Cmd+K, Cmd+Shift+F` on macOS) for Fix Imports command.
- Full Google Python Style Guide compliance audit.
- Full PEP 8 import standards compliance audit.

## 0.1.4

- Fixed sorting of local imports to be after third-party imports.

## 0.1.3

- Initial release.
