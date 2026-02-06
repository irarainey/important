"""Project API handler with request/response models."""

from __future__ import annotations

import dataclasses
from typing import Any
from datetime import datetime


@dataclasses.dataclass
class ProjectMetadata:
    """Metadata for a project."""
    created_at: datetime
    updated_at: datetime
    tags: list[str] = dataclasses.field(default_factory=list)
    custom_fields: dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class ProjectRequest:
    """Request payload for project operations."""
    name: str
    description: str
    owner_id: int
    team_ids: list[int] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class ProjectResponse:
    """Response payload for project operations."""
    id: int
    name: str
    description: str
    owner_id: int
    metadata: ProjectMetadata
    success: bool = True


@dataclasses.dataclass
class ProjectSummary:
    """Summarized project information."""
    id: int
    name: str
    task_count: int
    completed_count: int

    @property
    def completion_rate(self) -> float:
        """Calculate completion rate as percentage."""
        if self.task_count == 0:
            return 0.0
        return (self.completed_count / self.task_count) * 100
