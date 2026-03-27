"""
Geodesic computation service — Vincenty's formulae on the WGS-84 ellipsoid.

Provides:
  - vincenty_inverse()        — distance + forward/reverse azimuths between two points
  - vincenty_direct()         — destination point given start, bearing, and distance
  - vincenty_distance_km()    — convenience wrapper returning only distance (float)
  - generate_geodesic_path()  — array of evenly-spaced intermediate waypoints
  - compute_flight_route()    — orchestrator returning distance, ETA, and path

References:
  - T. Vincenty, "Direct and Inverse Solutions of Geodesics on the Ellipsoid
    with Application of Nested Equations", Survey Review 23(176), 1975.
  - WGS-84 parameters: NGA.STND.0036_1.0.0_WGS84, 2014-07-08.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

__all__ = [
    "GeodesicResult",
    "Waypoint",
    "FlightRouteResult",
    "vincenty_inverse",
    "vincenty_direct",
    "vincenty_distance_km",
    "generate_geodesic_path",
    "compute_flight_route",
]

# ─── WGS-84 Ellipsoid Constants ──────────────────────────────────────
# These values define the reference ellipsoid used by GPS and modern mapping.
A = 6_378_137.0            # semi-major axis (m)
B = 6_356_752.314245       # semi-minor axis (m)
F = 1 / 298.257223563      # flattening  f = (a − b) / a

# Default aircraft cruise speed (Boeing 787-9)
DEFAULT_SPEED_KMH = 903.0

# ─── Spherical Fallback ─────────────────────────────────────────────
EARTH_RADIUS_KM = 6_371.0088  # IUGG mean radius


def _haversine_km(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
) -> float:
    """
    Haversine great-circle distance on a sphere.

    Used **only** as a fallback when Vincenty fails to converge
    (nearly-antipodal points where λ oscillates without settling).
    Accuracy: ~0.3 % worst-case vs. ellipsoidal; perfectly adequate
    as a safety net.
    """
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lng2 - lng1)

    a = (
        math.sin(Δφ / 2) ** 2
        + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── Data Structures ────────────────────────────────────────────────

@dataclass
class GeodesicResult:
    """Result of Vincenty's inverse formula."""
    distance_m: float
    distance_km: float
    initial_bearing_deg: float
    final_bearing_deg: float
    converged: bool = True


@dataclass
class Waypoint:
    """A single geodesic waypoint."""
    lat: float
    lng: float
    distance_from_start_km: float = 0.0


@dataclass
class FlightRouteResult:
    """Complete flight route computation result."""
    distance_km: float
    estimated_duration_hours: float
    aircraft_speed_kmh: float
    num_waypoints: int
    path_coordinates: List[Waypoint] = field(default_factory=list)
    formula: str = "vincenty"
    converged: bool = True


# ─── Vincenty Inverse Formula ────────────────────────────────────────
#
# Given two points (φ₁, λ₁) and (φ₂, λ₂) on the WGS-84 ellipsoid,
# iteratively solve for the geodesic distance s and forward/reverse
# azimuths α₁, α₂.
#
# The iteration refines λ (difference in longitude on the auxiliary sphere)
# until successive values agree to within `tol` radians — typically
# 1 × 10⁻¹² rad ≈ 6 µm on the Earth's surface, more than sufficient.
#
# Convergence failure can occur for nearly-antipodal points where the
# geodesic is not unique. In that case we fall back to Haversine with
# a logged warning.

