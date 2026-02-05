"""Configuration management for the sample project."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import os
import sys
import json

# ⚠️ VIOLATION: Wrong alphabetical order - 'pathlib' should come before 'tempfile'
import tempfile
import pathlib

# ⚠️ VIOLATION: Multiple 'from' imports that could be combined, but also wrong order
from dataclasses import dataclass, field
from collections import defaultdict, OrderedDict

# ⚠️ VIOLATION: Third-party before remaining stdlib
from pydantic import BaseModel

# ⚠️ VIOLATION: More stdlib after third-party
from typing import Any, Dict, List, Optional
from enum import Enum, auto


class Environment(Enum):
    """Application environment."""
    DEVELOPMENT = auto()
    STAGING = auto()
    PRODUCTION = auto()


@dataclass
class DatabaseConfig:
    """Database connection configuration."""
    host: str = "localhost"
    port: int = 5432
    database: str = "app"
    username: str = "user"
    password: str = field(default="", repr=False)

    @property
    def connection_string(self) -> str:
        """Build a connection string."""
        return f"postgresql://{self.username}:{self.password}@{self.host}:{self.port}/{self.database}"


@dataclass
class CacheConfig:
    """Cache configuration."""
    enabled: bool = True
    ttl_seconds: int = 300
    max_size: int = 1000
    backend: str = "memory"


class AppConfig(BaseModel):
    """Main application configuration."""

    app_name: str = "sample-project"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # API settings
    api_base_url: str = "https://api.github.com"
    api_timeout: int = 30
    api_retries: int = 3

    # Feature flags
    features: Dict[str, bool] = {}

    @classmethod
    def from_env(cls) -> "AppConfig":
        """Load configuration from environment variables."""
        return cls(
            app_name=os.getenv("APP_NAME", "sample-project"),
            environment=os.getenv("ENVIRONMENT", "development"),
            debug=os.getenv("DEBUG", "false").lower() == "true",
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            api_base_url=os.getenv("API_BASE_URL", "https://api.github.com"),
            api_timeout=int(os.getenv("API_TIMEOUT", "30")),
            api_retries=int(os.getenv("API_RETRIES", "3")),
        )

    @classmethod
    def from_file(cls, path: pathlib.Path) -> "AppConfig":
        """Load configuration from a JSON file."""
        with open(path) as f:
            data = json.load(f)
        return cls.model_validate(data)

    def to_file(self, path: pathlib.Path) -> None:
        """Save configuration to a JSON file."""
        with open(path, "w") as f:
            json.dump(self.model_dump(), f, indent=2)


def get_config_path() -> pathlib.Path:
    """Get the default configuration file path."""
    # Check multiple locations
    locations = [
        pathlib.Path.cwd() / "config.json",
        pathlib.Path.home() / ".config" / "sample-project" / "config.json",
        pathlib.Path(tempfile.gettempdir()) / "sample-project-config.json",
    ]

    for loc in locations:
        if loc.exists():
            return loc

    return locations[0]


def merge_configs(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two configuration dictionaries."""
    result = defaultdict(dict, base)

    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_configs(result[key], value)
        else:
            result[key] = value

    return dict(result)
