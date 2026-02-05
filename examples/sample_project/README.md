# Sample Project

A sample Python project for testing the [Important](../../README.md) VS Code extension. This project includes intentional import violations to demonstrate the extension's validation capabilities.

## Setup

```bash
# Install uv if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create virtual environment and install dependencies
uv venv
uv pip install -e ".[dev]"
```

## Usage

```bash
# Activate the virtual environment
source .venv/bin/activate

# Run the CLI
sample fetch https://api.github.com

# Run tests
pytest
```

## Import Violations for Testing

This project intentionally includes import violations to test the Important extension.

### Quick Test: demo_fixable.py

For the best demonstration of auto-fixing, open `src/sample_project/demo_fixable.py` and run **"Important: Fix Imports in This File"** from the Command Palette. This file contains violations that can be automatically fixed:

- `import os, sys, json` → splits into separate import statements
- `from .models import ...` → converts to absolute import
- `from sample_project.client import HttpClient` → `from sample_project import client`

### All Violations

| File              | Violation                                      | Rule                         | Auto-Fix? |
| ----------------- | ---------------------------------------------- | ---------------------------- | --------- |
| `demo_fixable.py` | `import os, sys, json` on one line             | `no-multiple-imports`        | ✅ Yes    |
| `demo_fixable.py` | `from .models import ...`                      | `no-relative-imports`        | ✅ Yes    |
| `demo_fixable.py` | `from sample_project.client import HttpClient` | `import-modules-not-symbols` | ✅ Yes    |
| `cli.py`          | `from os.path import *`                        | `no-wildcard-imports`        | ❌ No     |
| `cli.py`          | `from .client import ...`                      | `no-relative-imports`        | ✅ Yes    |
| `client.py`       | `import requests` before `import logging`      | `wrong-import-order`         | ❌ No     |
| `utils.py`        | `import json, hashlib, base64` on one line     | `no-multiple-imports`        | ✅ Yes    |
| `config.py`       | `import os, sys, json` on one line             | `no-multiple-imports`        | ✅ Yes    |
| `config.py`       | `tempfile` before `pathlib`                    | `wrong-alphabetical-order`   | ❌ No     |
| `config.py`       | Third-party (`pydantic`) before stdlib         | `wrong-import-order`         | ❌ No     |
| `errors.py`       | `import logging, sys, traceback` on one line   | `no-multiple-imports`        | ✅ Yes    |
| `errors.py`       | `from .config import ...`                      | `no-relative-imports`        | ✅ Yes    |
| `validators.py`   | `import re, string, unicodedata` on one line   | `no-multiple-imports`        | ✅ Yes    |
| `cache.py`        | `import time, threading, weakref` on one line  | `no-multiple-imports`        | ✅ Yes    |
| `cache.py`        | `from .errors import ...`                      | `no-relative-imports`        | ✅ Yes    |
| `test_config.py`  | `import os, tempfile, json` on one line        | `no-multiple-imports`        | ✅ Yes    |

Open these files in VS Code with the Important extension to see the diagnostics.

## Project Structure

```
sample_project/
├── src/
│   └── sample_project/
│       ├── __init__.py
│       ├── cache.py         # Caching utilities (has violations)
│       ├── cli.py           # Command-line interface (has violations)
│       ├── client.py        # HTTP client (has violations)
│       ├── config.py        # Configuration management (has violations)
│       ├── demo_fixable.py  # Demo file with fixable violations ⭐
│       ├── errors.py        # Error handling (has violations)
│       ├── models.py        # Pydantic models (clean)
│       ├── utils.py         # Utility functions (has violations)
│       └── validators.py    # Data validation (has violations)
├── tests/
│   ├── __init__.py
│   ├── test_client.py       # Client tests (clean)
│   ├── test_config.py       # Config tests (has violations)
│   ├── test_utils.py        # Utils tests (has violations)
│   └── test_validators.py   # Validator tests (has violations)
└── pyproject.toml
```