def vincenty_inverse(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
    max_iterations: int = 200,
    tol: float = 1e-12,
) -> GeodesicResult:
    """
    Vincenty's inverse formula: compute the geodesic distance and azimuths
    between two points on the WGS-84 ellipsoid.

    Parameters
    ----------
    lat1, lng1 : float
        Origin in decimal degrees.
    lat2, lng2 : float
        Destination in decimal degrees.
    max_iterations : int
        Maximum λ iterations (200 is generous; typical convergence < 10).
    tol : float
        Convergence tolerance in radians (1e-12 ≈ 6 µm).

    Returns
    -------
    GeodesicResult
        Always returns a result.  If the iterative solver did not converge
        (nearly-antipodal case), ``converged`` is ``False`` and the distance
        is a Haversine approximation.
    """
    # ── Coincident-point short-circuit ────────────────────────────
    if lat1 == lat2 and lng1 == lng2:
        return GeodesicResult(
            distance_m=0.0, distance_km=0.0,
            initial_bearing_deg=0.0, final_bearing_deg=0.0,
            converged=True,
        )

    # ── Pole-to-pole special case ──────────────────────────────────
    # At exactly ±90° lat, cos(U)=0 which causes sin_σ→0 in the loop,
    # falsely signalling coincident points.  The meridional arc is simply
    # the quarter-meridian × 2 (north to south pole along that meridian).
    if abs(lat1) == 90.0 and abs(lat2) == 90.0 and lat1 != lat2:
        # Exact pole-to-pole distance along the WGS-84 ellipsoid
        # = semi-minor axis × π  (meridional arc from pole to pole)
        distance_m = math.pi * B   # ≈ 19,970,009 m
        return GeodesicResult(
            distance_m=distance_m,
            distance_km=distance_m / 1000.0,
            initial_bearing_deg=180.0 if lat1 > lat2 else 0.0,
            final_bearing_deg=180.0 if lat2 < lat1 else 0.0,
            converged=True,
        )

    # ── Reduce latitudes to the auxiliary sphere (parametric lat) ─
    φ1 = math.radians(lat1)
    φ2 = math.radians(lat2)
    L = math.radians(lng2 - lng1)          # difference in longitude

    U1 = math.atan((1 - F) * math.tan(φ1))  # reduced latitude 1
    U2 = math.atan((1 - F) * math.tan(φ2))  # reduced latitude 2
    sin_U1, cos_U1 = math.sin(U1), math.cos(U1)
    sin_U2, cos_U2 = math.sin(U2), math.cos(U2)

    # ── Iterative solution ───────────────────────────────────────
    λ = L                                    # initial approximation
    converged = True

    for iteration in range(max_iterations):
        sin_λ = math.sin(λ)
        cos_λ = math.cos(λ)

        # sin σ  (eq. 14)
        sin_σ = math.sqrt(
            (cos_U2 * sin_λ) ** 2
            + (cos_U1 * sin_U2 - sin_U1 * cos_U2 * cos_λ) ** 2
        )
        if sin_σ < 1e-15:
            # Points are effectively coincident
            return GeodesicResult(
                distance_m=0.0, distance_km=0.0,
                initial_bearing_deg=0.0, final_bearing_deg=0.0,
                converged=True,
            )

        # cos σ  (eq. 15)
        cos_σ = sin_U1 * sin_U2 + cos_U1 * cos_U2 * cos_λ

        # σ  (eq. 16)
        σ = math.atan2(sin_σ, cos_σ)

        # sin α  (eq. 17) — α is the azimuth of the geodesic at the equator
        sin_α = cos_U1 * cos_U2 * sin_λ / sin_σ
        cos2_α = 1.0 - sin_α ** 2

        # cos 2σₘ  (eq. 18) — σₘ is the arc from the equator to the midpoint
        if abs(cos2_α) < 1e-15:
            # Equatorial geodesic — both points on the equator
            cos_2σm = 0.0
        else:
            cos_2σm = cos_σ - 2.0 * sin_U1 * sin_U2 / cos2_α

        # C  (eq. 10)
        C = (F / 16.0) * cos2_α * (4.0 + F * (4.0 - 3.0 * cos2_α))

        # Update λ  (eq. 11)
        λ_prev = λ
        λ = L + (1.0 - C) * F * sin_α * (
            σ + C * sin_σ * (
                cos_2σm + C * cos_σ * (-1.0 + 2.0 * cos_2σm ** 2)
            )
        )

        # Check convergence
        if abs(λ - λ_prev) < tol:
            break
    else:
        # ── Failed to converge (near-antipodal) ─────────────────
        converged = False
        fallback_km = _haversine_km(lat1, lng1, lat2, lng2)
        logger.warning(
            "Vincenty inverse did not converge after %d iterations for "
            "(%.6f, %.6f) → (%.6f, %.6f); using Haversine fallback (%.2f km). "
            "This is expected for near-antipodal points.",
            max_iterations, lat1, lng1, lat2, lng2, fallback_km,
        )
        # Approximate bearing for near-antipodal: due south / north
        bearing = 180.0 if lat1 > lat2 else 0.0
        return GeodesicResult(
            distance_m=fallback_km * 1000.0,
            distance_km=fallback_km,
            initial_bearing_deg=bearing,
            final_bearing_deg=(bearing + 180.0) % 360.0,
            converged=False,
        )

    # ── Distance calculation (eq. 3, 4, 6, 7) ───────────────────
    u2 = cos2_α * (A ** 2 - B ** 2) / (B ** 2)

    # Series expansion coefficients (Vincenty 1975, eqs. 3 & 4)
    A_coeff = 1.0 + (u2 / 16384.0) * (
        4096.0 + u2 * (-768.0 + u2 * (320.0 - 175.0 * u2))
    )
    B_coeff = (u2 / 1024.0) * (
        256.0 + u2 * (-128.0 + u2 * (74.0 - 47.0 * u2))
    )

    # Δσ correction  (eq. 6)
    Δσ = B_coeff * sin_σ * (
        cos_2σm + (B_coeff / 4.0) * (
            cos_σ * (-1.0 + 2.0 * cos_2σm ** 2)
            - (B_coeff / 6.0) * cos_2σm
            * (-3.0 + 4.0 * sin_σ ** 2)
            * (-3.0 + 4.0 * cos_2σm ** 2)
        )
    )

    # Geodesic distance  (eq. 7)
    distance_m = B * A_coeff * (σ - Δσ)

    # ── Azimuths (forward and reverse bearings) ──────────────────
    fwd_az = math.atan2(
        cos_U2 * math.sin(λ),
        cos_U1 * sin_U2 - sin_U1 * cos_U2 * math.cos(λ),
    )
    rev_az = math.atan2(
        cos_U1 * math.sin(λ),
        -sin_U1 * cos_U2 + cos_U1 * sin_U2 * math.cos(λ),
    )

    return GeodesicResult(
        distance_m=distance_m,
        distance_km=distance_m / 1000.0,
        initial_bearing_deg=math.degrees(fwd_az) % 360,
        final_bearing_deg=math.degrees(rev_az) % 360,
        converged=converged,
    )


