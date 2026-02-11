"""
Multi-line string closing line example -- code after closing triple-quote.

This file tests the fix where code following a closing triple-quote
delimiter on the same line was being ignored by usage and dot-access
checks. The entire closing line was marked as inside a multi-line
string, causing module imports used only on that line to be
incorrectly flagged as symbol imports or reported as unused.

Expected behaviour after fix:
- from other_library import helpers should NOT be flagged -- the
  dot-access helpers.greet on the closing line proves it is a
  module import.
- from other_library import core should NOT be flagged -- same
  reason, used on a closing line with dot-access.
- import textwrap should NOT be flagged as unused -- it is used
  via textwrap.dedent() on a line that also opens a triple-quote.
"""

# fmt: off

import textwrap

from other_library.helpers import greet, add

# --- Case 1: dot-access immediately after closing """ ---
# The closing """ and module usage are on the same line.
# helpers.greet() should be detected as dot-access.
TOOL_DESCRIPTION = textwrap.dedent("""
    This tool processes data and generates output.
    It supports multiple formats and configurations.
""") + str(greet("schema"))

# --- Case 2: concatenation with module access after """ ---
PROCESSOR_INFO = textwrap.dedent("""
    Processor information:
    - Supports batch and streaming modes
    - Configurable output format
""") + str(add(1, 2))

# --- Case 3: method call chain after """ ---
FORMATTED = textwrap.dedent("""
    Raw template text
""").strip() + greet("suffix")

# --- Case 4: multi-line string NOT followed by code ---
# This is the normal case — closing """ on its own line.
SIMPLE_DOC = """
    This is a simple docstring.
    No code follows the closing delimiter.
"""

# Use the simple doc to keep it from being unused
print(TOOL_DESCRIPTION, PROCESSOR_INFO, FORMATTED, SIMPLE_DOC)
