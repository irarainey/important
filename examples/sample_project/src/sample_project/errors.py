"""Logging and error handling utilities."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import logging
import sys
import traceback

# ⚠️ VIOLATION: Wrong alphabetical order within stdlib
from functools import wraps
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Callable, Generator, TypeVar

# ⚠️ VIOLATION: Relative imports (no-relative-imports)
# Fix: Remove the leading dot
from .config import AppConfig, Environment


T = TypeVar("T")


class AppError(Exception):
    """Base exception for application errors."""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN_ERROR",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}
        self.timestamp = datetime.now()

    def to_dict(self) -> dict[str, Any]:
        """Convert error to a dictionary."""
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
            "timestamp": self.timestamp.isoformat(),
        }


class ValidationError(AppError):
    """Raised when validation fails."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(
            message=message,
            code="VALIDATION_ERROR",
            details={"field": field} if field else {},
        )


class NotFoundError(AppError):
    """Raised when a resource is not found."""

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"{resource} not found: {identifier}",
            code="NOT_FOUND",
            details={"resource": resource, "identifier": identifier},
        )


class RateLimitError(AppError):
    """Raised when rate limit is exceeded."""

    def __init__(self, retry_after: int | None = None):
        super().__init__(
            message="Rate limit exceeded",
            code="RATE_LIMIT_EXCEEDED",
            details={"retry_after": retry_after} if retry_after else {},
        )


def setup_logging(config: AppConfig) -> logging.Logger:
    """Configure logging for the application."""
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    if config.debug:
        log_format = "%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"

    logging.basicConfig(
        level=getattr(logging, config.log_level),
        format=log_format,
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    logger = logging.getLogger(config.app_name)
    logger.info("Logging configured: level=%s, debug=%s",
                config.log_level, config.debug)

    return logger


def log_exceptions(logger: logging.Logger) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator to log exceptions."""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            try:
                return func(*args, **kwargs)
            except AppError:
                # Re-raise application errors without logging
                raise
            except Exception as e:
                logger.error(
                    "Unhandled exception in %s: %s\n%s",
                    func.__name__,
                    str(e),
                    traceback.format_exc(),
                )
                raise
        return wrapper
    return decorator


@contextmanager
def error_context(operation: str, logger: logging.Logger | None = None) -> Generator[None, None, None]:
    """Context manager for error handling."""
    try:
        yield
    except AppError:
        raise
    except Exception as e:
        if logger:
            logger.error("Error during %s: %s", operation, str(e))
        raise AppError(
            message=f"Error during {operation}: {str(e)}",
            code="OPERATION_FAILED",
            details={"operation": operation, "original_error": str(e)},
        ) from e