# ─── Vincenty Direct Formula ─────────────────────────────────────────
#
# Given a start point (φ₁, λ₁), an initial bearing α₁, and a geodesic
# distance s, compute the destination point (φ₂, λ₂) on the WGS-84 ellipsoid.
#
# This is used to generate evenly-spaced intermediate waypoints along
# the geodesic path — critical for smooth flight path rendering.

def vincenty_direct(
    lat1: float, lng1: float,
    bearing_deg: float,
    distance_m: float,
    max_iterations: int = 200,
    tol: float = 1e-12,
) -> Waypoint:
    """
    Vincenty's direct formula: given a start point, initial bearing, and
    distance, compute the destination point on the WGS-84 ellipsoid.

    Parameters
    ----------
    lat1, lng1 : float
        Start point in decimal degrees.
    bearing_deg : float
        Initial bearing in degrees (0 = north, 90 = east).
    distance_m : float
        Geodesic distance in metres.

    Returns
    -------
    Waypoint
        Destination point with distance_from_start_km populated.
    """
    if distance_m < 0.001:
        # Sub-millimetre distance — return the start point
        return Waypoint(lat=lat1, lng=lng1, distance_from_start_km=0.0)

    φ1 = math.radians(lat1)
    α1 = math.radians(bearing_deg)
    s = distance_m

    sin_α1 = math.sin(α1)
    cos_α1 = math.cos(α1)

    U1 = math.atan((1 - F) * math.tan(φ1))
    sin_U1, cos_U1 = math.sin(U1), math.cos(U1)

    # σ₁ = angular distance on the sphere from the equator to P1
    σ1 = math.atan2(sin_U1, cos_U1 * cos_α1)

    # α = azimuth of the geodesic at the equator
    sin_α = cos_U1 * sin_α1
    cos2_α = 1.0 - sin_α ** 2

    u2 = cos2_α * (A ** 2 - B ** 2) / (B ** 2)
    A_coeff = 1.0 + (u2 / 16384.0) * (
        4096.0 + u2 * (-768.0 + u2 * (320.0 - 175.0 * u2))
    )
    B_coeff = (u2 / 1024.0) * (
        256.0 + u2 * (-128.0 + u2 * (74.0 - 47.0 * u2))
    )

    # Initial approximation for σ
    σ = s / (B * A_coeff)

    for _ in range(max_iterations):
        cos_2σm = math.cos(2.0 * σ1 + σ)
        sin_σ = math.sin(σ)
        cos_σ = math.cos(σ)

        Δσ = B_coeff * sin_σ * (
            cos_2σm + (B_coeff / 4.0) * (
                cos_σ * (-1.0 + 2.0 * cos_2σm ** 2)
                - (B_coeff / 6.0) * cos_2σm
                * (-3.0 + 4.0 * sin_σ ** 2)
                * (-3.0 + 4.0 * cos_2σm ** 2)
            )
        )
        σ_prev = σ
        σ = s / (B * A_coeff) + Δσ

        if abs(σ - σ_prev) < tol:
            break

    # Compute destination coordinates
    sin_σ = math.sin(σ)
    cos_σ = math.cos(σ)
    cos_2σm = math.cos(2.0 * σ1 + σ)

    φ2 = math.atan2(
        sin_U1 * cos_σ + cos_U1 * sin_σ * cos_α1,
        (1.0 - F) * math.sqrt(
            sin_α ** 2
            + (sin_U1 * sin_σ - cos_U1 * cos_σ * cos_α1) ** 2
        ),
    )

    λ_delta = math.atan2(
        sin_σ * sin_α1,
        cos_U1 * cos_σ - sin_U1 * sin_σ * cos_α1,
    )

    C = (F / 16.0) * cos2_α * (4.0 + F * (4.0 - 3.0 * cos2_α))
    L = λ_delta - (1.0 - C) * F * sin_α * (
        σ + C * sin_σ * (
            cos_2σm + C * cos_σ * (-1.0 + 2.0 * cos_2σm ** 2)
        )
    )

    lng2 = math.radians(lng1) + L

    return Waypoint(
        lat=round(math.degrees(φ2), 8),
        lng=round(math.degrees(lng2), 8),
        distance_from_start_km=round(distance_m / 1000.0, 4),
    )


