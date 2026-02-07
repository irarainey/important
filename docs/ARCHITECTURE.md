# Important - Developer Documentation

This document explains the architecture, workflow, and implementation details of the Important VS Code extension for Python import validation.

## Overview

Important is a VS Code extension that validates Python import statements according to the Google Python Style Guide. It provides real-time diagnostics, quick fixes, and an auto-fix command that intelligently corrects import issues including symbol reference updates.

## Architecture

```
src/
├── extension.ts                    # Entry point, lifecycle, event handlers
├── types.ts                        # TypeScript interfaces and types
├── providers/
│   ├── code-action-provider.ts     # Quick fix suggestions
│   └── hover-provider.ts           # Hover information for diagnostics
├── validation/
│   ├── import-parser.ts            # Parse Python import statements
│   ├── import-validator.ts         # Single-scan validation producing ValidationResult
│   ├── validation-cache.ts         # Version-keyed cache for ValidationResult
│   └── diagnostics.ts              # Convert issues to VS Code diagnostics
├── fixes/
│   ├── fix-imports.ts              # Main fix orchestration (uses cache)
│   └── sort-imports.ts             # Sorting, deduplication, unused removal (consumes ValidationResult)
└── utils/
    ├── logger.ts                   # Output channel logging utilities
    ├── module-resolver.ts          # Workspace Python module detection
    ├── stdlib-modules.ts           # Python stdlib module list
    ├── module-symbols.ts           # Known symbols for wildcard fixing
    ├── pyproject-reader.ts         # Reads first-party config from pyproject.toml
    └── text-utils.ts               # Regex escaping, string/comment detection
```

## Data Flow

### Validation Flow

A **single scan** produces a `ValidationResult` that is cached by document
URI and version. Both diagnostics and fixes consume the same cached result,
ensuring they always agree on the set of issues.

```
Document Change
      │
      ▼
┌────────────────────────┐
│  scheduleValidation()  │  Debounced (50ms)
└────────────────────────┘
      │
      ▼
┌───────────────────────┐
│  getValidation()      │  Returns cached or fresh ValidationResult
│  (validation-cache)   │  (keyed by document URI + version)
└───────────────────────┘
      │  cache miss ──► validateImports()
      │                  ├── parseImports()      → ImportStatement[]
      │                  ├── getImportCategory()  → category map
      │                  ├── findUnusedNames()    → unused-names map
      │                  └── apply rules          → ImportIssue[]
      ▼
┌───────────────────────┐
│  issuesToDiagnostics()│  Convert issues to vscode.Diagnostic[]
└───────────────────────┘
      │
      ▼
┌───────────────────────┐
│  DiagnosticCollection │  Display in editor
└───────────────────────┘
```

### Fix Flow

The fix command also uses `getValidation()` so that the issues it acts on
are **identical** to the diagnostics the user sees. After each mutation
the document version changes, so the next `getValidation()` call
automatically re-scans.

```
"Fix Imports" Command
      │
      ▼
┌────────────────────────┐
│  fixAllImports()       │
└────────────────────────┘
      │
      ├──► getValidation(document)  ◄── same cached result as diagnostics
      │
      ├──► Step 1: Fix wildcard imports (if known symbols exist)
      │    - Scan for used symbols from MODULE_SYMBOLS
      │    - Replace symbol usages with qualified names
      │    - Convert to module import
      │    - Document version changes → cache invalidated
      │
      ├──► Step 2: Fix non-standard import aliases
      │    - Replace import with standard alias or plain import
      │      e.g. `import os as operating_system` → `import os`
      │      e.g. `import datetime as date` → `import datetime as dt`
      │    - Replace all references: old alias → new name
      │      e.g. `operating_system.name` → `os.name`
      │    - Document version changes → cache invalidated
      │
      ├──► getValidation(freshDoc)  ◄── re-scans after prior edits
      │
      ├──► Step 3: Fix import-modules-not-symbols
      │    - Detect symbol imports via three-tier approach:
      │      1. Definitive: module path is a .py file (isModuleFile)
      │      2. Sub-module: imported name is a .py file/package (isWorkspaceModule)
      │      3. Heuristic: snake_case name with dot-access usage
      │    - Top-level: from pkg import Cls → import pkg
      │    - Deep: from pkg.mod import Cls → from pkg import mod
      │    - Replace symbol usages with qualified names
      │      (alias-aware: searches for the alias, not the original name)
      │    - Reuses existing `import X [as Y]` when present to avoid
      │      duplicate imports that the deduplicator would incorrectly merge
      │    - Document version changes → cache invalidated
      │
      └──► Step 4: sortImportsInDocument(freshDoc, getValidation(freshDoc))
           - Receives pre-computed ValidationResult (no re-scan)
           - Expand multi-imports
           - Remove unused imports (from pre-computed unusedNames map)
           - Deduplicate imports (preserves aliases)
           - Group by category (from pre-computed categories map)
           - Sort: `import` before `from`, then alphabetically
           - Reconstruct with `as` clauses
           - Relocate misplaced imports to the top block
           - Apply edit if changed
           - Up to 5 iterations until stable
```

