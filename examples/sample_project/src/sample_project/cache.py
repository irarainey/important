"""Data caching and storage utilities."""

# ⚠️ VIOLATION: Multiple imports on one line (no-multiple-imports)
# Fix: Split into separate import statements
import time
import threading
import weakref

# ⚠️ VIOLATION: Wrong alphabetical order - 'abc' should come before 'hashlib'
import hashlib
import abc
from typing import Any, Generic, TypeVar
from collections import OrderedDict
from dataclasses import dataclass, field

# ⚠️ VIOLATION: Relative import (no-relative-imports)
# Fix: Remove the leading dot
from .errors import AppError


K = TypeVar("K")
V = TypeVar("V")


@dataclass
class CacheEntry(Generic[V]):
    """A single cache entry with metadata."""

    value: V
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)
    access_count: int = 0
    ttl_seconds: float | None = None

    @property
    def is_expired(self) -> bool:
        """Check if the entry has expired."""
        if self.ttl_seconds is None:
            return False
        return time.time() - self.created_at > self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        """Get the age of the entry in seconds."""
        return time.time() - self.created_at

    def touch(self) -> None:
        """Update access metadata."""
        self.last_accessed = time.time()
        self.access_count += 1


class CacheBackend(abc.ABC, Generic[K, V]):
    """Abstract base class for cache backends."""

    @abc.abstractmethod
    def get(self, key: K) -> V | None:
        """Get a value from the cache."""
        ...

    @abc.abstractmethod
    def set(self, key: K, value: V, ttl: float | None = None) -> None:
        """Set a value in the cache."""
        ...

    @abc.abstractmethod
    def delete(self, key: K) -> bool:
        """Delete a value from the cache."""
        ...

    @abc.abstractmethod
    def clear(self) -> int:
        """Clear all values from the cache."""
        ...

    @abc.abstractmethod
    def size(self) -> int:
        """Get the number of items in the cache."""
        ...


class MemoryCache(CacheBackend[K, V]):
    """In-memory cache implementation with LRU eviction."""

    def __init__(self, max_size: int = 1000, default_ttl: float | None = None):
        self._data: OrderedDict[K, CacheEntry[V]] = OrderedDict()
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0

    def get(self, key: K) -> V | None:
        """Get a value from the cache."""
        with self._lock:
            entry = self._data.get(key)

            if entry is None:
                self._misses += 1
                return None

            if entry.is_expired:
                del self._data[key]
                self._misses += 1
                return None

            # Move to end (most recently used)
            self._data.move_to_end(key)
            entry.touch()
            self._hits += 1

            return entry.value

    def set(self, key: K, value: V, ttl: float | None = None) -> None:
        """Set a value in the cache."""
        with self._lock:
            # Evict oldest entries if at capacity
            while len(self._data) >= self._max_size:
                self._data.popitem(last=False)

            self._data[key] = CacheEntry(
                value=value,
                ttl_seconds=ttl or self._default_ttl,
            )

    def delete(self, key: K) -> bool:
        """Delete a value from the cache."""
        with self._lock:
            if key in self._data:
                del self._data[key]
                return True
            return False

    def clear(self) -> int:
        """Clear all values from the cache."""
        with self._lock:
            count = len(self._data)
            self._data.clear()
            return count

    def size(self) -> int:
        """Get the number of items in the cache."""
        return len(self._data)

    @property
    def hit_rate(self) -> float:
        """Calculate cache hit rate."""
        total = self._hits + self._misses
        if total == 0:
            return 0.0
        return self._hits / total

    def get_stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        return {
            "size": self.size(),
            "max_size": self._max_size,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": self.hit_rate,
        }


class WeakCache(CacheBackend[K, V]):
    """Cache using weak references (values can be garbage collected)."""

    def __init__(self) -> None:
        self._data: weakref.WeakValueDictionary[K,
                                                V] = weakref.WeakValueDictionary()

    def get(self, key: K) -> V | None:
        """Get a value from the cache."""
        return self._data.get(key)

    def set(self, key: K, value: V, ttl: float | None = None) -> None:
        """Set a value in the cache (ttl is ignored for weak cache)."""
        self._data[key] = value

    def delete(self, key: K) -> bool:
        """Delete a value from the cache."""
        try:
            del self._data[key]
            return True
        except KeyError:
            return False

    def clear(self) -> int:
        """Clear all values from the cache."""
        count = len(self._data)
        self._data.clear()
        return count

    def size(self) -> int:
        """Get the number of items in the cache."""
        return len(self._data)


def cached(
    ttl: float | None = None,
    key_func: Any | None = None,
) -> Any:
    """Decorator for caching function results."""
    cache: dict[str, CacheEntry[Any]] = {}

    def decorator(func: Any) -> Any:
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Generate cache key
            if key_func:
                key = key_func(*args, **kwargs)
            else:
                key = hashlib.sha256(
                    f"{args}:{sorted(kwargs.items())}".encode()
                ).hexdigest()

            # Check cache
            entry = cache.get(key)
            if entry and not entry.is_expired:
                entry.touch()
                return entry.value

            # Call function and cache result
            result = func(*args, **kwargs)
            cache[key] = CacheEntry(value=result, ttl_seconds=ttl)

            return result

        wrapper.cache = cache  # type: ignore
        wrapper.cache_clear = cache.clear  # type: ignore

        return wrapper

    return decorator
