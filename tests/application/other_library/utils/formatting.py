"""Formatting utilities."""

import json
from typing import Any


def format_output(data: dict[str, Any], indent: int = 2) -> str:
    """Format a dictionary as a pretty JSON string."""
    return json.dumps(data, indent=indent, default=str)


def truncate_string(s: str, max_length: int = 50, suffix: str = "...") -> str:
    """Truncate a string to a maximum length."""
    if len(s) <= max_length:
        return s
    return s[: max_length - len(suffix)] + suffix
