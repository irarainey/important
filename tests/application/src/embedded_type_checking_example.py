"""
Example demonstrating an embedded TYPE_CHECKING block between regular imports.

This is a challenging layout: the `if TYPE_CHECKING:` block is sandwiched
between regular (runtime) imports.  The sorter must preserve the TC block
and its header when it replaces the surrounding import range.

Run "Important: Fix Imports in This File" to see the extension in action.
"""

# fmt: off

from __future__ import annotations

from typing import TYPE_CHECKING

from other_library.core import base

if TYPE_CHECKING:
    from other_library.core.base import (
        BaseProcessor,
        ProcessorConfig,
    )
    from other_library.core.exceptions import ProcessingError

from models import sample_models
from helpers.helpers import format_output

# fmt: on


def create_processor(config: ProcessorConfig) -> BaseProcessor[str]:
    """Create a processor using types from the TYPE_CHECKING block."""
    processor_config = base.ProcessorConfig(name="text", batch_size=10)
    return base.BaseProcessor(config=processor_config)


def run_pipeline(data: list[str]) -> None:
    """Run a processing pipeline using runtime imports."""
    processor = create_processor(None)  # type: ignore[arg-type]
    results = processor.process_batch(data)
    formatted = format_output(str(results))
    print(formatted)


def build_user() -> sample_models.User:
    """Build a user from the sample models module."""
    return sample_models.create_user("Alice", "alice@example.com")


def handle_error(err: ProcessingError) -> str:
    """Format a processing error (type hint from TYPE_CHECKING block)."""
    return f"Error: {err}"


def summarise_results(data: list[str]) -> str:
    """Summarise pipeline results with a misplaced import."""
    # ⚠️ VIOLATION: Misplaced import — should be at top of file
    import textwrap

    combined = "\n".join(data)
    return textwrap.dedent(combined)
