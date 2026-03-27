"""Pydantic schemas for API request/response validation."""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ─── Coordinate / Geometry ────────────────────────────────────────────

class Coordinate(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude in degrees")
    lng: float = Field(..., ge=-180, le=180, description="Longitude in degrees")


class PathWaypoint(BaseModel):
    lat: float
    lng: float
    cost: float = Field(1.0, description="Traversal cost at this node")


# ─── Environment Constraints ─────────────────────────────────────────

class ConstraintBase(BaseModel):
    name: str
    constraint_type: str = Field(..., description="storm | no_fly_zone | terrain | dust | cyclone | turbulence")
    center_lat: float
    center_lng: float
    radius: float = Field(..., description="Haversine radius on unit sphere")
    intensity: float = Field(1.0, ge=0, le=10, description="Severity 1‑5+")
    is_active: bool = True
    metadata_json: Optional[dict] = None


class ConstraintOut(ConstraintBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ─── Path Calculation ────────────────────────────────────────────────

class ActiveConstraint(BaseModel):
    """A lightweight constraint sent by the frontend for path computation."""
    lat: float
    lng: float
    radius: float
    intensity: float = Field(1.0, ge=0, le=10)
    label: Optional[str] = None


class PathCalculateRequest(BaseModel):
    start: Coordinate
    end: Coordinate
    constraints: list[ActiveConstraint] = Field(default_factory=list)
    lat_step: float = Field(5.0, gt=0, le=30, description="Grid latitude step in degrees")
    lng_step: float = Field(5.0, gt=0, le=30, description="Grid longitude step in degrees")


class ComputationMetrics(BaseModel):
    iterations: int
    nodes_explored: int
    computation_time_ms: float
    grid_size: str
    formula_used: Optional[str] = "haversine"


class FlightStats(BaseModel):
    geodesic_km: int
    optimized_km: int
    detour_percent: float
    estimated_hours: float
    geodesic_hours: float
    fuel_kg: int
    geodesic_fuel_kg: int
    co2_kg: int
    geodesic_co2_kg: int
    fuel_saved_kg: int
    net_savings_percent: float
    cruise_altitude: int
    cruise_speed: int
    aircraft_name: str
    in_range: bool


class PathCalculateResponse(BaseModel):
    path: list[PathWaypoint]
    total_distance_km: float
    geodesic_distance_km: float
    flight_stats: FlightStats
    metrics: ComputationMetrics
    status: str = "ok"
    message: Optional[str] = None
    cache_hit: bool = False


class PathErrorResponse(BaseModel):
    status: str = "error"
    message: str
    path: list[PathWaypoint] = Field(default_factory=list)


# ─── Saved Routes ───────────────────────────────────────────────────

class RouteSaveRequest(BaseModel):
    name: Optional[str] = None
    start_city: str
    end_city: str
    start: Coordinate
    end: Coordinate
    path: list[PathWaypoint]
    geodesic_km: Optional[float] = None
    optimized_km: Optional[float] = None
    detour_percent: Optional[float] = None
    estimated_hours: Optional[float] = None
    fuel_kg: Optional[float] = None
    co2_kg: Optional[float] = None
    computation_time_ms: Optional[float] = None
    constraints_active: Optional[list[str]] = None


class RouteSaveResponse(BaseModel):
    id: str
    message: str = "Route saved successfully"


class RouteHistoryItem(BaseModel):
    id: str
    name: Optional[str]
    start_city: str
    end_city: str
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    geodesic_km: Optional[float]
    optimized_km: Optional[float]
    detour_percent: Optional[float]
    estimated_hours: Optional[float]
    fuel_kg: Optional[float]
    co2_kg: Optional[float]
    waypoint_count: Optional[int]
    computation_time_ms: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True


class RouteHistoryResponse(BaseModel):
    routes: list[RouteHistoryItem]
    total: int


# ─── New Modular API Sprint ──────────────────────────────────────────

class FlightRouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    aircraft_speed_kmh: Optional[float] = Field(
        default=903.0, ge=100.0, le=3000.0,
        description="Aircraft cruise speed in km/h. Default: Boeing 787-9 (903 km/h)."
    )
    num_waypoints: Optional[int] = Field(
        default=100, ge=2, le=5000,
        description="Number of intermediate waypoints to generate."
    )


class WaypointOut(BaseModel):
    lat: float
    lng: float
    distance_from_start_km: float


class FlightRouteResponse(BaseModel):
    distance_km: float
    estimated_duration_hours: float
    aircraft_speed_kmh: float
    num_waypoints: int
    path_coordinates: list[WaypointOut]
    formula: str
    computation_time_ms: float
    cache_hit: bool
    max_range_km: float = Field(14140.0, description="Aircraft maximum range in km")
    within_range: bool = Field(True, description="Whether the route is within aircraft range")


class ErrorDetail(BaseModel):
    """Structured error response for the flight-route API."""
    error_code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable error description")
    details: Optional[dict] = None
