"""
Unit tests for the Vincenty geodesic computation service.

Tests validate:
  - Vincenty inverse distance against known geodesic values
  - Coincident-point handling
  - Near-antipodal fallback
  - Vincenty direct destination calculation
  - Geodesic path generation
  - Flight route orchestrator
"""

import math
import pytest

from app.services.geodesic import (
    vincenty_inverse,
    vincenty_direct,
    vincenty_distance_km,
    generate_geodesic_path,
    compute_flight_route,
    GeodesicResult,
    Waypoint,
)


# ─── Known Reference Distances ──────────────────────────────────────
# Sources: geographiclib / GeodSolve / WGS-84 validated values

class TestVincentyInverse:
    """Tests for vincenty_inverse()."""

    def test_london_to_new_york(self):
        """London Heathrow → JFK: ~5554 km (Vincenty WGS-84 validated)."""
        result = vincenty_inverse(51.4775, -0.4614, 40.6413, -73.7781)
        assert result is not None
        assert result.converged is True
        # Allow ±20 km tolerance for coordinate precision
        assert 5534 < result.distance_km < 5574, (
            f"LHR→JFK distance {result.distance_km:.1f} km out of expected range"
        )

    def test_sydney_to_tokyo(self):
        """Sydney → Tokyo: ~7792 km (Vincenty WGS-84 validated)."""
        result = vincenty_inverse(-33.8688, 151.2093, 35.6762, 139.6503)
        assert result.converged is True
        assert 7772 < result.distance_km < 7812

    def test_equatorial_short_distance(self):
        """Quito → Nairobi: ~12,833 km (Vincenty WGS-84 validated)."""
        result = vincenty_inverse(-0.1807, -78.4678, -1.2921, 36.8219)
        assert result.converged is True
        assert 12810 < result.distance_km < 12860

    def test_coincident_points(self):
        """Same origin and destination should return 0 distance."""
        result = vincenty_inverse(48.8566, 2.3522, 48.8566, 2.3522)
        assert result.distance_m == 0.0
        assert result.distance_km == 0.0
        assert result.converged is True

    def test_very_close_points(self):
        """Points < 1 m apart should return near-zero distance."""
        result = vincenty_inverse(51.5074, -0.1278, 51.5074, -0.12781)
        assert result.distance_m < 1.0

    def test_near_antipodal_points(self):
        """
        Near-antipodal points may fail to converge.
        The function should still return a valid distance via fallback.
        """
        # Exactly opposite points on the globe
        result = vincenty_inverse(0.0, 0.0, 0.0, 179.99)
        assert result is not None
        assert result.distance_km > 19000  # should be ~20015 km (half circumference)

    def test_north_pole_to_south_pole(self):
        """Pole-to-pole: ~19,970 km (meridional arc π × WGS-84 semi-minor axis)."""
        result = vincenty_inverse(90.0, 0.0, -90.0, 0.0)
        assert result is not None
        assert result.converged is True
        # WGS-84 meridional arc pole-to-pole = pi * B ≈ 19,970 km
        assert 19950 < result.distance_km < 19990

    def test_bearing_north(self):
        """Moving due north from equator should give bearing ≈ 0°."""
        result = vincenty_inverse(0.0, 0.0, 10.0, 0.0)
        assert result.converged is True
        assert result.initial_bearing_deg < 1.0 or result.initial_bearing_deg > 359.0

    def test_bearing_east(self):
        """Moving due east along equator should give bearing ≈ 90°."""
        result = vincenty_inverse(0.0, 0.0, 0.0, 10.0)
        assert result.converged is True
        assert 89.0 < result.initial_bearing_deg < 91.0

    def test_antimeridian_shortest_path(self):
        """Longitude wrapping must choose the one-degree equatorial arc."""
        result = vincenty_inverse(0.0, 179.5, 0.0, -179.5)

        assert result.converged is True
        assert 111.0 < result.distance_km < 111.7

    def test_inverse_is_symmetric(self):
        """Reversing endpoints must preserve the ellipsoidal distance."""
        forward = vincenty_distance_km(51.5074, -0.1278, 40.7128, -74.0060)
        reverse = vincenty_distance_km(40.7128, -74.0060, 51.5074, -0.1278)

        assert forward == pytest.approx(reverse, abs=1e-9)


