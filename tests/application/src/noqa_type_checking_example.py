"""
Noqa with TYPE_CHECKING blocks — suppression inside and outside TC blocks.

This file tests that `# noqa: important` works correctly when combined
with `if TYPE_CHECKING:` blocks, lazy imports, and mixed violations.

Expected behaviour:
- noqa inside TYPE_CHECKING blocks suppresses TC-specific diagnostics.
- noqa outside TYPE_CHECKING blocks works as normal.
- The sorter preserves noqa-suppressed imports (never filters as unused).
- Mixed files with some noqa and some real violations sort correctly.
"""

# fmt: off

from __future__ import annotations

# ⚠️ VIOLATION: Wrong order — third-party before stdlib.
import requests
import os
import sys

# ✅ SUPPRESSED: Unused import kept intentionally.
import typing  # noqa: important[unused-import]

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # ✅ CORRECT: Symbol imports allowed inside TYPE_CHECKING.
    from models.sample_models import Config, User

    # ✅ SUPPRESSED: Unused type import — kept for future use.
    from collections import OrderedDict  # noqa: important[unused-import]

    # ✅ SUPPRESSED: Wrong alphabetical order inside TC block.
    from pathlib import PurePath  # noqa: important[wrong-alphabetical-order]
    from pathlib import Path

# ⚠️ VIOLATION: Symbol import — should be `from other_library.core import base`.
from other_library.core.base import BaseProcessor, ProcessorConfig

# ✅ SUPPRESSED: Symbol import allowed here via noqa.
from other_library.core.exceptions import ProcessingError  # noqa: important[import-modules-not-symbols]

# ⚠️ VIOLATION: Unused import (no usage of `abc` below).
import abc

# ✅ SUPPRESSED: Blanket noqa — multiple potential violations all silenced.
from other_library.helpers import greet, add  # noqa: important

# fmt: on


# ── Usage section ──

logger_name = os.path.basename(sys.argv[0])

print(requests.get("https://example.com").status_code)

config = ProcessorConfig(name="test", batch_size=10)
processor = BaseProcessor(config)
processor.process("data")

ProcessingError("something went wrong")

greet("world")
add(1, 2)


def annotate_user(user: User) -> Config:
    """Uses TYPE_CHECKING imports for annotations only."""
    print(user.name)
    return Config(debug=True)


def demonstrate_path(p: Path) -> PurePath:
    """Uses both Path and PurePath from TC block."""
    return PurePath(str(p))