# ─── Convenience Wrapper ────────────────────────────────────────────

def vincenty_distance_km(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
) -> float:
    """
    Return only the geodesic distance in km between two points.

    Convenience wrapper around ``vincenty_inverse`` for callers that
    don't need azimuths.
    """
    result = vincenty_inverse(lat1, lng1, lat2, lng2)
    return result.distance_km


# ─── Geodesic Path Generation ───────────────────────────────────────

def generate_geodesic_path(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
    num_points: int = 100,
) -> tuple[List[Waypoint], GeodesicResult]:
    """
    Generate evenly-spaced intermediate waypoints along the geodesic
    from (lat1, lng1) to (lat2, lng2).

    Uses Vincenty's inverse to get total distance and bearing, then
    Vincenty's direct to step along the geodesic at equal intervals.

    Parameters
    ----------
    num_points : int
        Total number of waypoints including start and end.
        Minimum 2 (start + end only).

    Returns
    -------
    (waypoints, geodesic_result)
    """
    num_points = max(num_points, 2)

    geo = vincenty_inverse(lat1, lng1, lat2, lng2)

    # Short-circuit: coincident or very close points
    if geo.distance_m < 1.0:
        return [
            Waypoint(lat=lat1, lng=lng1, distance_from_start_km=0.0),
        ], geo

    waypoints: List[Waypoint] = []
    bearing = geo.initial_bearing_deg
    step_m = geo.distance_m / max(num_points - 1, 1)

    for i in range(num_points):
        if i == 0:
            # First waypoint: exact origin
            waypoints.append(
                Waypoint(lat=lat1, lng=lng1, distance_from_start_km=0.0)
            )
        elif i == num_points - 1:
            # Last waypoint: exact destination (avoids accumulated error)
            waypoints.append(
                Waypoint(
                    lat=lat2, lng=lng2,
                    distance_from_start_km=round(geo.distance_km, 4),
                )
            )
        else:
            # Intermediate waypoint via Vincenty direct
            dist_m = step_m * i
            wp = vincenty_direct(lat1, lng1, bearing, dist_m)
            wp.distance_from_start_km = round(dist_m / 1000.0, 4)
            waypoints.append(wp)

    return waypoints, geo


# ─── Flight Route Orchestrator ───────────────────────────────────────

def compute_flight_route(
    origin_lat: float, origin_lng: float,
    dest_lat: float, dest_lng: float,
    aircraft_speed_kmh: float = DEFAULT_SPEED_KMH,
    num_waypoints: int = 100,
) -> FlightRouteResult:
    """
    Compute a complete flight route: Vincenty distance, intermediate
    geodesic waypoints, and estimated flight duration.
    """
    waypoints, geo = generate_geodesic_path(
        origin_lat, origin_lng,
        dest_lat, dest_lng,
        num_points=num_waypoints,
    )

    if aircraft_speed_kmh > 0:
        eta_hours = geo.distance_km / aircraft_speed_kmh
    else:
        eta_hours = 0.0

    return FlightRouteResult(
        distance_km=round(geo.distance_km, 4),
        estimated_duration_hours=round(eta_hours, 4),
        aircraft_speed_kmh=aircraft_speed_kmh,
        num_waypoints=len(waypoints),
        path_coordinates=waypoints,
        formula="vincenty",
        converged=geo.converged,
    )
