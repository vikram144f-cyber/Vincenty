"""
API routes for path calculation and environment constraints.

POST /api/path/calculate  — Compute optimized geodesic path
GET  /api/environment/constraints — Fetch active constraint zones
POST /api/routes/save     — Save a computed route
GET  /api/routes/history  — Retrieve saved route history
"""

from __future__ import annotations

import json
import logging
import uuid
import hashlib
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EnvironmentConstraint, SavedRoute
from app.schemas import (
    PathCalculateRequest,
    PathCalculateResponse,
    PathErrorResponse,
    PathWaypoint,
    ComputationMetrics,
    FlightStats,
    ConstraintOut,
    RouteSaveRequest,
    RouteSaveResponse,
    RouteHistoryItem,
    RouteHistoryResponse,
    ErrorDetail,
)
from app.pathfinding import (
    WeatherZone,
    create_grid,
    find_path,
    compute_path_distance_km,
    compute_flight_stats,
    haversine_km,
    vincenty_km,
)
from app.services.cache import route_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# ─── JSON file fallback for route persistence ─────────────────────────
ROUTES_FILE = Path(__file__).resolve().parent.parent / "saved_routes.json"


def _load_routes_file() -> list[dict]:
    """Load saved routes from the JSON fallback file."""
    if ROUTES_FILE.exists():
        try:
            return json.loads(ROUTES_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _save_routes_file(routes: list[dict]) -> None:
    """Write saved routes to the JSON fallback file."""
    ROUTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=ROUTES_FILE.parent,
            prefix=f".{ROUTES_FILE.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary_path = stream.name
            json.dump(routes, stream, indent=2, default=str)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, ROUTES_FILE)
        temporary_path = None
    finally:
        if temporary_path:
            try:
                os.remove(temporary_path)
            except FileNotFoundError:
                pass
            except OSError:
                logger.warning("Could not remove temporary route file %s", temporary_path)


# ─── Default weather zones (fallback when DB is empty) ────────────────
DEFAULT_CONSTRAINTS = [
    {"name": "N. Atlantic Storm",       "type": "storm",   "lat": 55,  "lng": -30,  "radius": 0.35, "intensity": 4.2},
    {"name": "W. Pacific Typhoon",      "type": "cyclone", "lat": 18,  "lng": 130,  "radius": 0.30, "intensity": 5.0},
    {"name": "Bay of Bengal Cyclone",   "type": "cyclone", "lat": 12,  "lng": 85,   "radius": 0.22, "intensity": 3.8},
    {"name": "ITCZ Storms",            "type": "storm",   "lat": 5,   "lng": -20,  "radius": 0.25, "intensity": 2.8},
    {"name": "Saharan Dust",           "type": "dust",    "lat": 20,  "lng": 0,    "radius": 0.20, "intensity": 2.2},
    {"name": "Polar Vortex",           "type": "storm",   "lat": 72,  "lng": 30,   "radius": 0.28, "intensity": 3.0},
    {"name": "S. Indian Storm",        "type": "storm",   "lat": -42, "lng": 70,   "radius": 0.25, "intensity": 3.5},
    {"name": "S. Pacific Storm",       "type": "storm",   "lat": -50, "lng": -120, "radius": 0.22, "intensity": 3.2},
]


# ─── POST /api/path/calculate ─────────────────────────────────────────

