"""Utility functions for the sample project."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import json
import hashlib
import base64

# ✅ CORRECT: stdlib import
from urllib.parse import urljoin, urlparse


def generate_cache_key(url: str) -> str:
    """Generate a cache key from a URL."""
    normalized = urlparse(url)._replace(fragment="").geturl()
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def encode_basic_auth(username: str, password: str) -> str:
    """Encode credentials for HTTP Basic Authentication."""
    credentials = f"{username}:{password}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Basic {encoded}"


def pretty_json(data: dict) -> str:
    """Format a dictionary as pretty-printed JSON."""
    return json.dumps(data, indent=2, default=str)


def truncate_string(text: str, max_length: int = 100) -> str:
    """Truncate a string to a maximum length with ellipsis."""
    if len(text) <= max_length:
        return text
    return text[: max_length - 3] + "..."


def build_url(base: str, path: str) -> str:
    """Safely join a base URL with a path."""
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))
