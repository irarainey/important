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
│   ├── import-validator.ts         # Validate against style rules
│   └── diagnostics.ts              # Convert issues to VS Code diagnostics
├── fixes/
│   ├── fix-imports.ts              # Main fix orchestration
│   └── sort-imports.ts             # Sorting, deduplication, unused removal
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
│  parseImports()       │  Extract ImportStatement[]
└───────────────────────┘
      │
      ▼
┌───────────────────────┐
│  validateImports()    │  Apply rules, produce ImportIssue[]
└───────────────────────┘
      │
      ▼
┌───────────────────────┐
│  issuesToDiagnostics()│  Convert to vscode.Diagnostic[]
└───────────────────────┘
      │
      ▼
┌───────────────────────┐
│  DiagnosticCollection │  Display in editor
└───────────────────────┘
```

### Fix Flow

```
"Fix Imports" Command
      │
      ▼
┌────────────────────────┐
│  fixAllImports()       │
└────────────────────────┘
      │
      ├──► Fix wildcard imports (if known symbols exist)
      │    - Scan for used symbols from MODULE_SYMBOLS
      │    - Replace symbol usages with qualified names
      │    - Convert to module import
      │
      ├──► Fix import-modules-not-symbols
      │    - Detect symbol imports via three-tier approach:
      │      1. Definitive: module path is a .py file (isModuleFile)
      │      2. Sub-module: imported name is a .py file/package (isWorkspaceModule)
      │      3. Heuristic: snake_case name with dot-access usage
      │    - Top-level: from pkg import Cls → import pkg
      │    - Deep: from pkg.mod import Cls → from pkg import mod
      │    - Replace symbol usages with qualified names
      │
      └──► sortImportsInDocument() (up to 5 iterations)
           - Expand multi-imports
           - Remove unused imports
           - Deduplicate imports
           - Group by category
           - Sort: `import` before `from`, then alphabetically
           - Apply edit if changed
```

## Core Types

### ImportStatement

Represents a parsed Python import:

```typescript
interface ImportStatement {
	type: "import" | "from"; // import X vs from X import Y
	module: string; // The module name (e.g., 'os.path')
	names: readonly string[]; // Imported names (['join', 'exists'] or ['os'])
	level: number; // Relative import dots (0 = absolute)
	line: number; // Start line number (0-based)
	endLine: number; // End line number (same as line for single-line imports)
	text: string; // Original import text (may contain newlines for multi-line)
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

### ImportCategory

Categorizes imports for grouping (matching Ruff / isort ordering):

```typescript
type ImportCategory = "future" | "stdlib" | "third-party" | "first-party" | "local";
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

| Code                         | Rule                            | Severity | Auto-Fix                  |
| ---------------------------- | ------------------------------- | -------- | ------------------------- |
| `no-relative-imports`        | No relative imports (`.module`) | Warning  | Strip dots                |
| `no-wildcard-imports`        | No `from X import *`            | Warning  | Convert to module import  |
| `no-multiple-imports`        | No `import os, sys`             | Warning  | Split to separate lines   |
| `import-modules-not-symbols` | Import modules, not symbols     | Info     | Refactor to module access |

The `import-modules-not-symbols` rule uses a three-tier approach to distinguish module imports from symbol imports:

1. **Definitive filesystem check**: `isModuleFile()` checks whether the module path (e.g. `sample.service.config`) resolves to a `.py` file in the workspace. If it does, everything imported from it is definitively a symbol — a `.py` file cannot contain sub-modules. The violation is flagged immediately.
2. **Sub-module filesystem check**: `isWorkspaceModule()` checks whether the _imported name_ resolves to a `.py` file or package. If so, it is treated as a module import (not flagged).
3. **Dot-access heuristic**: If a snake_case imported name is used with dot access (`name.attr`) in the file, it is treated as a module. PascalCase names (starting with an uppercase letter) skip this heuristic, as they are almost certainly classes whose dot access (e.g. `Config.from_dict()`) should not suppress the violation.

| `unused-import` | Remove unused imports | Hint | Delete or trim |
| `wrong-import-order` | stdlib → third-party → local | Info | Reorder |
| `wrong-alphabetical-order` | Alphabetical within groups | Info | Reorder |

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

1. Matches `import X` or `from X import Y` patterns
2. Handles `as` aliases (strips them for validation)
3. Tracks relative import level (number of dots)
4. Collects multi-line imports by tracking parentheses
5. Records `endLine` for multi-line imports (used for correct range spanning and skip logic)

### Symbol Usage Detection (`import-validator.ts`, `sort-imports.ts`)

Determines if an imported name is used:

1. Create regex pattern: `\b{name}\b` (word boundary match)
2. Search entire document text
3. For each match:
    - Skip if within the import's line range (`line` to `endLine`) — correctly handles multi-line imports
    - Skip if in a comment (check for `#` before match)
4. Return true if any valid usage found

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

### Import Sorting (`sort-imports.ts`)

1. **Parse** all imports in document
2. **Normalize**: Expand `import os, sys` → separate imports
3. **Filter**: Remove imports where all names are unused (preserves `__future__` directives)
4. **Deduplicate**: Merge `from X import a` and `from X import b`
5. **Categorize**: Assign each to future / stdlib / third-party / first-party / local
6. **Sort**: `import` statements before `from` statements, then alphabetically by module name within each sub-group (ignoring case) — matching Ruff/isort default behaviour
7. **Format**: Join with blank lines between categories
8. **Apply**: Replace import block if changed

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
5. Register `CodeActionProvider` for quick fixes
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
5. Dispose diagnostic collection

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
2. Open `tests/sample_project/src/main.py`
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

- Validation is debounced (50ms) to avoid excessive CPU usage during typing
- Symbol usage detection uses efficient regex matching
- Fresh document references are obtained to ensure accurate content
- Sort iterations are capped at 5 to prevent infinite loops
