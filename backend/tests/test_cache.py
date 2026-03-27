"""
Unit tests for the LRU cache service.

Tests validate:
  - Basic put/get operations
  - LRU eviction at capacity
  - TTL expiration
  - Cache statistics tracking
  - Thread safety under concurrent access
  - The contains() method
"""

import time
import threading

import pytest

from app.services.cache import LRUCache, CacheStats


class TestLRUBasicOperations:
    """Basic cache put/get tests."""

    def test_put_and_get(self, fresh_cache: LRUCache):
        """Stored value should be retrievable."""
        fresh_cache.put("route_1", {"distance": 5570.0})
        result = fresh_cache.get("route_1")
        assert result is not None
        assert result["distance"] == 5570.0

    def test_get_missing_key(self, fresh_cache: LRUCache):
        """Missing key should return None."""
        result = fresh_cache.get("nonexistent")
        assert result is None

    def test_update_existing_key(self, fresh_cache: LRUCache):
        """Updating an existing key should overwrite the value."""
        fresh_cache.put("route_1", {"distance": 5570.0})
        fresh_cache.put("route_1", {"distance": 5571.0})
        result = fresh_cache.get("route_1")
        assert result["distance"] == 5571.0

    def test_contains(self, fresh_cache: LRUCache):
        """contains() should report existence correctly."""
        assert fresh_cache.contains("route_1") is False
        fresh_cache.put("route_1", {"distance": 100.0})
        assert fresh_cache.contains("route_1") is True


class TestLRUEviction:
    """LRU eviction behavior tests."""

    def test_eviction_at_capacity(self, fresh_cache: LRUCache):
        """When cache is full (max_size=4), oldest entry should be evicted."""
        for i in range(5):
            fresh_cache.put(f"route_{i}", {"id": i})

        # route_0 should have been evicted
        assert fresh_cache.get("route_0") is None
        # route_1 through route_4 should still be present
        for i in range(1, 5):
            assert fresh_cache.get(f"route_{i}") is not None

    def test_lru_access_prevents_eviction(self, fresh_cache: LRUCache):
        """Accessing a key should move it to most-recently-used, saving it from eviction."""
        fresh_cache.put("A", 1)
        fresh_cache.put("B", 2)
        fresh_cache.put("C", 3)

        # Access A to make it most recent
        fresh_cache.get("A")

        # Add two more to trigger evictions
        fresh_cache.put("D", 4)
        fresh_cache.put("E", 5)

        # A was accessed recently, so B (then C) should be evicted first
        assert fresh_cache.get("A") is not None
        assert fresh_cache.get("B") is None  # evicted (was LRU after A was accessed)


class TestLRUExpiration:
    """TTL-based expiration tests."""

    def test_ttl_expiry(self):
        """Entries should expire after TTL."""
        cache = LRUCache(max_size=10, ttl_seconds=1)
        cache.put("route_1", {"distance": 100.0})

        # Should be available immediately
        assert cache.get("route_1") is not None

        # Wait for TTL to expire
        time.sleep(1.1)
        assert cache.get("route_1") is None

    def test_contains_respects_ttl(self):
        """contains() should return False for expired entries."""
        cache = LRUCache(max_size=10, ttl_seconds=1)
        cache.put("route_1", {"distance": 100.0})
        assert cache.contains("route_1") is True

        time.sleep(1.1)
        assert cache.contains("route_1") is False


class TestCacheStats:
    """Cache statistics tracking tests."""

    def test_initial_stats(self, fresh_cache: LRUCache):
        stats = fresh_cache.stats()
        assert stats.hits == 0
        assert stats.misses == 0
        assert stats.size == 0
        assert stats.evictions == 0

    def test_hit_miss_tracking(self, fresh_cache: LRUCache):
        fresh_cache.put("route_1", {"distance": 100.0})

        # One hit
        fresh_cache.get("route_1")
        # One miss
        fresh_cache.get("nonexistent")

        stats = fresh_cache.stats()
        assert stats.hits == 1
        assert stats.misses == 1
        assert stats.size == 1

    def test_hit_rate(self, fresh_cache: LRUCache):
        fresh_cache.put("A", 1)
        fresh_cache.get("A")  # hit
        fresh_cache.get("A")  # hit
        fresh_cache.get("B")  # miss

        stats = fresh_cache.stats()
        assert stats.hit_rate == pytest.approx(66.67, abs=0.1)

    def test_eviction_counter(self, fresh_cache: LRUCache):
        # max_size=4, adding 6 entries should cause 2 evictions
        for i in range(6):
            fresh_cache.put(f"route_{i}", i)

        stats = fresh_cache.stats()
        assert stats.evictions == 2
        assert stats.size == 4

    def test_clear_returns_count(self, fresh_cache: LRUCache):
        fresh_cache.put("A", 1)
        fresh_cache.put("B", 2)
        removed = fresh_cache.clear()
        assert removed == 2
        assert fresh_cache.stats().size == 0


class TestCacheRouteKey:
    """Route key generation tests."""

    def test_deterministic_key(self):
        key1 = LRUCache.make_route_key(51.5074, -0.1278, 40.7128, -74.0060, 100)
        key2 = LRUCache.make_route_key(51.5074, -0.1278, 40.7128, -74.0060, 100)
        assert key1 == key2

    def test_different_waypoints_different_key(self):
        key1 = LRUCache.make_route_key(51.5074, -0.1278, 40.7128, -74.0060, 50)
        key2 = LRUCache.make_route_key(51.5074, -0.1278, 40.7128, -74.0060, 100)
        assert key1 != key2


class TestThreadSafety:
    """Concurrent access tests."""

    def test_concurrent_writes(self):
        """Multiple threads writing simultaneously shouldn't corrupt the cache."""
        cache = LRUCache(max_size=1000, ttl_seconds=60)
        errors = []

        def writer(thread_id: int):
            try:
                for i in range(100):
                    cache.put(f"t{thread_id}_r{i}", {"id": thread_id, "val": i})
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(t,)) for t in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert cache.stats().size <= 1000

    def test_concurrent_read_write(self):
        """Concurrent reads and writes shouldn't raise exceptions."""
        cache = LRUCache(max_size=50, ttl_seconds=60)
        errors = []

        def read_write(thread_id: int):
            try:
                for i in range(50):
                    cache.put(f"key_{i}", i)
                    cache.get(f"key_{i}")
                    cache.contains(f"key_{i}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=read_write, args=(t,)) for t in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
