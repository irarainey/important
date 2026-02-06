"""Custom exceptions for other_library."""


class LibraryError(Exception):
    """Base exception for all library errors."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class ProcessingError(LibraryError):
    """Raised when processing fails."""

    def __init__(self, message: str, item: object = None) -> None:
        super().__init__(message, code="PROCESSING_ERROR")
        self.item = item


class ValidationError(LibraryError):
    """Raised when validation fails."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message, code="VALIDATION_ERROR")
        self.field = field
