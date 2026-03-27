"""Pytest configuration and shared fixtures for the backend test suite."""

import sys
from pathlib import Path

import pytest

# Ensure the backend root is on sys.path so `app.*` imports work
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app                    # noqa: E402
from app.services.cache import LRUCache     # noqa: E402


@pytest.fixture()
def client():
    """FastAPI TestClient scoped to each test."""
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fresh_cache():
    """A fresh LRU cache instance for isolated cache tests."""
    return LRUCache(max_size=4, ttl_seconds=2)
