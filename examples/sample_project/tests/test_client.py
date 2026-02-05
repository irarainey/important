"""Tests for the HTTP client module."""

# ✅ CORRECT: stdlib first
from unittest.mock import MagicMock, patch

# ✅ CORRECT: third-party second
import pytest

# ✅ CORRECT: local imports last (but uses absolute import path)
from sample_project.client import HttpClient
from sample_project.models import ApiResponse


class TestHttpClient:
    """Tests for HttpClient class."""

    def test_init_default_values(self) -> None:
        """Test client initialization with default values."""
        client = HttpClient("https://api.example.com")

        assert client.base_url == "https://api.example.com"
        assert client.timeout == 30
        assert client._cache == {}

    def test_init_custom_values(self) -> None:
        """Test client initialization with custom values."""
        headers = {"Authorization": "Bearer token123"}
        client = HttpClient(
            "https://api.example.com",
            timeout=60,
            headers=headers,
        )

        assert client.timeout == 60
        assert "Authorization" in client.session.headers

    @patch("sample_project.client.requests.Session")
    def test_get_success(self, mock_session_class: MagicMock) -> None:
        """Test successful GET request."""
        mock_session = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.url = "https://api.example.com/data"
        mock_response.headers = {"Content-Type": "application/json"}
        mock_session.get.return_value = mock_response
        mock_session_class.return_value = mock_session

        client = HttpClient("https://api.example.com")
        result = client.get("/data", use_cache=False)

        assert isinstance(result, ApiResponse)
        assert result.status_code == 200
        mock_session.get.assert_called_once()

    def test_cache_hit(self) -> None:
        """Test that cache returns stored values."""
        client = HttpClient("https://api.example.com")
        cached_response = ApiResponse(
            status_code=200,
            url="https://api.example.com/cached",
            content_type="application/json",
        )

        # Manually populate cache
        cache_key = "test_key"
        client._cache[cache_key] = cached_response

        # Verify cache has content
        assert len(client._cache) == 1

    def test_clear_cache(self) -> None:
        """Test cache clearing."""
        client = HttpClient("https://api.example.com")
        client._cache["key1"] = "value1"
        client._cache["key2"] = "value2"

        count = client.clear_cache()

        assert count == 2
        assert len(client._cache) == 0

    def test_context_manager(self) -> None:
        """Test client as context manager."""
        with HttpClient("https://api.example.com") as client:
            assert client.base_url == "https://api.example.com"

        # Session should be closed after exiting context
        # (would raise error if used after close in real scenario)


class TestApiResponse:
    """Tests for ApiResponse model."""

    def test_create_minimal(self) -> None:
        """Test creating response with minimal fields."""
        response = ApiResponse(
            status_code=200,
            url="https://example.com",
        )

        assert response.status_code == 200
        assert response.url == "https://example.com"
        assert response.content_type is None

    def test_create_full(self) -> None:
        """Test creating response with all fields."""
        response = ApiResponse(
            status_code=201,
            url="https://api.example.com/resource",
            content_type="application/json",
        )

        assert response.status_code == 201
        assert response.content_type == "application/json"
        assert response.timestamp is not None
