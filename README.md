# Important

A Visual Studio Code extension that validates and formats Python import statements according to the [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html#313-imports-formatting) and [PEP 8](https://peps.python.org/pep-0008/#imports), with [Ruff](https://docs.astral.sh/ruff/)-compatible first-party module support. It provides real-time diagnostics as you type, highlights unused imports, and can automatically fix all issues including wildcard imports, incorrect ordering, and symbol imports. The extension scans your code to understand which imports are actually used and applies intelligent fixes that update both the import statements and all related symbol references throughout your file.

## Features

**Important** helps you maintain clean, consistent Python imports by:

- **Real-time validation** - Issues are highlighted as you type
- **Unused import detection** - Faded highlighting for imports not used in your code
- **Quick fixes** - One-click "Fix All" for import problems
- **Auto-fix all** - Fix all issues and sort imports with a single command
- **Smart sorting** - Groups imports correctly and removes unused ones
- **Google Style Guide compliance** - Enforces industry-standard import conventions

### Validation Rules

| Rule                         | Description                                                  | Auto-Fix |
| ---------------------------- | ------------------------------------------------------------ | -------- |
| No relative imports          | `from .module import x` → `from package.module import x`     | ✅       |
| No wildcard imports          | `from os.path import *` → `import os` + `os.path.func()`     | ✅       |
| One import per line          | `import os, sys` → separate statements                       | ✅       |
| Import modules not symbols   | `from fastmcp import Cls` → `import fastmcp` + `fastmcp.Cls` | ✅       |
| Standard import aliases only | `import y as z` only for standard abbreviations (e.g. `np`)  | ✅       |
| Justified from-aliases only  | `from x import y as z` only when a naming conflict exists    | —        |
| Unused imports               | Imports not referenced in code are removed                   | ✅       |
| Duplicate imports            | Multiple identical imports are merged                        | ✅       |
| Correct ordering             | `__future__` → stdlib → third-party → first-party → local    | ✅       |
| Sorted within groups         | `import` before `from`, then alphabetically                  | ✅       |

### Example

Before running "Fix Imports":

```python
import requests
import os, sys
from os.path import *
from models.user import User
import json

print(abspath("."))
user = User()
```

After:

```python
import json
import os
import sys

import requests

from models import user

print(os.path.abspath("."))
user = user.User()
```

### Commands

| Command                                 | Shortcut                                               | Description                                                                           |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Important: Fix Imports in This File** | `Ctrl+K, Ctrl+Shift+F` (`Cmd+K, Cmd+Shift+F` on macOS) | Apply all available fixes, remove unused imports, and sort                            |
| **Important: Show First-Party Modules** | —                                                      | Display the resolved list of first-party modules (from settings and `pyproject.toml`) |

Also available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or right-click context menu.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Important"
4. Click **Install**

### Manual Installation (VSIX)

1. Download or build the `.vsix` file (see [Building](#building))
2. Open VS Code
3. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
4. Click the `...` menu → **Install from VSIX...**
5. Select the `.vsix` file

Or via command line:

```bash
code --install-extension important-python-0.3.0.vsix
```

## Configuration

Configure via VS Code Settings (`Ctrl+,` / `Cmd+,`):

| Setting                           | Type     | Default    | Description                                                                     |
| --------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------- |
| `important.validateOnSave`        | boolean  | `true`     | Validate imports when saving                                                    |
| `important.validateOnType`        | boolean  | `true`     | Validate imports as you type and after formatter changes                        |
| `important.styleGuide`            | string   | `"google"` | Style guide to use                                                              |
| `important.knownFirstParty`       | string[] | `[]`       | Module names to treat as first-party imports (e.g. `["myproject"]`)             |
| `important.readFromPyprojectToml` | boolean  | `true`     | Auto-read `known-first-party` from `[tool.ruff.lint.isort]` in `pyproject.toml` |

### Example settings.json

```json
{
	"important.validateOnSave": true,
	"important.validateOnType": true,
	"important.styleGuide": "google",
	"important.knownFirstParty": ["myproject", "mypackage"],
	"important.readFromPyprojectToml": true
}
```

### Import Sorting

The "Fix Imports" command includes automatic import sorting that:

- Groups imports into 5 categories: `__future__` → stdlib → third-party → first-party → local
- Sorts `import` statements before `from` statements within each group, then alphabetically by module name (ignoring case) — matching [Ruff/isort](https://docs.astral.sh/ruff/rules/unsorted-imports/) default behaviour
- Splits multi-imports (`import os, sys`) into separate lines
- Removes unused imports (preserves `__future__` directives)
- Merges duplicate imports
- Fixes wildcard imports by converting to qualified module access

### First-Party Module Support

First-party modules are project-specific packages that should be grouped between third-party and local imports, matching [Ruff's isort](https://docs.astral.sh/ruff/settings/#lint_isort_known-first-party) behaviour.

**Automatic detection from `pyproject.toml`** (enabled by default):

If your project has a `pyproject.toml` with a Ruff isort configuration, the extension automatically reads it:

```toml
[tool.ruff.lint.isort]
known-first-party = ["myproject", "mypackage"]
```

The extension watches for `pyproject.toml` changes and reloads automatically.

**Monorepo support**: The extension discovers every `pyproject.toml` in the workspace (excluding `node_modules`, `.venv`, and `venv` directories). Modules declared in a nested `pyproject.toml` are **scoped** — they only apply when validating Python files within that directory subtree. For example, a `packages/api/pyproject.toml` declaring `known-first-party = ["api_core"]` only affects files under `packages/api/`. Modules in the workspace-root `pyproject.toml` apply to all files.

**Manual configuration** via VS Code settings:

```json
{
	"important.knownFirstParty": ["myproject", "mypackage"]
}
```

Modules configured via settings are **global** — they apply to every document regardless of path.

When both sources are active, global settings and scoped TOML entries are consulted together.

**Resulting import order:**

```python
from __future__ import annotations

import os
import sys

import requests

from myproject import config
from myproject.models import base

from . import utils
```

### Wildcard Import Fixing

Wildcard imports (`from X import *`) are automatically fixed for supported stdlib modules:

- `os`, `os.path`, `sys`
- `re`, `json`, `collections`
- `typing`, `pathlib`, `datetime`
- `math`, `functools`, `itertools`

The fix converts the import and updates all symbol usages:

```python
# Before
from os.path import *
print(abspath("."))

# After
import os
print(os.path.abspath("."))
```

### Non-Standard Alias Fixing

Non-standard import aliases are replaced with the recognised standard abbreviation (or the plain module name if no standard exists), and all references in code are updated:

```python
# Before
import numpy as num
import os as operating_system
import datetime as date

arr = num.array([1, 2, 3])
print(operating_system.name)
now = date.datetime.now()

# After
import datetime as dt
import numpy as np
import os

arr = np.array([1, 2, 3])
print(os.name)
now = dt.datetime.now()
```

### Alias-Aware Symbol Import Fixing

When fixing `from X import Y as Z` style symbol imports, the fixer correctly searches for the alias (not the original name) and replaces it with the qualified form:

```python
# Before
from json import loads as json_loads
from collections import OrderedDict as OD

data = json_loads(text)
config = OD([("key", "value")])

# After
import collections
import json

data = json.loads(text)
config = collections.OrderedDict([("key", "value")])
```

## Building

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm 9+

### Development Build

```bash
# Clone the repository
git clone https://github.com/irarainey/important.git
cd important

# Install dependencies
npm install

# Compile
npm run compile

# Run linter
npm run lint
```

### Watch Mode

For development with auto-recompilation:

```bash
npm run watch
```

### Package for Distribution

Create a `.vsix` file for manual installation:

```bash
npm run package
```

The package will be created in the `output/package/` directory.

## Project Structure

```
important/
├── src/
│   ├── extension.ts            		# Extension entry point & lifecycle
│   ├── types.ts                		# TypeScript type definitions
│   ├── providers/              		# VS Code language providers
│   │   ├── code-action-provider.ts  	# Quick fix code actions
│   │   └── hover-provider.ts        	# Hover information for diagnostics
│   ├── validation/              		# Import validation logic
│   │   ├── import-parser.ts        	# Import statement parsing
│   │   ├── import-validator.ts     	# Validation rules
│   │   ├── validation-cache.ts     	# Version-keyed validation cache
│   │   └── diagnostics.ts          	# Diagnostic conversion
│   ├── fixes/                   		# Import fixing logic
│   │   ├── fix-imports.ts          	# Fix all imports command
│   │   └── sort-imports.ts         	# Import sorting
│   └── utils/                  		# Utility modules
│       ├── logger.ts          			# Output channel logging
│       ├── module-resolver.ts  		# Workspace Python module detection
│       ├── module-symbols.ts   		# Known symbols for wildcard import fixing
│       ├── pyproject-reader.ts 		# Reads first-party config from pyproject.toml
│       ├── stdlib-modules.ts   		# Python standard library module list
│       └── text-utils.ts      			# Text/regex utilities
├── tests/
│   └── application/         		# Sample Python project for testing
│       ├── other_library/         	# First-party package (with nested modules)
│       │   ├── core/              	# BaseProcessor, exceptions
│       │   └── utils/             	# formatting, validation
│       └── src/
│           ├── main.py             	# Multiple issues: multi-imports, order, unused
│           ├── complex_example.py  	# Aliases, multiline, deep namespace imports
│           ├── alias_examples.py   	# Standard vs non-standard alias testing
│           ├── services/api/handlers/	# Deep namespace test structure
│           ├── helpers/helpers.py  	# Parent relative import, multiple imports
│           ├── models/sample_models.py	# Clean file (no issues)
│           └── utils/utils.py      	# Relative imports, symbol imports
├── docs/
│   ├── ARCHITECTURE.md        			# Developer documentation
│   └── CHANGELOG.md               		# Release changelog
├── output/                    			# Compiled output (generated)
├── package.json               			# Extension manifest & dependencies
├── tsconfig.json              			# TypeScript configuration
└── eslint.config.mjs          			# ESLint configuration
```

## Development

### Running in Debug Mode

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. The sample project (`tests/application`) opens automatically
4. Open any Python file to see import validation in action

The sample project includes intentional import violations for testing:

| File                          | Violations                                                      |
| ----------------------------- | --------------------------------------------------------------- |
| `src/main.py`                 | Multiple imports, wrong order, unused, wildcard, symbol imports |
| `src/complex_example.py`      | Non-standard aliases, deep namespace, multiline symbol imports  |
| `src/alias_examples.py`       | Standard vs non-standard aliases, from-alias, typing exemptions |
| `src/utils/utils.py`          | Relative import, symbol import, wrong alphabetical order        |
| `src/helpers/helpers.py`      | Multiple imports on one line, unused import                     |
| `src/models/sample_models.py` | ✅ Clean - no issues (for comparison)                           |

### Available Scripts

| Script            | Description                 |
| ----------------- | --------------------------- |
| `npm run compile` | Build with source maps      |
| `npm run watch`   | Build and watch for changes |
| `npm run lint`    | Run ESLint                  |
| `npm run package` | Create .vsix package        |

### Developer Documentation

For detailed architecture, workflow diagrams, and implementation details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- VS Code 1.85.0 or higher
- Python files (`.py`) to validate

## License

See [LICENSE.md](LICENSE.md) for details.

## Links

- [Repository](https://github.com/irarainey/important)
- [Google Python Style Guide - Imports](https://google.github.io/styleguide/pyguide.html#313-imports-formatting)
- [PEP 8 - Imports](https://peps.python.org/pep-0008/#imports)
- [Ruff isort - known-first-party](https://docs.astral.sh/ruff/settings/#lint_isort_known-first-party)