## Core Types

### ImportStatement

Represents a parsed Python import:

```typescript
interface ImportStatement {
	type: "import" | "from"; // import X vs from X import Y
	module: string; // The module name (e.g., 'os.path')
	names: readonly string[]; // Imported names (['join', 'exists'] or ['os'])
	aliases: ReadonlyMap<string, string>; // name → alias for `as` clauses
	level: number; // Relative import dots (0 = absolute)
	line: number; // Start line number (0-based)
	endLine: number; // End line number (same as line for single-line imports)
	text: string; // Original import text (may contain newlines for multi-line)
	misplaced: boolean; // true if found after the top-level import block
}
```

### ImportIssue

Represents a validation issue:

```typescript
interface ImportIssue {
	code: ImportIssueCode; // Rule identifier
	message: string; // Human-readable message
	severity: DiagnosticSeverity; // Warning, Information, Hint
	range: Range; // Location in document
	import: ImportStatement; // The problematic import
	suggestedFix?: string; // Replacement text (empty = delete)
}
```

### ValidationResult

Comprehensive result from a single scan — the **single source of truth**
consumed by diagnostics, fixes, and the import sorter:

```typescript
interface ValidationResult {
	imports: readonly ImportStatement[]; // Parsed imports in document order
	categories: ReadonlyMap<ImportStatement, ImportCategory>; // Category per import
	issues: readonly ImportIssue[]; // All detected issues
	unusedNames: ReadonlyMap<ImportStatement, readonly string[]>; // Unused names per import
	importLines: ReadonlySet<number>; // Line numbers occupied by imports
}
```

The result is cached by document URI and version in `validation-cache.ts`.
When the document changes (new version), the next `getValidation()` call
automatically recomputes.

### ImportCategory

Categorizes imports for grouping (matching Ruff / isort ordering):

```typescript
type ImportCategory = "future" | "stdlib" | "third-party" | "first-party" | "local";
```

The canonical ordering is exposed as:

```typescript
const CATEGORY_ORDER: readonly ImportCategory[] = ["future", "stdlib", "third-party", "first-party", "local"];
```

Category detection (`getImportCategory(importStmt, documentUri?)`):

1. **`__future__`** — `from __future__ import …` always comes first
2. **Relative imports** (leading dots) → always `local`
3. **stdlib** — matched against a built-in list of Python 3.11+ standard library module names
4. **first-party** — resolved via global settings **and** path-scoped `pyproject.toml` entries (see below)
5. **local** — the module's root package exists in the workspace filesystem (via `isLocalModule`)
6. **third-party** — everything else (installed packages)

### ScopedFirstParty

Associates first-party module names with the workspace-relative directory of the `pyproject.toml` they were read from:

```typescript
interface ScopedFirstParty {
	/** Workspace-relative directory, e.g. "packages/api". "." for workspace root. */
	readonly dirPath: string;
	/** Module root names declared as first-party in that scope. */
	readonly modules: readonly string[];
}
```

First-party resolution (`isFirstPartyModule(moduleName, documentUri?)`):

1. **Global** modules (from `important.knownFirstParty` setting) always apply.
2. **Scoped** entries from `pyproject.toml` only apply when the document's workspace-relative path starts with `entry.dirPath + '/'`, or when `dirPath` is `"."` (root scope matches every document).

## Validation Rules

