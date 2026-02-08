"""
Example demonstrating multiline import wrapping based on line length.

When sorted/fixed imports exceed the configured line length (88 chars from
pyproject.toml), the formatter wraps them into parenthesised multi-line form
with trailing commas — matching Ruff's default formatting style.

This file tests:
- Two ``from typing`` imports merged into one long line that wraps
- ``collections.abc`` with many names that wraps (113 chars)
- ``typing_extensions`` barely over the limit (89 chars — edge case)
- TYPE_CHECKING imports with indented wrapping (effective limit 84)
- TYPE_CHECKING imports short enough to stay single-line
- Ordering violations that trigger the sorter

Run "Important: Fix Imports in This File" to see the extension in action.
"""

# fmt: off

from __future__ import annotations

# ⚠️ VIOLATION: Wrong category order — third-party before stdlib
from typing_extensions import Literal, Protocol, TypedDict, runtime_checkable, TypeAlias

# These two 'from typing' imports will be MERGED into a single long line
# that exceeds 88 chars, triggering multiline wrapping
from typing import TYPE_CHECKING
from typing import Any, Callable, ClassVar, Dict, Generic, List, Optional, TypeVar, Union

# ⚠️ VIOLATION: collections.abc should come before typing alphabetically
# This line is 113 chars — definitely wraps
from collections.abc import AsyncIterator, Generator, Hashable, Iterator, Mapping, MutableMapping, Sequence, Sized

if TYPE_CHECKING:
    # Long lines: 101 and 116 chars — both exceed effective limit (84) and wrap
    from services.api.handlers.user_handler import UserListResponse, UserRequest, UserResponse, UserRole
    from services.api.handlers.project_handler import ProjectMetadata, ProjectRequest, ProjectResponse, ProjectSummary
    # Shorter lines: 69 and 76 chars — both fit on one line (stay single-line)
    from other_library.core.base import BaseProcessor, ProcessorConfig
    from other_library.core.exceptions import ProcessingError, ValidationError

from other_library.utils import formatting
import logging

# fmt: on

# ---------------------------------------------------------------------------
# Use every imported name to prevent unused-import removal
# ---------------------------------------------------------------------------

T = TypeVar("T")
StoreName: TypeAlias = str

logger = logging.getLogger(__name__)


# -- typing_extensions usage --


class Repository(Protocol):
    """A repository protocol (Protocol)."""

    def get(self, id: int) -> Optional[Any]: ...
    def list_all(self) -> List[Any]: ...


@runtime_checkable
class Configurable(Protocol):
    """A configurable protocol (runtime_checkable + ClassVar)."""

    config: ClassVar[Dict[str, Any]]


class ItemStore(TypedDict):
    """A typed dictionary (TypedDict + Literal)."""

    name: StoreName
    items: List[str]
    active: Literal["yes", "no"]


# -- typing + collections.abc usage --


class Pipeline(Generic[T]):
    """Generic pipeline using Sequence, Iterator, Generator, Callable."""

    def __init__(self, steps: Sequence[Callable[[T], T]]) -> None:
        self.steps = steps

    def run(self, items: Iterator[T]) -> Generator[T, None, None]:
        for item in items:
            result = item
            for step in self.steps:
                result = step(result)
            yield result


def process_mapping(data: Mapping[str, MutableMapping[str, int]]) -> bool:
    """Check mapping types (Mapping + MutableMapping)."""
    return isinstance(data, Mapping)


def check_hashable(value: Hashable) -> int:
    """Hash a hashable value (Hashable)."""
    return hash(value)


def measure(container: Sized) -> int:
    """Measure a sized container (Sized)."""
    return len(container)


async def read_stream(source: AsyncIterator[str]) -> list[str]:
    """Read from an async iterator (AsyncIterator)."""
    results: list[str] = []
    async for item in source:
        results.append(item)
    return results


def get_union(value: Union[str, int]) -> str:
    """Convert a union value (Union)."""
    return str(value)


# -- TYPE_CHECKING type hint usage --


def create_request(name: str) -> UserRequest:
    """UserRequest from TC block."""
    ...


def list_responses() -> UserListResponse:
    """UserListResponse from TC block."""
    ...


def format_response(resp: UserResponse, role: UserRole) -> str:
    """UserResponse + UserRole from TC block."""
    return f"{role}: {resp}"


def create_project(name: str) -> ProjectRequest:
    """ProjectRequest from TC block."""
    ...


def get_project(id: int) -> ProjectResponse:
    """ProjectResponse from TC block."""
    ...


def get_metadata() -> ProjectMetadata:
    """ProjectMetadata from TC block."""
    ...


def get_summary() -> ProjectSummary:
    """ProjectSummary from TC block."""
    ...


def build_processor() -> BaseProcessor[str]:
    """BaseProcessor from TC block."""
    ...


def default_config() -> ProcessorConfig:
    """ProcessorConfig from TC block."""
    ...


def handle_error(err: ProcessingError) -> str:
    """ProcessingError from TC block."""
    return str(err)


def check_validation(err: ValidationError) -> bool:
    """ValidationError from TC block."""
    return False


# -- Runtime import usage --


def format_data(data: dict[str, Any]) -> str:
    """Use the first-party formatting module."""
    return formatting.format_output(data)


def main() -> None:
    """Main function exercising various imports."""
    logger.info("Starting multiline wrapping example")

    pipe = Pipeline[int](steps=[lambda x: x * 2])
    results = list(pipe.run(iter([1, 2, 3])))
    logger.info("Pipeline results: %s", results)

    store: ItemStore = {"name": "test", "items": ["a", "b"], "active": "yes"}
    logger.info("Store: %s", store)

    logger.info("Formatted: %s", format_data({"key": "value"}))


if __name__ == "__main__":
    main()