@router.post(
    "/path/calculate",
    response_model=PathCalculateResponse,
    responses={422: {"model": PathErrorResponse}, 500: {"model": ErrorDetail}},
    summary="Calculate optimized geodesic path",
)
async def calculate_path(req: PathCalculateRequest):
    """
    Accepts start/end coordinates and active environmental constraints.
    Returns the optimized path, total distance, flight stats, and metrics.
    """
    try:
        # Check cache
        req_json = req.model_dump_json() if hasattr(req, 'model_dump_json') else req.json()
        cache_key = f"astar_{hashlib.md5(req_json.encode('utf-8')).hexdigest()}"
        cached = route_cache.get(cache_key)
        if cached is not None:
            cached = dict(cached)
            logger.info("Cache HIT for A* path %s", cache_key)
            cached["cache_hit"] = True
            return cached

        logger.info("Cache MISS for A* path %s", cache_key)

        # Convert request constraints to engine WeatherZones
        weather_zones = [
            WeatherZone(
                lat=c.lat,
                lng=c.lng,
                radius=c.radius,
                intensity=c.intensity,
                label=c.label or "",
            )
            for c in req.constraints
        ]

        # Build the weighted grid
        grid = create_grid(req.lat_step, req.lng_step, weather_zones)

        # Run A* pathfinding
        result = find_path(
            start_lat=req.start.lat,
            start_lng=req.start.lng,
            end_lat=req.end.lat,
            end_lng=req.end.lng,
            grid=grid,
            lat_step=req.lat_step,
            lng_step=req.lng_step,
        )

        if result is None or len(result.path) == 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "error",
                    "message": "No valid path found. The constraints may completely block the route. "
                               "Try reducing constraint intensity or adjusting the grid resolution.",
                    "path": [],
                },
            )

        # Compute distances
        optimized_km = compute_path_distance_km(result.path)
        geodesic_km = vincenty_km(
            req.start.lat, req.start.lng,
            req.end.lat, req.end.lng,
        )

        # Flight statistics
        stats = compute_flight_stats(geodesic_km, optimized_km)

        # Build response
        path_waypoints = [
            PathWaypoint(lat=n.lat, lng=n.lng, cost=round(n.cost, 3))
            for n in result.path
        ]

        response_data = PathCalculateResponse(
            path=path_waypoints,
            total_distance_km=round(optimized_km, 1),
            geodesic_distance_km=round(geodesic_km, 1),
            flight_stats=FlightStats(**stats),
            metrics=ComputationMetrics(
                iterations=result.iterations,
                nodes_explored=result.nodes_explored,
                computation_time_ms=result.computation_time_ms,
                grid_size=f"{result.grid_rows}×{result.grid_cols}",
                formula_used="vincenty",
            ),
            status="ok",
            cache_hit=False,
        )

        route_cache.put(cache_key, response_data.model_dump() if hasattr(response_data, 'model_dump') else response_data.dict())

        return response_data

    except HTTPException:
        raise
    except Exception:
        logger.exception("Path calculation failed")
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "COMPUTATION_ERROR",
                "message": "Path calculation failed.",
            },
        ) from None


# ─── GET /api/environment/constraints ─────────────────────────────────

@router.get(
    "/environment/constraints",
    summary="Fetch active environmental constraints",
)
async def get_constraints(db: Session = Depends(get_db)):
    """
    Returns active environment constraint zones.
    Falls back to hardcoded defaults if DB is unavailable or empty.
    """
    try:
        db_constraints = (
            db.query(EnvironmentConstraint)
            .filter(EnvironmentConstraint.is_active.is_(True))
            .all()
        )

        if db_constraints:
            return {
                "constraints": [
                    {
                        "id": str(c.id),
                        "name": c.name,
                        "constraint_type": c.constraint_type,
                        "lat": c.center_lat,
                        "lng": c.center_lng,
                        "radius": c.radius,
                        "intensity": c.intensity,
                        "label": c.name,
                        "is_active": c.is_active,
                    }
                    for c in db_constraints
                ],
                "source": "database",
                "total": len(db_constraints),
            }
    except Exception as e:
        logger.warning(f"DB query failed, using defaults: {e}")

    # Fallback to hardcoded defaults
    return {
        "constraints": [
            {
                "id": f"default-{i}",
                "name": d["name"],
                "constraint_type": d["type"],
                "lat": d["lat"],
                "lng": d["lng"],
                "radius": d["radius"],
                "intensity": d["intensity"],
                "label": d["name"],
                "is_active": True,
            }
            for i, d in enumerate(DEFAULT_CONSTRAINTS)
        ],
        "source": "defaults",
        "total": len(DEFAULT_CONSTRAINTS),
    }


# ─── POST /api/routes/save ────────────────────────────────────────────