class TestVincentyDirect:
    """Tests for vincenty_direct()."""

    def test_known_destination(self):
        """
        From London heading north 100 km, should end near
        (52.4°, -0.13°) — roughly north of London.
        """
        wp = vincenty_direct(51.5074, -0.1278, 0.0, 100_000)
        assert wp is not None
        assert 52.3 < wp.lat < 52.5
        assert abs(wp.lng - (-0.1278)) < 0.1

    def test_zero_distance(self):
        """Zero distance should return the start point."""
        wp = vincenty_direct(48.8566, 2.3522, 45.0, 0.0)
        assert wp.lat == 48.8566
        assert wp.lng == 2.3522

    def test_round_trip_consistency(self):
        """
        Inverse then direct should get us back close to the destination.
        This validates consistency between the two formulas.
        """
        lat1, lng1, lat2, lng2 = 51.5074, -0.1278, 40.7128, -74.0060
        geo = vincenty_inverse(lat1, lng1, lat2, lng2)

        # Use direct to walk to destination
        wp = vincenty_direct(lat1, lng1, geo.initial_bearing_deg, geo.distance_m)

        # Should arrive very close to the original destination
        assert abs(wp.lat - lat2) < 0.01, f"Lat mismatch: {wp.lat} vs {lat2}"
        assert abs(wp.lng - lng2) < 0.01, f"Lng mismatch: {wp.lng} vs {lng2}"

    def test_direct_normalizes_antimeridian_longitude(self):
        """Generated longitudes stay in the API's canonical range."""
        wp = vincenty_direct(0.0, 179.0, 90.0, 300_000)

        assert -180.0 <= wp.lng < 180.0


class TestVincentyDistanceKm:
    """Tests for the convenience wrapper."""

    def test_returns_float(self):
        dist = vincenty_distance_km(51.5074, -0.1278, 40.7128, -74.0060)
        assert isinstance(dist, float)
        assert 5550 < dist < 5600

    def test_zero_for_coincident(self):
        dist = vincenty_distance_km(0.0, 0.0, 0.0, 0.0)
        assert dist == 0.0


class TestGeodesicPathGeneration:
    """Tests for generate_geodesic_path()."""

    def test_waypoint_count(self):
        """Should return exactly the requested number of waypoints."""
        waypoints, _ = generate_geodesic_path(
            51.5074, -0.1278, 40.7128, -74.0060, num_points=50
        )
        assert len(waypoints) == 50

    def test_minimum_waypoints(self):
        """Requesting fewer than 2 waypoints should still return at least 2."""
        waypoints, _ = generate_geodesic_path(
            51.5074, -0.1278, 40.7128, -74.0060, num_points=1
        )
        assert len(waypoints) >= 2

    def test_endpoints_match(self):
        """First and last waypoints should match origin/destination."""
        waypoints, _ = generate_geodesic_path(
            51.5074, -0.1278, 40.7128, -74.0060, num_points=10
        )
        assert waypoints[0].lat == 51.5074
        assert waypoints[0].lng == -0.1278
        assert waypoints[-1].lat == 40.7128
        assert waypoints[-1].lng == -74.0060

    def test_distances_monotonically_increase(self):
        """distance_from_start_km should increase along the path."""
        waypoints, _ = generate_geodesic_path(
            51.5074, -0.1278, 40.7128, -74.0060, num_points=20
        )
        for i in range(1, len(waypoints)):
            assert waypoints[i].distance_from_start_km >= waypoints[i - 1].distance_from_start_km

    def test_coincident_points_path(self):
        """Coincident points should return a single-waypoint path."""
        waypoints, geo = generate_geodesic_path(10.0, 20.0, 10.0, 20.0)
        assert len(waypoints) == 1
        assert geo.distance_km < 1.0


class TestComputeFlightRoute:
    """Tests for the flight route orchestrator."""

    def test_basic_route(self):
        result = compute_flight_route(
            origin_lat=51.5074, origin_lng=-0.1278,
            dest_lat=40.7128, dest_lng=-74.0060,
            aircraft_speed_kmh=903.0,
            num_waypoints=25,
        )
        assert result.distance_km > 5500
        assert result.estimated_duration_hours > 0
        assert result.num_waypoints == 25
        assert result.formula == "vincenty"

    def test_custom_speed(self):
        """Different speed should change ETA but not distance."""
        r1 = compute_flight_route(51.5074, -0.1278, 40.7128, -74.0060, 903.0, 10)
        r2 = compute_flight_route(51.5074, -0.1278, 40.7128, -74.0060, 450.0, 10)

        assert abs(r1.distance_km - r2.distance_km) < 0.01
        assert r2.estimated_duration_hours > r1.estimated_duration_hours
