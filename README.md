<p align="center">
  <img src="resources/images/logo.png" alt="Important" width="128" />
</p>

# Important

A Visual Studio Code extension that validates and formats Python import statements according to the [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html#313-imports-formatting).

## Features

**Important** helps you maintain clean, consistent Python imports by:

- **Real-time validation** - Issues are highlighted as you type
- **Unused import detection** - Faded highlighting for imports not used in your code
- **Quick fixes** - One-click fixes for common import problems
- **Auto-fix all** - Fix all issues and sort imports with a single command
- **Smart sorting** - Groups imports correctly and removes unused ones
- **Google Style Guide compliance** - Enforces industry-standard import conventions
- **Bundled tools** - Includes isort for sorting (no installation required)

### Validation Rules

| Rule                       | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| No relative imports        | `from .module import x` → `from package.module import x`      |
| No wildcard imports        | `from os import *` is not allowed                             |
| One import per line        | `import os, sys` → separate statements                        |
| Import modules not symbols | `from pkg.mod import Cls` → `from pkg import mod` + `mod.Cls` |
| Unused imports             | Imports not referenced in code are flagged                    |
| Correct ordering           | stdlib → third-party → local                                  |
| Alphabetical order         | Within each group                                             |

### Commands

- **Important: Fix Imports in This File** - Apply all available fixes, remove unused imports, and sort
- **Important: Validate Imports in This File** - Run validation manually
- **Important: Sort Imports with isort** - Sort imports using bundled isort with Google profile

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or right-click context menu.

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
code --install-extension important-0.0.2.vsix
```

## Configuration

Configure via VS Code Settings (`Ctrl+,` / `Cmd+,`):

| Setting                    | Type    | Default    | Description                                                      |
| -------------------------- | ------- | ---------- | ---------------------------------------------------------------- |
| `important.validateOnSave` | boolean | `true`     | Validate imports when saving                                     |
| `important.validateOnType` | boolean | `true`     | Validate imports as you type and after formatter changes         |
| `important.styleGuide`     | string  | `"google"` | Style guide to use                                               |
| `important.sortMethod`     | string  | `"native"` | Sort method: `"native"` (built-in) or `"isort"` (external tool)  |
| `important.isortPath`      | string  | `"isort"`  | Path to isort executable (uses bundled version if not specified) |

### Example settings.json

```json
{
	"important.validateOnSave": true,
	"important.validateOnType": true,
	"important.styleGuide": "google",
	"important.sortMethod": "native"
}
```

### Import Sorting

The extension provides two ways to sort imports:

1. **Native sorting** (default) - Built-in sorter that:
    - Groups imports: stdlib → third-party → local
    - Sorts alphabetically within each group
    - Splits multi-imports (`import os, sys`) into separate lines
    - Removes unused imports

2. **isort integration** - Uses the bundled [isort](https://pycqa.github.io/isort/) tool with Google profile:
    - Run via "Important: Sort Imports with isort" command
    - The extension bundles isort, so no installation required
    - Custom path can be specified via `important.isortPath`

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

The package will be created in the `package/` directory.

## Project Structure

```
important/
├── src/
│   ├── extension.ts            # Extension entry point & lifecycle
│   ├── types.ts                # TypeScript type definitions
│   ├── import-validator.ts     # Import parsing & validation logic
│   ├── code-action-provider.ts # Quick fix code actions
│   ├── hover-provider.ts       # Hover information for diagnostics
│   └── stdlib-modules.ts       # Python standard library module list
├── python-runtime/             # Bundled Python runtimes with isort
│   ├── linux/                  # Linux x86_64 runtime
│   ├── darwin/                 # macOS x86_64 runtime
│   └── win/                    # Windows x86_64 runtime
├── examples/
│   └── sample_project/         # Sample Python project for testing
│       ├── src/sample_project/ # Python source with example violations
│       ├── tests/              # pytest test suite
│       └── pyproject.toml      # uv/pip dependencies
├── scripts/
│   ├── download-python-standalone.sh  # Download Python runtimes
│   └── build-python-runtime.sh        # Build runtime from local Python
├── dist/                       # Compiled output (generated)
├── package.json                # Extension manifest & dependencies
├── tsconfig.json               # TypeScript configuration
└── eslint.config.mjs           # ESLint configuration
```

## Development

### Running in Debug Mode

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. The sample project (`examples/sample_project`) opens automatically
4. Open any Python file to see import validation in action

The sample project includes intentional import violations for testing:

| File                 | Violations                                                    |
| -------------------- | ------------------------------------------------------------- |
| `demo_fixable.py`    | Multiple imports, relative imports, symbol imports, wildcards |
| `cli.py`             | Wildcard import, relative imports                             |
| `client.py`          | Wrong import order (third-party before stdlib)                |
| `config.py`          | Multiple imports, wrong order, wrong alphabetical             |
| `errors.py`          | Multiple imports, wrong alphabetical, relative imports        |
| `validators.py`      | Multiple imports, wrong order                                 |
| `cache.py`           | Multiple imports, wrong alphabetical, relative imports        |
| `test_config.py`     | Multiple imports, wrong alphabetical                          |
| `test_validators.py` | Wrong alphabetical order                                      |

### Setting Up the Sample Project

The sample project uses [uv](https://astral.sh/uv) for dependency management:

```bash
cd examples/sample_project

# Create virtual environment and install dependencies
uv venv
uv pip install -e ".[dev]"

# Run tests
source .venv/bin/activate
pytest
```

### Available Scripts

| Script                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `npm run compile`       | Build with source maps                              |
| `npm run watch`         | Build and watch for changes                         |
| `npm run lint`          | Run ESLint                                          |
| `npm run package`       | Create .vsix package                                |
| `npm run build:runtime` | Download and set up bundled Python runtimes         |
| `npm run package:full`  | Build runtime + create .vsix package (for releases) |

## Requirements

- VS Code 1.85.0 or higher
- Python files (`.py`) to validate

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

See [LICENSE.md](LICENSE.md) for details.

## Links

- [Repository](https://github.com/irarainey/important)
- [Issues](https://github.com/irarainey/important/issues)
- [Google Python Style Guide - Imports](https://google.github.io/styleguide/pyguide.html#313-imports-formatting)
