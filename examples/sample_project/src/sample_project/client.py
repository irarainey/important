"""HTTP client for making API requests."""

# ⚠️ VIOLATION: Wrong import order (third-party before stdlib)
import requests

# ⚠️ VIOLATION: stdlib should come before third-party
import logging
from typing import Any, Optional

# ✅ CORRECT: local imports last
from .models import ApiResponse
from .utils import build_url, generate_cache_key


logger = logging.getLogger(__name__)


class HttpClient:
    """A simple HTTP client with caching support."""

    def __init__(
        self,
        base_url: str,
        timeout: int = 30,
        headers: Optional[dict[str, str]] = None,
    ):
        self.base_url = base_url
        self.timeout = timeout
        self.session = requests.Session()
        self._cache: dict[str, Any] = {}

        if headers:
            self.session.headers.update(headers)

    def get(self, path: str, use_cache: bool = True) -> ApiResponse:
        """Make a GET request to the API."""
        url = build_url(self.base_url, path)
        cache_key = generate_cache_key(url)

        if use_cache and cache_key in self._cache:
            logger.debug("Cache hit for %s", url)
            return self._cache[cache_key]

        logger.info("Fetching %s", url)
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()

        result = ApiResponse(
            status_code=response.status_code,
            url=str(response.url),
            content_type=response.headers.get("Content-Type"),
        )

        if use_cache:
            self._cache[cache_key] = result

        return result

    def get_json(self, path: str, use_cache: bool = True) -> dict[str, Any]:
        """Make a GET request and parse the JSON response."""
        url = build_url(self.base_url, path)
        cache_key = generate_cache_key(url)

        if use_cache and cache_key in self._cache:
            logger.debug("Cache hit for %s", url)
            return self._cache[cache_key]

        logger.info("Fetching JSON from %s", url)
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()

        data = response.json()

        if use_cache:
            self._cache[cache_key] = data

        return data

    def clear_cache(self) -> int:
        """Clear the cache and return the number of entries cleared."""
        count = len(self._cache)
        self._cache.clear()
        logger.info("Cleared %d cache entries", count)
        return count

    def close(self) -> None:
        """Close the session."""
        self.session.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
