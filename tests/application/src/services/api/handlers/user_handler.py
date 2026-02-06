"""User API handler with various requests and responses."""

from __future__ import annotations

import dataclasses
from typing import Optional
from enum import Enum


class UserRole(Enum):
    """User roles in the system."""
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"


@dataclasses.dataclass
class UserRequest:
    """Request payload for user operations."""
    name: str
    email: str
    role: UserRole = UserRole.USER
    metadata: Optional[dict] = None


@dataclasses.dataclass
class UserResponse:
    """Response payload for user operations."""
    id: int
    name: str
    email: str
    role: UserRole
    success: bool = True
    message: str = ""


@dataclasses.dataclass
class UserListResponse:
    """Response payload for listing users."""
    users: list[UserResponse]
    total: int
    page: int = 1
    page_size: int = 10
