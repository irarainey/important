# Sample Project

A minimal Python project for testing the **Important** extension.

## Setup

Install dependencies using [uv](https://docs.astral.sh/uv/):

```bash
cd examples/sample_project
uv sync
```

## Files

| File         | Import Issues                                                  |
| ------------ | -------------------------------------------------------------- |
| `main.py`    | Multiple imports, wrong order, unused, wildcard, symbol import |
| `utils.py`   | Relative import, symbol import, wrong alphabetical             |
| `helpers.py` | Multiple imports, unused                                       |
| `models.py`  | ✅ Clean - no issues (for comparison)                          |

## Testing the Extension

1. Press `F5` to launch the Extension Development Host
2. Open any `.py` file in this folder
3. Look for squiggly underlines indicating import issues
4. Hover over issues to see explanations
5. Use quick fixes (lightbulb) or right-click → "Important: Fix Imports in This File"
