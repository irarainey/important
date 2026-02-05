"""Data models using Pydantic."""

# ✅ CORRECT: stdlib imports first, alphabetically ordered
from datetime import datetime
from typing import Optional

# ✅ CORRECT: third-party imports second
from pydantic import BaseModel, Field


class ApiResponse(BaseModel):
    """Generic API response wrapper."""

    status_code: int
    url: str
    content_type: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)


class User(BaseModel):
    """GitHub user model."""

    login: str
    id: int
    avatar_url: Optional[str] = None
    html_url: str
    name: Optional[str] = None
    company: Optional[str] = None
    blog: Optional[str] = None
    location: Optional[str] = None
    email: Optional[str] = None
    bio: Optional[str] = None
    public_repos: int = 0
    followers: int = 0
    following: int = 0
    created_at: Optional[datetime] = None


class Repository(BaseModel):
    """GitHub repository model."""

    id: int
    name: str
    full_name: str
    description: Optional[str] = None
    html_url: str
    stargazers_count: int = 0
    forks_count: int = 0
    language: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
