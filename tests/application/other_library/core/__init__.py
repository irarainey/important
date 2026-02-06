"""Core functionality for other_library."""

from other_library.core.base import BaseProcessor, ProcessorConfig
from other_library.core.exceptions import ProcessingError, ValidationError

__all__ = ["BaseProcessor", "ProcessorConfig",
           "ProcessingError", "ValidationError"]
