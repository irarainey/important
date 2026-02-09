"""
Example demonstrating symbol-to-module import consolidation and name sorting.

This file mirrors a real-world pattern where multiple symbol imports from
sub-modules of the same package should be consolidated into module imports
with members sorted alphabetically — matching Ruff/isort output.

Before fix, the imports use ``from x.y import Symbol`` style.  After fix,
they become ``from x import y`` with qualified access ``y.Symbol``.

The tool must also handle docstrings like this one correctly — import-like
text inside triple-quoted strings must never be parsed as real imports or
have symbol replacements applied.

Key behaviours this exercises:

1. Members within ``from X import (a, b, c)`` must be sorted alphabetically
   — Ruff rejects unsorted member lists.
2. After converting ``Symbol`` to ``module.Symbol``, the bare ``Symbol`` name
   should be detected as unused (dot-qualified references must not count).
3. Import-like text inside docstrings must be ignored by the parser.

Run "Important: Fix Imports in This File" to see the extension in action.
"""

# fmt: off

from __future__ import annotations

import dataclasses
import logging

# ⚠️ VIOLATION: Wrong order — third-party before stdlib
import requests
import typing

# ⚠️ VIOLATION: Symbol imports from deep modules — should become module imports
# These should consolidate into: from other_library.core import base, exceptions
from other_library.core.base import BaseProcessor, ProcessorConfig
from other_library.core.exceptions import ProcessingError, ValidationError

# ⚠️ VIOLATION: Symbol imports — should consolidate into:
# from other_library.utils import formatting, validation
from other_library.utils.formatting import format_output, truncate_string
from other_library.utils.validation import validate_input, is_valid_email

# ⚠️ VIOLATION: Symbol imports from models — should become module import
from models.sample_models import User, Config, Project, Task

# fmt: on


logger = logging.getLogger(__name__)


@dataclasses.dataclass
class AppContext:
    """Demonstrates usage of consolidated module imports."""

    debug: bool = False
    version: str = "1.0.0"


def process_users() -> None:
    """Uses symbols that will be rewritten to qualified module access."""
    # After fix: models.sample_models.User, etc.
    user = User(id=1, name="Alice", email="alice@example.com")
    config = Config(debug=True, log_level="DEBUG")
    project = Project(name="Demo", owner=user, description="Test")
    task = Task(title="Review", project=project, assignee=user)

    logger.info("User: %s", user)
    logger.info("Config: %s", config)
    logger.info("Project: %s", project)
    logger.info("Task: %s (completed=%s)", task.title, task.completed)


def run_processor() -> None:
    """Uses symbols from other_library that get rewritten to qualified names."""
    # After fix: base.ProcessorConfig, base.BaseProcessor
    proc_config = ProcessorConfig(name="test", batch_size=50)
    processor = BaseProcessor(proc_config)

    try:
        result = processor.process({"key": "value"})
        logger.info("Processed: %s", result)
    except ProcessingError as exc:
        logger.error("Processing failed: %s", exc)
    except ValidationError as exc:
        logger.error("Validation failed: %s", exc)


def format_and_validate() -> None:
    """Uses other_library.utils symbols rewritten to qualified access."""
    # After fix: formatting.format_output, formatting.truncate_string
    output = format_output({"status": "ok", "count": 42})
    short = truncate_string(output, max_length=30)
    logger.info("Formatted: %s", short)

    # After fix: validation.validate_input, validation.is_valid_email
    if validate_input("test@example.com", str):
        valid = is_valid_email("test@example.com")
        logger.info("Email valid: %s", valid)


def check_types() -> None:
    """Uses stdlib imports to ensure they survive the fix."""
    items: typing.List[str] = ["a", "b", "c"]
    logger.info("Items: %s", items)
    logger.info("Requests version: %s", requests.__version__)


if __name__ == "__main__":
    process_users()
    run_processor()
    format_and_validate()
    check_types()
