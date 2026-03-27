"""
Thread-safe LRU cache with TTL expiration.

Pure Python implementation using OrderedDict — no external dependencies.
Designed for caching geodesic computation results.

Configuration is read from ``app.config.settings`` at module load time
so cache size and TTL can be controlled via environment variables.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

__all__ = [
    "CacheStats",
    "LRUCache",
    "route_cache",
]


@dataclass
class CacheStats:
    """Cache performance statistics."""
    hits: int = 0
    misses: int = 0
    size: int = 0
    max_size: int = 0
    evictions: int = 0

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return (self.hits / total * 100) if total > 0 else 0.0


@dataclass
class _CacheEntry:
    """Internal cache entry with timestamp."""
    value: Any
    created_at: float = field(default_factory=time.time)


class LRUCache:
    """
    Thread-safe Least Recently Used cache with configurable max size
    and TTL (time-to-live) expiration.

    Usage::

        cache = LRUCache(max_size=256, ttl_seconds=3600)
        cache.put("key", {"distance": 5570.0, ...})
        result = cache.get("key")  # returns value or None
    """

    def __init__(self, max_size: int = 256, ttl_seconds: int = 3600):
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._store: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        logger.info(
            "LRU cache initialised (max_size=%d, ttl=%ds)",
            max_size, ttl_seconds,
        )

    @staticmethod
    def make_route_key(
        lat1: float, lng1: float,
        lat2: float, lng2: float,
        num_waypoints: int,
    ) -> str:
        """Generate a deterministic cache key for a flight route computation."""
        return f"{lat1:.6f},{lng1:.6f}→{lat2:.6f},{lng2:.6f}|{num_waypoints}"

    def get(self, key: str) -> Optional[Any]:
        """
        Retrieve a cached value. Returns None on miss or expiry.
        Moves the entry to the end (most recently used) on hit.
        """
        with self._lock:
            if key not in self._store:
                self._misses += 1
                return None

            entry = self._store[key]

            # Check TTL expiration
            if time.time() - entry.created_at > self._ttl:
                del self._store[key]
                self._misses += 1
                return None

            # Move to end (most recently used)
            self._store.move_to_end(key)
            self._hits += 1
            return entry.value

    def put(self, key: str, value: Any) -> None:
        """
        Store a value in the cache. Evicts the least recently used
        entry if the cache is full.
        """
        with self._lock:
            if key in self._store:
                # Update existing entry
                self._store[key] = _CacheEntry(value=value)
                self._store.move_to_end(key)
                return

            # Evict LRU entry if at capacity
            if len(self._store) >= self._max_size:
                evicted_key, _ = self._store.popitem(last=False)
                self._evictions += 1
                logger.debug("Cache eviction: %s", evicted_key)

            self._store[key] = _CacheEntry(value=value)

    def contains(self, key: str) -> bool:
        """Check whether a key exists and hasn't expired (without affecting LRU order)."""
        with self._lock:
            if key not in self._store:
                return False
            entry = self._store[key]
            if time.time() - entry.created_at > self._ttl:
                del self._store[key]
                return False
            return True

    def clear(self) -> int:
        """Clear all entries. Returns the number of entries removed."""
        with self._lock:
            count = len(self._store)
            self._store.clear()
            logger.info("Cache cleared (%d entries removed)", count)
            return count

    def stats(self) -> CacheStats:
        """Return current cache statistics."""
        with self._lock:
            return CacheStats(
                hits=self._hits,
                misses=self._misses,
                size=len(self._store),
                max_size=self._max_size,
                evictions=self._evictions,
            )


# ─── Module-level singleton ─────────────────────────────────────────
# Reads configuration from app settings. Import at module level so the
# singleton is created once during application startup.

def _create_route_cache() -> LRUCache:
    """Create the application-wide route cache from config."""
    try:
        from app.config import settings
        return LRUCache(
            max_size=settings.CACHE_MAX_SIZE,
            ttl_seconds=settings.CACHE_TTL_SECONDS,
        )
    except Exception:
        # Fallback for test environments where config may not load
        return LRUCache(max_size=256, ttl_seconds=3600)


route_cache = _create_route_cache()
