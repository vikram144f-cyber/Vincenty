-- ============================================================
-- Vincenty — PostgreSQL + PostGIS Database Schema
-- ============================================================
-- Prerequisites:
--   1. PostgreSQL 14+ installed
--   2. PostGIS extension available
--
-- Setup:
--   CREATE DATABASE orbit_path_painter;
--   \c orbit_path_painter
--   Then run this script.
-- ============================================================

-- Enable PostGIS extension for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Environment Constraints ────────────────────────────────────────
-- Stores restricted/hazardous zones as PostGIS polygons
-- with metadata for rendering on the frontend map.

CREATE TABLE IF NOT EXISTS environment_constraints (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    constraint_type VARCHAR(50) NOT NULL
                    CHECK (constraint_type IN (
                        'storm', 'no_fly_zone', 'terrain',
                        'dust', 'cyclone', 'turbulence'
                    )),
    center_lat      DOUBLE PRECISION NOT NULL
                    CHECK (center_lat BETWEEN -90 AND 90),
    center_lng      DOUBLE PRECISION NOT NULL
                    CHECK (center_lng BETWEEN -180 AND 180),
    radius          DOUBLE PRECISION NOT NULL
                    CHECK (radius > 0),
    intensity       DOUBLE PRECISION NOT NULL DEFAULT 1.0
                    CHECK (intensity BETWEEN 0 AND 10),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- PostGIS polygon for spatial intersection queries
    geom            GEOMETRY(POLYGON, 4326),
    metadata_json   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for fast geographic queries
CREATE INDEX IF NOT EXISTS idx_constraints_geom
    ON environment_constraints USING GIST (geom);

-- Filter index for active constraints
CREATE INDEX IF NOT EXISTS idx_constraints_active
    ON environment_constraints (is_active)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_constraints_type
    ON environment_constraints (constraint_type);


-- ─── Saved Routes ───────────────────────────────────────────────────
-- Stores user-generated flight paths with full metadata and statistics.

CREATE TABLE IF NOT EXISTS saved_routes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255),
    start_city          VARCHAR(100) NOT NULL,
    end_city            VARCHAR(100) NOT NULL,
    start_lat           DOUBLE PRECISION NOT NULL,
    start_lng           DOUBLE PRECISION NOT NULL,
    end_lat             DOUBLE PRECISION NOT NULL,
    end_lng             DOUBLE PRECISION NOT NULL,
    -- The computed path stored as a JSON array of {lat, lng, cost}
    path_data           JSONB NOT NULL,
    -- Flight statistics
    geodesic_km         DOUBLE PRECISION,
    optimized_km        DOUBLE PRECISION,
    detour_percent      DOUBLE PRECISION,
    estimated_hours     DOUBLE PRECISION,
    fuel_kg             DOUBLE PRECISION,
    co2_kg              DOUBLE PRECISION,
    waypoint_count      INTEGER,
    computation_time_ms DOUBLE PRECISION,
    -- IDs of constraints that were active during computation
    constraints_active  JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routes_created
    ON saved_routes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routes_cities
    ON saved_routes (start_city, end_city);


-- ─── Trigger: auto-update updated_at ────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_constraints_updated_at
    BEFORE UPDATE ON environment_constraints
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ─── Seed Data: Default Weather Zones ───────────────────────────────
-- These match the frontend's hardcoded weather zones for consistency.

INSERT INTO environment_constraints (name, constraint_type, center_lat, center_lng, radius, intensity, is_active)
VALUES
    ('N. Atlantic Storm',      'storm',   55,  -30,  0.35, 4.2, TRUE),
    ('W. Pacific Typhoon',     'cyclone', 18,  130,  0.30, 5.0, TRUE),
    ('Bay of Bengal Cyclone',  'cyclone', 12,  85,   0.22, 3.8, TRUE),
    ('ITCZ Storms',            'storm',   5,   -20,  0.25, 2.8, TRUE),
    ('Saharan Dust',           'dust',    20,  0,    0.20, 2.2, TRUE),
    ('Polar Vortex',           'storm',   72,  30,   0.28, 3.0, TRUE),
    ('S. Indian Storm',        'storm',   -42, 70,   0.25, 3.5, TRUE),
    ('S. Pacific Storm',       'storm',   -50, -120, 0.22, 3.2, TRUE)
ON CONFLICT DO NOTHING;


-- ─── Helper function: Generate PostGIS circle polygons ──────────────
-- Creates an approximate polygon circle around a lat/lng center point.

CREATE OR REPLACE FUNCTION generate_constraint_polygon(
    p_center_lat DOUBLE PRECISION,
    p_center_lng DOUBLE PRECISION,
    p_radius_km  DOUBLE PRECISION,
    p_segments   INTEGER DEFAULT 64
)
RETURNS GEOMETRY AS $$
BEGIN
    RETURN ST_Buffer(
        ST_SetSRID(ST_MakePoint(p_center_lng, p_center_lat), 4326)::geography,
        p_radius_km * 1000  -- convert km to meters
    )::geometry;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ─── Update existing constraints with PostGIS polygons ──────────────
-- Convert the haversine radius (unit sphere) to approximate km:
-- 1 radian ≈ 6371 km, so radius * 6371 gives km radius

UPDATE environment_constraints
SET geom = generate_constraint_polygon(
    center_lat,
    center_lng,
    radius * 6371  -- convert unit-sphere radius to km
)
WHERE geom IS NULL;
