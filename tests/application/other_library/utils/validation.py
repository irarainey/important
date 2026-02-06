"""Validation utilities."""

import re
from typing import Any


def validate_input(value: Any, expected_type: type, allow_none: bool = False) -> bool:
    """Validate that a value is of the expected type."""
    if value is None:
        return allow_none
    return isinstance(value, expected_type)


def is_valid_email(email: str) -> bool:
    """Check if a string is a valid email address."""
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email))