@router.post(
    "/routes/save",
    response_model=RouteSaveResponse,
    summary="Save a computed route",
)
async def save_route(req: RouteSaveRequest, db: Session = Depends(get_db)):
    """Persist a computed flight path. Uses DB if available, else JSON file."""
    # Try database first
    try:
        route = SavedRoute(
            name=req.name or f"{req.start_city} → {req.end_city}",
            start_city=req.start_city,
            end_city=req.end_city,
            start_lat=req.start.lat,
            start_lng=req.start.lng,
            end_lat=req.end.lat,
            end_lng=req.end.lng,
            path_data=[{"lat": p.lat, "lng": p.lng, "cost": p.cost} for p in req.path],
            geodesic_km=req.geodesic_km,
            optimized_km=req.optimized_km,
            detour_percent=req.detour_percent,
            estimated_hours=req.estimated_hours,
            fuel_kg=req.fuel_kg,
            co2_kg=req.co2_kg,
            waypoint_count=len(req.path),
            computation_time_ms=req.computation_time_ms,
            constraints_active=req.constraints_active,
        )
        db.add(route)
        db.commit()
        db.refresh(route)
        return RouteSaveResponse(id=str(route.id))
    except Exception as db_err:
        db.rollback()
        logger.warning(f"DB save failed, falling back to JSON file: {db_err}")

    # Fallback: save to local JSON file
    try:
        route_id = str(uuid.uuid4())
        record = {
            "id": route_id,
            "name": req.name or f"{req.start_city} → {req.end_city}",
            "start_city": req.start_city,
            "end_city": req.end_city,
            "start_lat": req.start.lat,
            "start_lng": req.start.lng,
            "end_lat": req.end.lat,
            "end_lng": req.end.lng,
            "path_data": [{"lat": p.lat, "lng": p.lng, "cost": p.cost} for p in req.path],
            "geodesic_km": req.geodesic_km,
            "optimized_km": req.optimized_km,
            "detour_percent": req.detour_percent,
            "estimated_hours": req.estimated_hours,
            "fuel_kg": req.fuel_kg,
            "co2_kg": req.co2_kg,
            "waypoint_count": len(req.path),
            "computation_time_ms": req.computation_time_ms,
            "constraints_active": req.constraints_active,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        routes = _load_routes_file()
        routes.insert(0, record)  # newest first
        _save_routes_file(routes)
        return RouteSaveResponse(id=route_id, message="Route saved successfully (local file)")
    except Exception:
        logger.exception("Failed to save route to JSON file")
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "PERSISTENCE_ERROR",
                "message": "Failed to save route.",
            },
        ) from None


# ─── GET /api/routes/history ──────────────────────────────────────────

@router.get(
    "/routes/history",
    response_model=RouteHistoryResponse,
    summary="Retrieve saved route history",
)
async def get_route_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Get paginated list of previously saved routes, newest first."""
    # Try database first
    try:
        total = db.query(SavedRoute).count()
        routes = (
            db.query(SavedRoute)
            .order_by(SavedRoute.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        if total > 0 or routes:
            return RouteHistoryResponse(
                routes=[
                    RouteHistoryItem(
                        id=str(r.id),
                        name=r.name,
                        start_city=r.start_city,
                        end_city=r.end_city,
                        start_lat=r.start_lat,
                        start_lng=r.start_lng,
                        end_lat=r.end_lat,
                        end_lng=r.end_lng,
                        geodesic_km=r.geodesic_km,
                        optimized_km=r.optimized_km,
                        detour_percent=r.detour_percent,
                        estimated_hours=r.estimated_hours,
                        fuel_kg=r.fuel_kg,
                        co2_kg=r.co2_kg,
                        waypoint_count=r.waypoint_count,
                        computation_time_ms=r.computation_time_ms,
                        created_at=r.created_at,
                    )
                    for r in routes
                ],
                total=total,
            )
    except Exception as e:
        logger.warning(f"DB history query failed, falling back to JSON file: {e}")

    # Fallback: read from local JSON file
    try:
        all_routes = _load_routes_file()
        total = len(all_routes)
        page = all_routes[offset : offset + limit]
        return RouteHistoryResponse(
            routes=[
                RouteHistoryItem(
                    id=r["id"],
                    name=r.get("name"),
                    start_city=r["start_city"],
                    end_city=r["end_city"],
                    start_lat=r["start_lat"],
                    start_lng=r["start_lng"],
                    end_lat=r["end_lat"],
                    end_lng=r["end_lng"],
                    geodesic_km=r.get("geodesic_km"),
                    optimized_km=r.get("optimized_km"),
                    detour_percent=r.get("detour_percent"),
                    estimated_hours=r.get("estimated_hours"),
                    fuel_kg=r.get("fuel_kg"),
                    co2_kg=r.get("co2_kg"),
                    waypoint_count=r.get("waypoint_count"),
                    computation_time_ms=r.get("computation_time_ms"),
                    created_at=r.get("created_at", datetime.now(timezone.utc).isoformat()),
                )
                for r in page
            ],
            total=total,
        )
    except Exception:
        logger.exception("Failed to fetch route history")
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "PERSISTENCE_ERROR",
                "message": "Failed to fetch route history.",
            },
        ) from None
