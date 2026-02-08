"""
Example demonstrating TYPE_CHECKING block support.

Google style guide rules still apply inside `if TYPE_CHECKING:` blocks,
with one key exemption: symbol imports (Rule 4) are allowed because these
imports exist purely for type annotations.

This file has two sections:
  1. Correct usage (no warnings expected)
  2. Intentional violations inside the TYPE_CHECKING block
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from models import sample_models

if TYPE_CHECKING:
    # ✅ CORRECT: Symbol imports are allowed inside TYPE_CHECKING for typing
    from models.sample_models import Config, User
    from services.api.handlers.user_handler import (
        UserRequest,
        UserResponse,
    )

logger = logging.getLogger(__name__)


def get_user_display(user: User) -> str:
    """Format a user for display (type hint only, no runtime import needed)."""
    return f"{user.name} <{user.email}>"


def process_request(request: UserRequest) -> UserResponse:
    """Process a user request (type hints from TYPE_CHECKING block)."""
    logger.info("Processing request: %s", type(request).__name__)
    # In real code this would do actual processing
    return None  # type: ignore[return-value]


def load_config(config: Config) -> None:
    """Load configuration (type hint from TYPE_CHECKING block)."""
    logger.info("Loading config: debug=%s", config.debug)


def create_model() -> sample_models.Project:
    """Create a project using module-level access."""
    return sample_models.Project(id=1, name="test", owner_id=1)
