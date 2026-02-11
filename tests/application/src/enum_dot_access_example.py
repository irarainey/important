"""
Enum and class dot-access example — PascalCase symbol import detection.

This file tests the fix where PascalCase names (enums, classes, types)
used with dot-access (e.g. ProcessorConfig.name) were NOT being flagged
as symbol imports. The dot-access was incorrectly treated as evidence
of module usage, suppressing the import-modules-not-symbols violation.

Expected violations after fix:
- `from other_library.core.base import BaseProcessor, ProcessorConfig`
  → symbol import (should suggest `from other_library.core import base`)
- `from other_library.helpers import greet, add`
  → symbol import (should suggest `from other_library import helpers`)

Both should be flagged even though BaseProcessor(...) and
ProcessorConfig.name are dot-access patterns — these are constructor
calls and class attribute access, not module access.
"""

# fmt: off

import textwrap

# ⚠️ VIOLATION: Symbol import — BaseProcessor and ProcessorConfig
# are classes, not modules. ProcessorConfig(...) is a constructor call,
# and accessing .name is attribute access, not module access.
from other_library.core.base import BaseProcessor, ProcessorConfig

# ⚠️ VIOLATION: Symbol import — greet and add are functions.
from other_library.helpers import greet, add

# ✅ CORRECT: snake_case name with dot-access IS module-like usage.
# This should NOT be flagged because helpers.greet() indicates
# module access (the intended pattern per Google style).
from other_library import helpers

# Usage of the imports — demonstrating dot-access patterns
config = ProcessorConfig(name="test", batch_size=50)
processor = BaseProcessor(config)
processor.process("item")

# Class attribute access — looks like module access but isn't
print(config.name)

# Function calls — clearly symbols
result = greet("world")
total = add(1, 2)

# Module-level access — this is the correct pattern
helpers.greet("correct usage")

summary = textwrap.dedent("""
    Summary of processing results
""")

print(result, total, summary)