"""Tests for validators module."""

# ⚠️ VIOLATION: Wrong alphabetical order - 'decimal' should come before 're'
import re
import decimal
from datetime import date

# ✅ CORRECT: third-party
import pytest

# ✅ CORRECT: local imports
from sample_project.validators import (
    EmailAddress,
    PhoneNumber,
    ValidationResult,
    normalize_text,
    parse_date,
    parse_decimal,
    slugify,
    validate_length,
    validate_range,
    validate_required,
)


class TestEmailAddress:
    """Tests for EmailAddress validation."""

    def test_valid_email(self) -> None:
        """Test valid email addresses."""
        email = EmailAddress(value="user@example.com")
        assert email.value == "user@example.com"

    def test_email_normalized(self) -> None:
        """Test that emails are normalized."""
        email = EmailAddress(value="  USER@EXAMPLE.COM  ")
        assert email.value == "user@example.com"

    def test_email_domain(self) -> None:
        """Test domain extraction."""
        email = EmailAddress(value="user@example.com")
        assert email.domain == "example.com"

    def test_email_local_part(self) -> None:
        """Test local part extraction."""
        email = EmailAddress(value="user@example.com")
        assert email.local_part == "user"

    def test_invalid_email_raises(self) -> None:
        """Test that invalid emails raise ValueError."""
        with pytest.raises(ValueError):
            EmailAddress(value="not-an-email")


class TestPhoneNumber:
    """Tests for PhoneNumber validation."""

    def test_valid_10_digit(self) -> None:
        """Test valid 10-digit phone number."""
        phone = PhoneNumber(value="5551234567")
        assert phone.value == "(555) 123-4567"

    def test_valid_with_formatting(self) -> None:
        """Test phone with existing formatting."""
        phone = PhoneNumber(value="(555) 123-4567")
        assert phone.value == "(555) 123-4567"

    def test_valid_11_digit(self) -> None:
        """Test valid 11-digit phone number with country code."""
        phone = PhoneNumber(value="15551234567")
        assert phone.value == "(555) 123-4567"


class TestValidationResult:
    """Tests for ValidationResult."""

    def test_initial_valid(self) -> None:
        """Test that result starts valid."""
        result = ValidationResult(is_valid=True)
        assert result.is_valid is True
        assert result.errors == []

    def test_add_error_invalidates(self) -> None:
        """Test that adding error invalidates result."""
        result = ValidationResult(is_valid=True)
        result.add_error("Something went wrong")

        assert result.is_valid is False
        assert "Something went wrong" in result.errors

    def test_add_warning_keeps_valid(self) -> None:
        """Test that warnings don't invalidate."""
        result = ValidationResult(is_valid=True)
        result.add_warning("This is a warning")

        assert result.is_valid is True
        assert "This is a warning" in result.warnings


class TestValidateRequired:
    """Tests for validate_required function."""

    def test_none_is_invalid(self) -> None:
        """Test that None is invalid."""
        result = validate_required(None, "field")
        assert result.is_valid is False

    def test_empty_string_is_invalid(self) -> None:
        """Test that empty string is invalid."""
        result = validate_required("   ", "field")
        assert result.is_valid is False

    def test_empty_list_is_invalid(self) -> None:
        """Test that empty list is invalid."""
        result = validate_required([], "field")
        assert result.is_valid is False

    def test_value_is_valid(self) -> None:
        """Test that non-empty value is valid."""
        result = validate_required("hello", "field")
        assert result.is_valid is True


class TestNormalizeText:
    """Tests for normalize_text function."""

    def test_strips_whitespace(self) -> None:
        """Test whitespace stripping."""
        assert normalize_text("  hello  ") == "hello"

    def test_normalizes_internal_whitespace(self) -> None:
        """Test internal whitespace normalization."""
        assert normalize_text("hello    world") == "hello world"

    def test_handles_unicode(self) -> None:
        """Test unicode normalization."""
        # Full-width characters should be normalized
        result = normalize_text("ｈｅｌｌｏ")
        assert result == "hello"


class TestSlugify:
    """Tests for slugify function."""

    def test_simple_text(self) -> None:
        """Test simple text slugification."""
        assert slugify("Hello World") == "hello-world"

    def test_removes_special_chars(self) -> None:
        """Test special character removal."""
        assert slugify("Hello! World?") == "hello-world"

    def test_handles_unicode(self) -> None:
        """Test unicode handling."""
        assert slugify("Café") == "caf"


class TestParseDate:
    """Tests for parse_date function."""

    def test_iso_format(self) -> None:
        """Test ISO date format."""
        result = parse_date("2024-01-15")
        assert result == date(2024, 1, 15)

    def test_us_format(self) -> None:
        """Test US date format."""
        result = parse_date("01/15/2024")
        assert result == date(2024, 1, 15)

    def test_invalid_returns_none(self) -> None:
        """Test that invalid date returns None."""
        result = parse_date("not-a-date")
        assert result is None


class TestParseDecimal:
    """Tests for parse_decimal function."""

    def test_simple_number(self) -> None:
        """Test simple decimal parsing."""
        result = parse_decimal("123.45")
        assert result == decimal.Decimal("123.45")

    def test_with_currency(self) -> None:
        """Test parsing with currency symbol."""
        result = parse_decimal("$1,234.56")
        assert result == decimal.Decimal("1234.56")

    def test_invalid_returns_none(self) -> None:
        """Test that invalid decimal returns None."""
        result = parse_decimal("not-a-number")
        assert result is None
