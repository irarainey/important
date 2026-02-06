# Sample Project

A minimal Python project for testing the **Important** extension.

## Files

| File                          | Import Issues                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| `src/main.py`                 | Multiple imports, wrong order, unused, wildcard import, symbol import |
| `src/utils/utils.py`          | Symbol import, wrong alphabetical order                               |
| `src/helpers/helpers.py`      | Multiple imports on one line, unused import                           |
| `src/models/sample_models.py` | ✅ Clean - no issues (for comparison)                                 |

## Testing the Extension

1. Press `F5` to launch the Extension Development Host
2. Open any `.py` file in the `src/` folder
3. Look for squiggly underlines indicating import issues
4. Hover over issues to see explanations
5. Use quick fixes (lightbulb) or run **"Important: Fix Imports in This File"**

All issues in these sample files can be automatically fixed.
