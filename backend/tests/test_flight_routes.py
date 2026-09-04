"""
API integration tests for the flight-route endpoint.

Tests validate:
  - Successful route computation (200 OK)
  - Cache hit on repeated request
  - Coincident-point short-circuit
  - Invalid coordinate handling (422)
  - Cache stats endpoint
  - Cache clear endpoint
  - Response schema completeness
"""

import pytest


class TestFlightRouteEndpoint:
    """Tests for POST /api/flight-route."""

    def test_successful_route(self, client):
        """Valid route should return 200 with all expected fields."""
        response = client.post("/api/flight-route", json={
            "origin": {"lat": 51.5074, "lng": -0.1278},
            "destination": {"lat": 40.7128, "lng": -74.0060},
            "aircraft_speed_kmh": 903.0,
            "num_waypoints": 25,
        })
        assert response.status_code == 200
        data = response.json()

        # Check all required fields exist
        assert "distance_km" in data
        assert "estimated_duration_hours" in data
        assert "aircraft_speed_kmh" in data
        assert "num_waypoints" in data
        assert "path_coordinates" in data
        assert "formula" in data
        assert "computation_time_ms" in data
        assert "cache_hit" in data
        assert "max_range_km" in data
        assert "within_range" in data

        # Validate values
        assert 5550 < data["distance_km"] < 5600
        assert data["num_waypoints"] == 25
        assert data["formula"] == "vincenty"
        assert data["cache_hit"] is False
        assert data["within_range"] is True  # within Boeing 787-9 range

    def test_waypoint_structure(self, client):
        """Each waypoint should have lat, lng, and distance_from_start_km."""
        response = client.post("/api/flight-route", json={
            "origin": {"lat": 51.5074, "lng": -0.1278},
            "destination": {"lat": 48.8566, "lng": 2.3522},
            "num_waypoints": 5,
        })
        data = response.json()
        assert len(data["path_coordinates"]) == 5

        for wp in data["path_coordinates"]:
            assert "lat" in wp
            assert "lng" in wp
            assert "distance_from_start_km" in wp

        # First waypoint should be at origin
        assert data["path_coordinates"][0]["distance_from_start_km"] == 0.0

    def test_cache_hit_on_repeat(self, client):
        """Second identical request should return cache_hit=True."""
        payload = {
            "origin": {"lat": 35.6762, "lng": 139.6503},
            "destination": {"lat": -33.8688, "lng": 151.2093},
            "num_waypoints": 10,
        }
        # First request — cache miss
        r1 = client.post("/api/flight-route", json=payload)
        assert r1.status_code == 200
        assert r1.json()["cache_hit"] is False

        # Second request — cache hit
        r2 = client.post("/api/flight-route", json=payload)
        assert r2.status_code == 200
        assert r2.json()["cache_hit"] is True

        # Distance should be identical
        assert r1.json()["distance_km"] == r2.json()["distance_km"]

    def test_coincident_points(self, client):
        """Same origin and destination should return 0 distance."""
        response = client.post("/api/flight-route", json={
            "origin": {"lat": 48.8566, "lng": 2.3522},
            "destination": {"lat": 48.8566, "lng": 2.3522},
        })
        assert response.status_code == 200
        data = response.json()
        assert data["distance_km"] == 0.0
        assert data["estimated_duration_hours"] == 0.0
        assert data["within_range"] is True

    def test_custom_speed_changes_eta(self, client):
        """Different speeds should produce different ETAs for same route."""
        payload_fast = {
            "origin": {"lat": 51.5074, "lng": -0.1278},
            "destination": {"lat": 40.7128, "lng": -74.0060},
            "aircraft_speed_kmh": 900.0,
            "num_waypoints": 5,
        }
        payload_slow = {
            **payload_fast,
            "aircraft_speed_kmh": 450.0,
        }

        r_fast = client.post("/api/flight-route", json=payload_fast)
        r_slow = client.post("/api/flight-route", json=payload_slow)

        assert r_fast.status_code == 200
        assert r_slow.status_code == 200

        eta_fast = r_fast.json()["estimated_duration_hours"]
        eta_slow = r_slow.json()["estimated_duration_hours"]
        assert eta_slow > eta_fast

    def test_default_waypoints(self, client):
        """Omitting num_waypoints should default to 100."""
        response = client.post("/api/flight-route", json={
            "origin": {"lat": 51.5074, "lng": -0.1278},
            "destination": {"lat": 48.8566, "lng": 2.3522},
        })
        assert response.status_code == 200
        assert response.json()["num_waypoints"] == 100

    def test_computation_error_is_sanitized(self, client, monkeypatch):
        """Unexpected computation details must not be returned to clients."""
        def fail_compute(**_kwargs):
            raise RuntimeError("private model or filesystem detail")

        monkeypatch.setattr("app.flight_routes.compute_flight_route", fail_compute)
        response = client.post("/api/flight-route", json={
            "origin": {"lat": 11.0, "lng": 12.0},
            "destination": {"lat": 21.0, "lng": 22.0},
            "num_waypoints": 8,
        })

        assert response.status_code == 500
        assert response.json()["detail"] == {
            "error_code": "COMPUTATION_ERROR",
            "message": "Geodesic computation failed.",
        }
        assert "private model or filesystem detail" not in response.text

    def test_cache_speed_adaptation_does_not_mutate_shared_entry(self, client):
        """Changing ETA for one speed must not rewrite the cached route payload."""
        payload = {
            "origin": {"lat": 12.0, "lng": 13.0},
            "destination": {"lat": 23.0, "lng": 24.0},
            "num_waypoints": 8,
            "aircraft_speed_kmh": 900.0,
        }
        first = client.post("/api/flight-route", json=payload)
        assert first.status_code == 200

        slower = {**payload, "aircraft_speed_kmh": 450.0}
        second = client.post("/api/flight-route", json=slower)
        assert second.status_code == 200
        assert second.json()["aircraft_speed_kmh"] == 450.0

        from app.flight_routes import route_cache
        key = route_cache.make_route_key(12.0, 13.0, 23.0, 24.0, 8)
        cached = route_cache.get(key)
        assert cached["aircraft_speed_kmh"] == 900.0

    def test_path_request_resolution_and_constraint_counts_are_bounded(self, client):
        base = {
            "start": {"lat": 0.0, "lng": 0.0},
            "end": {"lat": 10.0, "lng": 10.0},
        }
        too_fine = client.post("/api/path/calculate", json={**base, "lat_step": 0.5})
        too_many_constraints = client.post(
            "/api/path/calculate",
            json={**base, "constraints": [
                {"lat": 0.0, "lng": 0.0, "radius": 0.1}
                for _ in range(101)
            ]},
        )

        assert too_fine.status_code == 422
        assert too_many_constraints.status_code == 422

    def test_path_computation_error_is_sanitized(self, client, monkeypatch):
        def fail_grid(*_args, **_kwargs):
            raise RuntimeError("private grid detail")

        monkeypatch.setattr("app.routes.create_grid", fail_grid)
        response = client.post("/api/path/calculate", json={
            "start": {"lat": 1.0, "lng": 2.0},
            "end": {"lat": 11.0, "lng": 12.0},
        })

        assert response.status_code == 500
        assert response.json()["detail"] == {
            "error_code": "COMPUTATION_ERROR",
            "message": "Path calculation failed.",
        }
        assert "private grid detail" not in response.text


class TestCacheEndpoints:
    """Tests for cache stats and clear endpoints."""

    def test_cache_stats(self, client):
        """GET /api/flight-route/cache-stats should return stats."""
        response = client.get("/api/flight-route/cache-stats")
        assert response.status_code == 200
        data = response.json()

        assert "hits" in data
        assert "misses" in data
        assert "hit_rate_percent" in data
        assert "size" in data
        assert "max_size" in data
        assert "evictions" in data

    def test_cache_clear(self, client):
        """DELETE /api/flight-route/cache should clear cache and return count."""
        # Add an entry first
        client.post("/api/flight-route", json={
            "origin": {"lat": 0.0, "lng": 0.0},
            "destination": {"lat": 10.0, "lng": 10.0},
            "num_waypoints": 5,
        })

        response = client.delete("/api/flight-route/cache")
        assert response.status_code == 200
        data = response.json()
        assert "cleared" in data
        assert "message" in data


class TestHealthEndpoints:
    """Tests for health-check endpoints."""

    def test_root(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert response.json()["status"] == "operational"

    def test_health(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
