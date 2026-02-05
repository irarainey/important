# Sample Project

A minimal Python project for testing the **Important** extension.

## Files

| File         | Import Issues                                                  |
| ------------ | -------------------------------------------------------------- |
| `main.py`    | Multiple imports, wrong order, unused, wildcard, symbol import |
| `utils.py`   | Relative import, symbol import, wrong alphabetical             |
| `helpers.py` | Multiple imports, unused                                       |
| `models.py`  | ✅ Clean - no issues (for comparison)                          |

## Testing the Extension

1. Press `F5` to launch the Extension Development Host
2. Install packages using `uv sync` in the terminal
3. Open any `.py` file in this folder
4. Look for squiggly underlines indicating import issues
5. Hover over issues to see explanations
6. Use quick fixes (lightbulb) or right-click → "Important: Fix Imports in This File"
