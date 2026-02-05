"""Tests for utility functions."""

# ⚠️ VIOLATION: Not alphabetically ordered within stdlib group
import hashlib
import base64

# ✅ CORRECT: third-party
import pytest

# ✅ CORRECT: local imports
from sample_project.utils import (
    build_url,
    encode_basic_auth,
    generate_cache_key,
    pretty_json,
    truncate_string,
)


class TestGenerateCacheKey:
    """Tests for generate_cache_key function."""

    def test_consistent_keys(self) -> None:
        """Same URL should produce same cache key."""
        url = "https://api.example.com/data"
        key1 = generate_cache_key(url)
        key2 = generate_cache_key(url)

        assert key1 == key2

    def test_different_urls_different_keys(self) -> None:
        """Different URLs should produce different keys."""
        key1 = generate_cache_key("https://api.example.com/data1")
        key2 = generate_cache_key("https://api.example.com/data2")

        assert key1 != key2

    def test_ignores_fragment(self) -> None:
        """URL fragments should be ignored."""
        key1 = generate_cache_key("https://example.com/page")
        key2 = generate_cache_key("https://example.com/page#section")

        assert key1 == key2

    def test_key_length(self) -> None:
        """Cache key should be 16 characters."""
        key = generate_cache_key("https://example.com")
        assert len(key) == 16


class TestEncodeBasicAuth:
    """Tests for encode_basic_auth function."""

    def test_encode_credentials(self) -> None:
        """Test encoding username and password."""
        result = encode_basic_auth("user", "pass")

        assert result.startswith("Basic ")
        # Decode to verify
        encoded_part = result.split(" ")[1]
        decoded = base64.b64decode(encoded_part).decode()
        assert decoded == "user:pass"

    def test_special_characters(self) -> None:
        """Test encoding with special characters."""
        result = encode_basic_auth("user@example.com", "p@ss:word!")

        assert result.startswith("Basic ")


class TestPrettyJson:
    """Tests for pretty_json function."""

    def test_simple_dict(self) -> None:
        """Test formatting a simple dictionary."""
        data = {"name": "test", "value": 42}
        result = pretty_json(data)

        assert '"name": "test"' in result
        assert '"value": 42' in result
        assert "\n" in result  # Should be multi-line

    def test_nested_dict(self) -> None:
        """Test formatting a nested dictionary."""
        data = {"outer": {"inner": "value"}}
        result = pretty_json(data)

        assert "outer" in result
        assert "inner" in result


class TestTruncateString:
    """Tests for truncate_string function."""

    def test_short_string_unchanged(self) -> None:
        """Short strings should not be modified."""
        text = "Hello"
        result = truncate_string(text, 100)

        assert result == text

    def test_long_string_truncated(self) -> None:
        """Long strings should be truncated with ellipsis."""
        text = "A" * 200
        result = truncate_string(text, 100)

        assert len(result) == 100
        assert result.endswith("...")

    def test_exact_length_unchanged(self) -> None:
        """String exactly at max length should not be modified."""
        text = "A" * 100
        result = truncate_string(text, 100)

        assert result == text


class TestBuildUrl:
    """Tests for build_url function."""

    def test_simple_join(self) -> None:
        """Test joining base URL and path."""
        result = build_url("https://api.example.com", "/users")
        assert result == "https://api.example.com/users"

    def test_handles_trailing_slash(self) -> None:
        """Test handling of trailing slashes."""
        result = build_url("https://api.example.com/", "/users")
        assert result == "https://api.example.com/users"

    def test_handles_no_leading_slash(self) -> None:
        """Test handling of missing leading slash."""
        result = build_url("https://api.example.com", "users")
        assert result == "https://api.example.com/users"
