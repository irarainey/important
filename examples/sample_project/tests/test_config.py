"""Tests for configuration module."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import os
import tempfile
import json

# ⚠️ VIOLATION: Wrong alphabetical order - 'pathlib' before 'unittest'
import unittest
import pathlib

# ✅ CORRECT: third-party
import pytest

# ⚠️ VIOLATION: Relative-style but using package name (these are fine, but mixed with violations above)
from sample_project.config import (
    AppConfig,
    DatabaseConfig,
    CacheConfig,
    Environment,
    get_config_path,
    merge_configs,
)


class TestDatabaseConfig:
    """Tests for DatabaseConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = DatabaseConfig()

        assert config.host == "localhost"
        assert config.port == 5432
        assert config.database == "app"
        assert config.username == "user"
        assert config.password == ""

    def test_connection_string(self) -> None:
        """Test connection string generation."""
        config = DatabaseConfig(
            host="db.example.com",
            port=5433,
            database="mydb",
            username="admin",
            password="secret",
        )

        expected = "postgresql://admin:secret@db.example.com:5433/mydb"
        assert config.connection_string == expected

    def test_password_not_in_repr(self) -> None:
        """Test that password is not exposed in repr."""
        config = DatabaseConfig(password="supersecret")
        repr_str = repr(config)

        assert "supersecret" not in repr_str


class TestAppConfig:
    """Tests for AppConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = AppConfig()

        assert config.app_name == "sample-project"
        assert config.environment == "development"
        assert config.debug is False
        assert config.api_timeout == 30

    def test_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test loading config from environment."""
        monkeypatch.setenv("APP_NAME", "test-app")
        monkeypatch.setenv("DEBUG", "true")
        monkeypatch.setenv("API_TIMEOUT", "60")

        config = AppConfig.from_env()

        assert config.app_name == "test-app"
        assert config.debug is True
        assert config.api_timeout == 60

    def test_to_and_from_file(self, tmp_path: pathlib.Path) -> None:
        """Test saving and loading config from file."""
        config = AppConfig(
            app_name="file-test",
            debug=True,
            api_retries=5,
        )

        config_path = tmp_path / "config.json"
        config.to_file(config_path)

        loaded = AppConfig.from_file(config_path)

        assert loaded.app_name == "file-test"
        assert loaded.debug is True
        assert loaded.api_retries == 5


class TestMergeConfigs:
    """Tests for merge_configs function."""

    def test_simple_merge(self) -> None:
        """Test merging flat dictionaries."""
        base = {"a": 1, "b": 2}
        override = {"b": 3, "c": 4}

        result = merge_configs(base, override)

        assert result == {"a": 1, "b": 3, "c": 4}

    def test_nested_merge(self) -> None:
        """Test merging nested dictionaries."""
        base = {"outer": {"a": 1, "b": 2}}
        override = {"outer": {"b": 3, "c": 4}}

        result = merge_configs(base, override)

        assert result["outer"] == {"a": 1, "b": 3, "c": 4}

    def test_override_with_non_dict(self) -> None:
        """Test that non-dict values override completely."""
        base = {"key": {"nested": "value"}}
        override = {"key": "simple"}

        result = merge_configs(base, override)

        assert result["key"] == "simple"
