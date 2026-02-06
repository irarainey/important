# Sample Project

A minimal Python project for testing the **Important** extension.

## Files

| File                          | Import Issues                                                             |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/main.py`                 | Multiple imports, wrong order, unused, wildcard import, symbol import     |
| `src/complex_example.py`      | Non-standard aliases, from-aliases, deep namespace imports, multiline     |
| `src/alias_examples.py`       | Standard vs non-standard aliases, typing exemptions, conflict-based alias |
| `src/utils/utils.py`          | Relative import, symbol import, wrong alphabetical order                  |
| `src/helpers/helpers.py`      | Multiple imports on one line, unused import                               |
| `src/models/sample_models.py` | ✅ Clean - no issues (for comparison)                                     |

## Project Structure

```
tests/application/
├── pyproject.toml              # Configures 'other_library' as first-party
├── other_library/              # First-party package (deeply nested)
│   ├── __init__.py
│   ├── helpers.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── base.py             # BaseProcessor, ProcessorConfig
│   │   └── exceptions.py       # ProcessingError, ValidationError
│   └── utils/
│       ├── __init__.py
│       ├── formatting.py       # format_output, truncate_string
│       └── validation.py       # validate_input, is_valid_email
└── src/
    ├── main.py                 # Basic violations
    ├── complex_example.py      # Advanced violations (aliases, multiline, deep)
    ├── alias_examples.py       # Alias-specific test cases
    ├── helpers/
    ├── models/
    ├── services/               # Deep namespace structure
    │   └── api/
    │       └── handlers/
    │           ├── user_handler.py
    │           └── project_handler.py
    └── utils/
```

## Testing the Extension

1. Press `F5` to launch the Extension Development Host
2. Open any `.py` file in the `src/` folder
3. Look for squiggly underlines indicating import issues
4. Hover over issues to see explanations
5. Use quick fixes (lightbulb) or run **"Important: Fix Imports in This File"**

All issues in these sample files can be automatically fixed.

## Test Scenarios

### Alias Validation (`alias_examples.py`)

- **Standard aliases** (accepted): `np`, `pd`, `plt`, `tf`, `sns`
- **Non-standard aliases** (flagged): `import numpy as num`, `import os as operating_system`
- **Unnecessary from-aliases** (flagged): `from json import loads as json_loads`
- **Conflict-based aliases** (accepted): When two imports share a name

### Deep Namespace Imports (`complex_example.py`)

- `from services.api.handlers.user_handler import UserRequest` → should become module import
- Multi-line parenthesized imports with multiple symbols
- First-party deep imports from `other_library.core.base`

### Typing Exemptions

- `typing`, `typing_extensions`, `collections.abc` are exempt from Rule 4
- Symbols can be imported directly from these modules