| Code                         | Rule                                       | Severity | Auto-Fix                        |
| ---------------------------- | ------------------------------------------ | -------- | ------------------------------- |
| `no-relative-imports`        | No relative imports (`.module`)            | Warning  | Strip dots                      |
| `no-wildcard-imports`        | No `from X import *`                       | Warning  | Convert to module import        |
| `no-multiple-imports`        | No `import os, sys`                        | Warning  | Split to separate lines         |
| `import-modules-not-symbols` | Import modules, not symbols                | Info     | Refactor to module access       |
| `non-standard-import-alias`  | `import y as z` only for standard abbrevs  | Info     | Suggest standard alias or plain |
| `unnecessary-from-alias`     | `from x import y as z` only when justified | Info     | —                               |
| `unused-import`              | Remove unused imports                      | Hint     | Delete or trim                  |
| `wrong-import-order`         | stdlib → third-party → local               | Info     | Reorder                         |
| `wrong-alphabetical-order`   | Alphabetical within groups                 | Info     | Reorder                         |
| `misplaced-import`           | Import not in the top-level block          | Warning  | Move to top and reorder         |

The `import-modules-not-symbols` rule uses a three-tier approach to distinguish module imports from symbol imports:

1. **Definitive filesystem check**: `isModuleFile()` checks whether the module path (e.g. `sample.service.config`) resolves to a `.py` file in the workspace. If it does, everything imported from it is definitively a symbol — a `.py` file cannot contain sub-modules. The violation is flagged immediately.
2. **Sub-module filesystem check**: `isWorkspaceModule()` checks whether the _imported name_ resolves to a `.py` file or package. If so, it is treated as a module import (not flagged).
3. **Dot-access heuristic**: If a snake_case imported name is used with dot access (`name.attr`) in the file, it is treated as a module. PascalCase names (starting with an uppercase letter) skip this heuristic, as they are almost certainly classes whose dot access (e.g. `Config.from_dict()`) should not suppress the violation.

Exemptions per Google style 2.2.4.1: `typing`, `collections.abc`, `typing_extensions`, and `six.moves` are exempt from this rule. The rule applies to all modules including stdlib — importing symbols from stdlib modules (e.g. `from os.path import join`) is flagged the same as third-party symbol imports.

The `non-standard-import-alias` rule enforces that `import y as z` is only used when `z` is a recognised standard abbreviation (e.g. `import numpy as np`). A built-in list of well-known aliases is used for validation. The auto-fix replaces the import with the standard alias (or removes the alias entirely) and renames all references in code from the old alias to the new name.

The `unnecessary-from-alias` rule flags `from x import y as z` when no other import in the file imports a name `y`, indicating there is no detectable naming conflict. The remaining subjective conditions (long name, too generic, conflicts with local definitions) are noted in the diagnostic message for the developer to evaluate.

## Key Algorithms

### Import Parsing (`import-parser.ts`)

Handles both single-line and multi-line imports:

```python
# Single line
import os
from os.path import join, exists

# Multi-line (parenthesized)
from typing import (
    List,
    Dict,
    Optional,
)
```

The parser:

1. Strips inline `#` comments from import lines before parsing names (prevents `from x import y  # comment with, commas` from corrupting the name list)
2. Matches `import X` or `from X import Y` patterns
3. Parses `as` aliases into a `Map<string, string>` on the `ImportStatement`, preserving the original name as the key and the alias as the value
4. Tracks relative import level (number of dots)
5. Collects multi-line imports by tracking parentheses (inline comments are stripped from each continuation line)
6. Records `endLine` for multi-line imports (used for correct range spanning and skip logic)
7. Scans the **entire file** — the top-level import block is determined by the 2-consecutive-non-import-line heuristic (blank lines, comments, docstrings, `__all__`, and `if TYPE_CHECKING` guards are permitted), but imports found after the block closes are still parsed and marked with `misplaced: true`
8. Misplaced imports are flagged by the validator (Rule 10) and relocated to the top by the sorter

### Symbol Usage Detection (`text-utils.ts`)

The shared `isNameUsedOutsideLines()` function determines if an imported name is referenced anywhere in the document outside the import block:

