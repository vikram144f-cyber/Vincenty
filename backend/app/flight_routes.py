"""
Flight route API endpoint.

POST   /api/flight-route        — compute a geodesic flight route with caching.
GET    /api/flight-route/cache-stats — view cache hit/miss statistics.
DELETE /api/flight-route/cache   — clear the route computation cache.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas import (
    FlightRouteRequest,
    FlightRouteResponse,
    WaypointOut,
    ErrorDetail,
)
from app.services.geodesic import compute_flight_route
from app.services.cache import route_cache

logger = logging.getLogger(__name__)

flight_router = APIRouter(prefix="/api/flight-route", tags=["flight-route"])


# ─── POST /api/flight-route ──────────────────────────────────────────

@flight_router.post(
    "",
    response_model=FlightRouteResponse,
    responses={
        400: {"model": ErrorDetail, "description": "Invalid coordinates"},
        500: {"model": ErrorDetail, "description": "Internal computation error"},
    },
    summary="Compute Vincenty-precision geodesic flight route",
)
async def calculate_flight_route(req: FlightRouteRequest):
    """
    Compute a Vincenty-precision geodesic flight route.

    Checks the LRU cache first. On cache miss, runs the full
    computation and stores the result.
    """
    # ── Validate coordinates ─────────────────────────────────────
    if not (-90 <= req.origin.lat <= 90 and -180 <= req.origin.lng <= 180):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_ORIGIN",
                "message": "Origin coordinates out of valid range.",
                "details": {"lat": req.origin.lat, "lng": req.origin.lng},
            },
        )
    if not (-90 <= req.destination.lat <= 90 and -180 <= req.destination.lng <= 180):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_DESTINATION",
                "message": "Destination coordinates out of valid range.",
                "details": {"lat": req.destination.lat, "lng": req.destination.lng},
            },
        )

    num_waypoints = req.num_waypoints or 100
    speed = req.aircraft_speed_kmh or settings.DEFAULT_AIRCRAFT_SPEED_KMH
    max_range = settings.MAX_RANGE_KM

    # ── Coincident-point short-circuit ───────────────────────────
    if req.origin.lat == req.destination.lat and req.origin.lng == req.destination.lng:
        logger.info("Coincident origin and destination — returning zero-distance route")
        return FlightRouteResponse(
            distance_km=0.0,
            estimated_duration_hours=0.0,
            aircraft_speed_kmh=speed,
            num_waypoints=1,
            path_coordinates=[
                WaypointOut(
                    lat=req.origin.lat,
                    lng=req.origin.lng,
                    distance_from_start_km=0.0,
                )
            ],
            formula="vincenty",
            computation_time_ms=0.0,
            cache_hit=False,
            max_range_km=max_range,
            within_range=True,
        )

    # ── Cache lookup ─────────────────────────────────────────────
    cache_key = route_cache.make_route_key(
        req.origin.lat, req.origin.lng,
        req.destination.lat, req.destination.lng,
        num_waypoints,
    )
    cached = route_cache.get(cache_key)
    if cached is not None:
        # Do not mutate the shared cache entry when adapting ETA to a request's
        # aircraft speed; concurrent callers must observe independent payloads.
        cached = dict(cached)
        logger.info("Cache HIT for %s", cache_key)
        # Recalculate ETA if speed differs from cached
        if abs(cached.get("aircraft_speed_kmh", speed) - speed) > 0.1:
            cached["estimated_duration_hours"] = round(
                cached["distance_km"] / speed, 4
            )
            cached["aircraft_speed_kmh"] = speed
        cached["cache_hit"] = True
        cached["max_range_km"] = max_range
        cached["within_range"] = cached["distance_km"] <= max_range
        return cached

    logger.info("Cache MISS for %s — computing…", cache_key)

    # ── Compute ──────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        result = compute_flight_route(
            origin_lat=req.origin.lat,
            origin_lng=req.origin.lng,
            dest_lat=req.destination.lat,
            dest_lng=req.destination.lng,
            aircraft_speed_kmh=speed,
            num_waypoints=num_waypoints,
        )
    except Exception:
        logger.exception("Flight route computation failed")
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "COMPUTATION_ERROR",
                "message": "Geodesic computation failed.",
            },
        ) from None
    computation_ms = round((time.perf_counter() - t0) * 1000, 2)

    within_range = result.distance_km <= max_range

    # ── Build response ───────────────────────────────────────────
    path_coords = [
        {
            "lat": wp.lat,
            "lng": wp.lng,
            "distance_from_start_km": wp.distance_from_start_km,
        }
        for wp in result.path_coordinates
    ]

    response_dict = {
        "distance_km": result.distance_km,
        "estimated_duration_hours": result.estimated_duration_hours,
        "aircraft_speed_kmh": result.aircraft_speed_kmh,
        "path_coordinates": path_coords,
        "num_waypoints": result.num_waypoints,
        "formula": result.formula,
        "computation_time_ms": computation_ms,
        "cache_hit": False,
        "max_range_km": max_range,
        "within_range": within_range,
    }

    # ── Store in cache ───────────────────────────────────────────
    route_cache.put(cache_key, response_dict)

    return response_dict


# ─── GET /api/flight-route/cache-stats ───────────────────────────────

@flight_router.get("/cache-stats", summary="Cache performance statistics")
async def get_cache_stats():
    """Return current cache performance statistics."""
    stats = route_cache.stats()
    return {
        "hits": stats.hits,
        "misses": stats.misses,
        "hit_rate_percent": round(stats.hit_rate, 2),
        "size": stats.size,
        "max_size": stats.max_size,
        "evictions": stats.evictions,
    }


# ─── DELETE /api/flight-route/cache ──────────────────────────────────

@flight_router.delete("/cache", summary="Clear route computation cache")
async def clear_cache():
    """Clear the flight route computation cache."""
    removed = route_cache.clear()
    return {"cleared": removed, "message": f"Removed {removed} cached routes."}
