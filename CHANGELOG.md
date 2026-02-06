## 0.2.1

- Fixed import sorting to place `import` statements before `from` statements within each group, matching Ruff/isort default behaviour (`force_sort_within_sections = false`) and resolving I001 violations.
- Updated alphabetical order validation to account for `import`-before-`from` ordering.
- Added keyboard shortcut `Ctrl+K, Ctrl+Shift+F` (`Cmd+K, Cmd+Shift+F` on macOS) for Fix Imports command.
- **Monorepo-aware first-party modules**: `pyproject.toml` scanning is no longer limited to 5 files. Modules declared in a nested `pyproject.toml` are now **scoped** to that directory subtree, so each sub-project in a monorepo can have its own first-party list.
- First-party module settings (`important.knownFirstParty`) are treated as **global** and apply to all documents.
- `getImportCategory()` and `isFirstPartyModule()` now accept an optional document URI for path-scoped resolution.
- Added `ScopedFirstParty` type to represent directory-scoped first-party module entries.
- **Show First-Party Modules** command now displays scoped entries with their directory paths.
- Fixed multi-line import handling: added `endLine` to `ImportStatement` so diagnostic ranges, unused-name detection, and symbol replacement correctly span all lines of parenthesized imports.
- Fixed PascalCase names (e.g. `Config`, `User`) with dot access being incorrectly treated as modules by the dot-access heuristic, suppressing `import-modules-not-symbols` violations.
- Added `isModuleFile()` to definitively detect when a module path resolves to a `.py` file, guaranteeing that anything imported from it is a symbol.
- Three-tier symbol detection for `import-modules-not-symbols`: definitive filesystem check → sub-module filesystem check → snake_case dot-access heuristic.
- Moved sample project from `examples/` to `tests/`.

## 0.1.5

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
