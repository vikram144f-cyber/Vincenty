"""SQLAlchemy ORM models for the Vincenty routing database."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Text, JSON, Boolean,
)
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geometry
from app.database import Base


class EnvironmentConstraint(Base):
    """
    A restricted/hazardous zone on the globe.
    Stored as a PostGIS polygon + metadata.
    """
    __tablename__ = "environment_constraints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    constraint_type = Column(
        String(50), nullable=False,
        comment="storm | no_fly_zone | terrain | dust | cyclone | turbulence"
    )
    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    radius = Column(Float, nullable=False, comment="Haversine radius on unit sphere")
    intensity = Column(Float, nullable=False, default=1.0, comment="1–5 severity scale")
    is_active = Column(Boolean, nullable=False, default=True)
    # PostGIS polygon for spatial queries
    geom = Column(Geometry("POLYGON", srid=4326), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SavedRoute(Base):
    """A user-saved flight path with its metadata and computed statistics."""
    __tablename__ = "saved_routes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=True)
    start_city = Column(String(100), nullable=False)
    end_city = Column(String(100), nullable=False)
    start_lat = Column(Float, nullable=False)
    start_lng = Column(Float, nullable=False)
    end_lat = Column(Float, nullable=False)
    end_lng = Column(Float, nullable=False)
    # Computed path as a JSON array of {lat, lng, cost} waypoints
    path_data = Column(JSON, nullable=False)
    # Flight statistics
    geodesic_km = Column(Float, nullable=True)
    optimized_km = Column(Float, nullable=True)
    detour_percent = Column(Float, nullable=True)
    estimated_hours = Column(Float, nullable=True)
    fuel_kg = Column(Float, nullable=True)
    co2_kg = Column(Float, nullable=True)
    waypoint_count = Column(Integer, nullable=True)
    computation_time_ms = Column(Float, nullable=True)
    constraints_active = Column(JSON, nullable=True, comment="IDs of constraints that were active")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
