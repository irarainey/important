"""
Data models - this file has CORRECT imports for comparison.

Notice: No warnings should appear on this file.
"""

import dataclasses
import datetime
import typing


@dataclasses.dataclass
class User:
    """Represents a user."""

    id: int
    name: str
    email: str
    created_at: datetime.datetime = dataclasses.field(
        default_factory=datetime.datetime.now
    )


@dataclasses.dataclass
class Config:
    """Application configuration."""

    debug: bool = False
    log_level: str = "INFO"
    allowed_hosts: typing.List[str] = dataclasses.field(default_factory=list)


def create_user(name: str, email: str) -> User:
    """Create a new user."""
    return User(id=1, name=name, email=email)
