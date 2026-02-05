"""Data validation and transformation utilities."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import re
import string
import unicodedata

# ⚠️ VIOLATION: Wrong order - these stdlib imports should come first
from typing import Any, Pattern, TypeVar
from collections.abc import Callable, Iterable, Mapping

# ⚠️ VIOLATION: Third-party mixed with stdlib ordering issues
from pydantic import BaseModel, Field, field_validator

# ⚠️ VIOLATION: More stdlib after third-party
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation


T = TypeVar("T")


# Common validation patterns
EMAIL_PATTERN: Pattern[str] = re.compile(
    r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)
URL_PATTERN: Pattern[str] = re.compile(
    r"^https?://[^\s/$.?#].[^\s]*$"
)
PHONE_PATTERN: Pattern[str] = re.compile(
    r"^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$"
)


class ValidationResult(BaseModel):
    """Result of a validation operation."""

    is_valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def add_error(self, message: str) -> None:
        """Add an error message."""
        self.is_valid = False
        self.errors.append(message)

    def add_warning(self, message: str) -> None:
        """Add a warning message."""
        self.warnings.append(message)


class EmailAddress(BaseModel):
    """Validated email address."""

    value: str

    @field_validator("value")
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Validate email format."""
        v = v.strip().lower()
        if not EMAIL_PATTERN.match(v):
            raise ValueError("Invalid email format")
        return v

    @property
    def domain(self) -> str:
        """Extract domain from email."""
        return self.value.split("@")[1]

    @property
    def local_part(self) -> str:
        """Extract local part from email."""
        return self.value.split("@")[0]


class PhoneNumber(BaseModel):
    """Validated phone number."""

    value: str
    country_code: str = "+1"

    @field_validator("value")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        """Validate and normalize phone number."""
        # Remove all non-digit characters
        digits = re.sub(r"\D", "", v)
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == "1":
            return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        else:
            raise ValueError("Invalid phone number format")
        return v


def validate_required(value: Any, field_name: str) -> ValidationResult:
    """Validate that a value is present."""
    result = ValidationResult(is_valid=True)

    if value is None:
        result.add_error(f"{field_name} is required")
    elif isinstance(value, str) and not value.strip():
        result.add_error(f"{field_name} cannot be empty")
    elif isinstance(value, (list, dict)) and len(value) == 0:
        result.add_error(f"{field_name} cannot be empty")

    return result


def validate_length(
    value: str,
    field_name: str,
    min_length: int | None = None,
    max_length: int | None = None,
) -> ValidationResult:
    """Validate string length."""
    result = ValidationResult(is_valid=True)

    if min_length is not None and len(value) < min_length:
        result.add_error(
            f"{field_name} must be at least {min_length} characters")

    if max_length is not None and len(value) > max_length:
        result.add_error(
            f"{field_name} must be at most {max_length} characters")

    return result


def validate_range(
    value: int | float | Decimal,
    field_name: str,
    min_value: int | float | Decimal | None = None,
    max_value: int | float | Decimal | None = None,
) -> ValidationResult:
    """Validate numeric range."""
    result = ValidationResult(is_valid=True)

    if min_value is not None and value < min_value:
        result.add_error(f"{field_name} must be at least {min_value}")

    if max_value is not None and value > max_value:
        result.add_error(f"{field_name} must be at most {max_value}")

    return result


def normalize_text(text: str) -> str:
    """Normalize unicode text."""
    # Normalize unicode
    text = unicodedata.normalize("NFKC", text)
    # Remove control characters
    text = "".join(
        c for c in text if not unicodedata.category(c).startswith("C"))
    # Normalize whitespace
    text = " ".join(text.split())
    return text.strip()


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    # Normalize and lowercase
    text = normalize_text(text).lower()
    # Replace spaces with hyphens
    text = text.replace(" ", "-")
    # Remove non-alphanumeric characters (except hyphens)
    text = re.sub(r"[^a-z0-9-]", "", text)
    # Remove consecutive hyphens
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def parse_date(value: str) -> date | None:
    """Parse a date string in various formats."""
    formats = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%B %d, %Y",
        "%b %d, %Y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue

    return None


def parse_decimal(value: str) -> Decimal | None:
    """Parse a decimal string."""
    try:
        # Remove currency symbols and commas
        cleaned = re.sub(r"[$€£,\s]", "", value)
        return Decimal(cleaned)
    except InvalidOperation:
        return None
