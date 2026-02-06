"""
Helper functions with mixed import issues.
"""

# fmt: off

# ⚠️ VIOLATION: Multiple imports + unused
import string, os
import re

# ✅ CORRECT: Single imports in right order
import typing

# fmt: on


def format_output(text: str) -> str:
    """Format text for display."""
    # Uses re and string
    cleaned = re.sub(r'\s+', ' ', text)
    return string.capwords(cleaned)


def validate_input(data: typing.Any) -> bool:
    """Validate input data."""
    return data is not None and len(data) > 0
