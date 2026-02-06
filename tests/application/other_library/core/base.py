"""Base classes for data processing."""

from __future__ import annotations

import dataclasses
from typing import Any, Generic, TypeVar

T = TypeVar("T")


@dataclasses.dataclass
class ProcessorConfig:
    """Configuration for processors."""

    name: str
    batch_size: int = 100
    timeout_seconds: float = 30.0
    retry_count: int = 3
    verbose: bool = False


class BaseProcessor(Generic[T]):
    """Base class for all processors."""

    def __init__(self, config: ProcessorConfig) -> None:
        self.config = config
        self._results: list[T] = []

    def process(self, item: Any) -> T:
        """Process a single item. Override in subclasses."""
        raise NotImplementedError

    def process_batch(self, items: list[Any]) -> list[T]:
        """Process a batch of items."""
        results = []
        for item in items[:self.config.batch_size]:
            result = self.process(item)
            results.append(result)
        self._results.extend(results)
        return results

    @property
    def results(self) -> list[T]:
        """Get all processed results."""
        return self._results.copy()

    def reset(self) -> None:
        """Clear all results."""
        self._results.clear()
