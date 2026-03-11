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