1. Create regex pattern: `\b{name}\b` (word boundary match)
2. Search entire document text
3. For each match:
    - Skip if on an excluded line (the **entire** import block's line range, via `ReadonlySet<number>` — ensuring a name appearing only in another import statement is not treated as "used")
    - Skip if in a string or comment (via `isInStringOrComment` — handles `#` comments, single/double/triple quotes, and f-string expressions)
4. Return true if any valid usage found

The `importLines` set in `ValidationResult` is computed once and shared across all consumers, guaranteeing consistent unused-import detection.

### Wildcard Import Fixing (`fix-imports.ts`)

For `from os.path import *`:

1. Check if module has known symbols in `MODULE_SYMBOLS`
2. For each known symbol, search document for usages
3. Replace each usage: `abspath(...)` → `os.path.abspath(...)`
4. Replace import: `from os.path import *` → `import os`

Symbol detection skips:

- All lines of the import statement (`line` through `endLine`), including multi-line parenthesized imports
- Strings and comments (using `isInStringOrComment`)
- Already-qualified names (preceded by `.`)

### Non-Standard Alias Fixing (`fix-imports.ts`)

For `import os as operating_system` (no standard alias exists) or `import datetime as date` (standard is `dt`):

1. Replace the import statement with the suggested fix (`import os` or `import datetime as dt`)
2. Determine the new usage name: standard alias if present, otherwise the bare module name
3. Replace all references in code: `operating_system.xxx` → `os.xxx`, `date.xxx` → `dt.xxx`

Reference replacement skips import lines, strings, comments, and already-qualified names — same rules as wildcard and symbol-import fixing.

### Symbol Import Fixing (`fix-imports.ts`)

For `from json import loads as json_loads` (import-modules-not-symbols):

1. Check if the module is already imported via `import X [as Y]` — if so, reuse that existing reference name to avoid creating a duplicate import that would be incorrectly merged by the deduplicator
2. Replace the import statement: `from X import Y` → `import X` (top-level) or `from X import Y` → `from X import mod` (deep)
3. Replace all references — **alias-aware**: when the imported name has an `as` alias, searches for the alias (e.g. `json_loads`) not the original name (`loads`), and replaces with the qualified form (`json.loads`)

### Import Sorting (`sort-imports.ts`)

Receives a pre-computed `ValidationResult` — **no independent scanning**:

1. **Read** parsed imports, categories, and unused names from `ValidationResult`
2. **Normalize**: Expand `import os, sys` → separate imports
3. **Filter**: Remove imports where all names are unused (uses pre-computed `unusedNames` map; preserves `__future__` directives). When a name has an `as` alias, the alias is checked for usage instead of the original name.
4. **Deduplicate**: Merge `from X import a` and `from X import b` (aliases are preserved during merging)
5. **Categorize**: Use pre-computed `categories` map (future / stdlib / third-party / first-party / local)
6. **Sort**: `import` statements before `from` statements, then alphabetically by module name within each sub-group (ignoring case) — matching Ruff/isort default behaviour
7. **Format**: Join with blank lines between categories, reconstructing `as` clauses where present
8. **Relocate**: If misplaced imports exist, delete them from their scattered positions (bottom-up to preserve line numbers) and merge into the top block
9. **Apply**: Replace top-block range with the sorted text (or no-op if already correct)

### String/Comment Detection (`text-utils.ts`)

The `isInStringOrComment` function handles:

- `#` comments (but not `#` inside strings)
- Single and double quotes
- Triple quotes
- F-strings (code inside `{}` is NOT in a string)

## Extension Lifecycle

### Activation (`extension.ts`)

1. Create Output channel for logging (`logger.ts`)
2. Initialise module resolver (scans workspace for `.py` files)
3. Load first-party module configuration:
    - Global modules from `important.knownFirstParty` setting
    - Scoped modules from all `pyproject.toml` files in the workspace (root-first)
4. Create `DiagnosticCollection` for import issues
5. Register `CodeActionProvider` for quick fixes (reads from `DiagnosticCollection` rather than re-validating)
6. Register `HoverProvider` for diagnostic hover info
7. Register commands (`important.fixImports`, `important.showFirstPartyModules`)
8. Set up event handlers:
    - `onDidOpenTextDocument` — validate on open
    - `onDidChangeTextDocument` — validate on type (debounced)
    - `onDidSaveTextDocument` — validate on save (if enabled)
    - `onDidChangeActiveTextEditor` — revalidate when switching files
    - `onDidChangeConfiguration` — re-register handlers and reload first-party modules
9. Validate all currently-open Python documents (once module resolver is ready)
10. Watch `pyproject.toml` for changes and auto-reload first-party configuration

### Deactivation

1. Log deactivation
2. Clear pending validation timers
3. Dispose config-dependent handlers
4. Dispose module resolver
5. Clear validation cache
6. Dispose diagnostic collection

## Logging

The extension writes timestamped messages to a dedicated **"Important"** Output channel (`View → Output → select "Important"`). Key events logged:

- Activation and deactivation lifecycle
- Module resolver initialisation and cache rebuilds (with file counts)
- First-party module loading — global (from settings) and per-scope (from `pyproject.toml`)
- `pyproject.toml` discovery, parsing results, and scoped directory paths
- Fix command execution (with issue counts)
- Configuration changes

Logging utilities are in `utils/logger.ts` and expose `log()`, `logWarn()`, and `logError()` functions.

## Configuration

```typescript
interface ImportantConfig {
	validateOnSave: boolean; // Validate when file is saved
	validateOnType: boolean; // Validate as you type
	styleGuide: "google"; // Style guide (currently only Google)
	knownFirstParty: readonly string[]; // Module names treated as first-party
	readFromPyprojectToml: boolean; // Auto-read first-party from pyproject.toml
}
```

Configuration changes trigger re-registration of event handlers and reloading of first-party modules.

## Adding New Rules

To add a new validation rule:

1. Add issue code to `ImportIssueCode` in `types.ts`
2. Add validation logic in `validateImports()` in `import-validator.ts`
3. If auto-fixable, add `suggestedFix` to the issue
4. For complex fixes, add handling in `fix-imports.ts`
5. If the rule uses alias information, access `imp.aliases` (a `ReadonlyMap<string, string>` mapping original name → alias)

## Adding Module Symbols

To support wildcard fixing for a new module:

1. Open `src/utils/module-symbols.ts`
2. Add entry to `MODULE_SYMBOLS`:

```typescript
'newmodule': [
    'symbol1', 'symbol2', 'symbol3',
],
```

## Testing

1. Press `F5` to launch Extension Development Host
2. Open `tests/application/src/main.py`
3. Observe squiggly underlines for issues
4. Run "Important: Fix Imports in This File"
5. Verify all issues are fixed correctly

## Build Commands

| Command           | Description                 |
| ----------------- | --------------------------- |
| `npm run compile` | Build with source maps      |
| `npm run watch`   | Build and watch for changes |
| `npm run lint`    | Run ESLint                  |
| `npm run package` | Create .vsix package        |

## Performance Considerations

- **Validation debouncing**: Validation is debounced (50ms) to avoid excessive CPU usage during typing
- **Single scan / cached result**: `validateImports()` returns a `ValidationResult` that is cached by document URI + version in `validation-cache.ts`. Diagnostics, the fix command, and the import sorter all consume the same cached result — no duplicate scans
- **Import category caching**: Categories are computed once per scan and stored in `ValidationResult.categories`, avoiding redundant recomputation
- **Unused-name consistency**: Unused-name detection excludes **all** import lines (not just the current import's lines), preventing false positives from names appearing in other import statements. Results are stored in `ValidationResult.unusedNames` and shared
- **Index-based module lookups**: `isLocalModule()` and `isModuleFile()` use pre-built indices (`rootModuleIndex` and `moduleFileSuffixes`) for O(1) lookups instead of iterating all module paths
- **Incremental cache updates**: File creation adds a single entry to the module cache; file deletion rebuilds indices (since shared segments can't be removed incrementally)
- **Full-file import scanning**: The parser scans the entire file to detect misplaced imports after the top block. Imports found later in the file are marked `misplaced: true` and relocated to the top on fix
- **Diagnostic reuse**: The `CodeActionProvider` reads from the existing `DiagnosticCollection` instead of re-running validation on every code-action request
- **Module-level constants**: `SYMBOL_IMPORT_EXEMPTIONS`, `CATEGORY_ORDER`, and `documentText` are computed once per validation run, not per import
- **Sort iteration cap**: Sort iterations are capped at 5 to prevent infinite loops
