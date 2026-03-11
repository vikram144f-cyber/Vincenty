"""
Core geodesic pathfinding engine.

Implements A* search modified for spherical coordinates using the Haversine formula.
Supports dynamic environmental constraint weighting for obstacle avoidance.
"""

from __future__ import annotations

import math
import time
import heapq
from dataclasses import dataclass, field
from typing import Optional

# ─── Constants ────────────────────────────────────────────────────────
EARTH_RADIUS_KM = 6371.0

# Boeing 787-9 Dreamliner performance
AIRCRAFT = {
    "name": "Boeing 787-9 Dreamliner",
    "cruise_speed_kmh": 903,
    "cruise_altitude_ft": 39000,
    "fuel_burn_kg_per_km": 5.2,
    "co2_per_kg_fuel": 3.16,
    "max_range_km": 14140,
}


# ─── Data Structures ─────────────────────────────────────────────────

@dataclass
class GlobeNode:
    lat: float
    lng: float
    cost: float = 1.0  # weather cost multiplier (1 = clear, 5+ = severe)


@dataclass
class WeatherZone:
    lat: float
    lng: float
    radius: float     # haversine units on unit sphere
    intensity: float   # 1–5+
    label: str = ""


@dataclass(order=True)
class AStarEntry:
    """Priority queue entry for A*. Ordered by f-score."""
    f: float
    node: GlobeNode = field(compare=False)
    g: float = field(compare=False)
    parent: Optional['AStarEntry'] = field(default=None, compare=False)


# ─── Haversine ────────────────────────────────────────────────────────

def haversine_unit(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance on a unit sphere (result in radians of arc)."""
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return 2 * math.asin(math.sqrt(a))


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in kilometers."""
    return EARTH_RADIUS_KM * haversine_unit(lat1, lng1, lat2, lng2)


# ─── Grid Construction ───────────────────────────────────────────────

def create_grid(
    lat_step: float,
    lng_step: float,
    weather_zones: list[WeatherZone],
) -> list[list[GlobeNode]]:
    """
    Build a lat/lng grid of GlobeNodes with cost weights derived from
    proximity to weather zones.
    """
    grid: list[list[GlobeNode]] = []
    lat = -90.0
    while lat <= 90.0:
        row: list[GlobeNode] = []
        lng = -180.0
        while lng < 180.0:
            cost = 1.0
            for zone in weather_zones:
                d = haversine_unit(lat, lng, zone.lat, zone.lng)
                if d < zone.radius:
                    zone_cost = zone.intensity * (1 - d / zone.radius) + 1
                    cost = max(cost, zone_cost)
            row.append(GlobeNode(lat=lat, lng=lng, cost=cost))
            lng += lng_step
        grid.append(row)
        lat += lat_step
    return grid


def _snap(val: float, step: float, offset: float) -> float:
    return round((val - offset) / step) * step + offset


def _node_key(n: GlobeNode) -> str:
    return f"{n.lat:.1f},{n.lng:.1f}"


def _get_neighbors(
    node: GlobeNode,
    grid: list[list[GlobeNode]],
    lat_step: float,
    lng_step: float,
) -> list[GlobeNode]:
    """Return the 8-connected neighbors of a grid node."""
    lat_idx = round((node.lat + 90) / lat_step)
    lng_idx = round((node.lng + 180) / lng_step)
    max_lat = len(grid)
    max_lng = len(grid[0]) if grid else 0
    neighbors: list[GlobeNode] = []

    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == 0 and dj == 0:
                continue
            ni = lat_idx + di
            nj = (lng_idx + dj) % max_lng  # wrap longitude
            if 0 <= ni < max_lat and grid[ni] and nj < len(grid[ni]):
                neighbors.append(grid[ni][nj])
    return neighbors


# ─── A* Pathfinding ───────────────────────────────────────────────────

@dataclass
class PathResult:
    path: list[GlobeNode]
    iterations: int
    nodes_explored: int
    computation_time_ms: float
    grid_rows: int
    grid_cols: int


def find_path(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    grid: list[list[GlobeNode]],
    lat_step: float,
    lng_step: float,
    max_iterations: int = 80_000,
) -> Optional[PathResult]:
    """
    A* search on a spherical grid from (start_lat, start_lng) to (end_lat, end_lng).

    Returns PathResult with the optimal path or None if unreachable.
    """
    t0 = time.perf_counter()

    # Snap coordinates to grid
    s_lat = _snap(start_lat, lat_step, -90)
    s_lng = _snap(start_lng, lng_step, -180)
    e_lat = _snap(end_lat, lat_step, -90)
    e_lng = _snap(end_lng, lng_step, -180)

    s_lat_idx = round((s_lat + 90) / lat_step)
    s_lng_idx = round((s_lng + 180) / lng_step)
    e_lat_idx = round((e_lat + 90) / lat_step)
    e_lng_idx = round((e_lng + 180) / lng_step)

    grid_rows = len(grid)
    grid_cols = len(grid[0]) if grid else 0

    start_node = grid[s_lat_idx][s_lng_idx] if 0 <= s_lat_idx < grid_rows and 0 <= s_lng_idx < grid_cols else None
    end_node = grid[e_lat_idx][e_lng_idx] if 0 <= e_lat_idx < grid_rows and 0 <= e_lng_idx < grid_cols else None

    if start_node is None or end_node is None:
        return None

    end_key = _node_key(end_node)

    # Priority queue (min-heap)
    h0 = haversine_unit(start_node.lat, start_node.lng, end_node.lat, end_node.lng)
    start_entry = AStarEntry(f=h0, node=start_node, g=0.0, parent=None)
    open_heap: list[AStarEntry] = [start_entry]
    best_g: dict[str, float] = {_node_key(start_node): 0.0}
    closed_set: set[str] = set()

    iterations = 0
    nodes_explored = 0

    while open_heap and iterations < max_iterations:
        iterations += 1
        current = heapq.heappop(open_heap)
        c_key = _node_key(current.node)

        if c_key in closed_set:
            continue
        closed_set.add(c_key)
        nodes_explored += 1

        # Goal reached
        if c_key == end_key:
            path: list[GlobeNode] = []
            entry: Optional[AStarEntry] = current
            while entry is not None:
                path.append(entry.node)
                entry = entry.parent
            path.reverse()

            elapsed_ms = (time.perf_counter() - t0) * 1000
            return PathResult(
                path=path,
                iterations=iterations,
                nodes_explored=nodes_explored,
                computation_time_ms=round(elapsed_ms, 2),
                grid_rows=grid_rows,
                grid_cols=grid_cols,
            )

        # Expand neighbors
        for neighbor in _get_neighbors(current.node, grid, lat_step, lng_step):
            n_key = _node_key(neighbor)
            if n_key in closed_set:
                continue

            move_cost = haversine_unit(
                current.node.lat, current.node.lng,
                neighbor.lat, neighbor.lng,
            ) * neighbor.cost
            tent_g = current.g + move_cost

            if n_key in best_g and tent_g >= best_g[n_key]:
                continue

            best_g[n_key] = tent_g
            h = haversine_unit(neighbor.lat, neighbor.lng, end_node.lat, end_node.lng)
            entry = AStarEntry(f=tent_g + h, node=neighbor, g=tent_g, parent=current)
            heapq.heappush(open_heap, entry)

    # No path found
    elapsed_ms = (time.perf_counter() - t0) * 1000
    return PathResult(
        path=[],
        iterations=iterations,
        nodes_explored=nodes_explored,
        computation_time_ms=round(elapsed_ms, 2),
        grid_rows=grid_rows,
        grid_cols=grid_cols,
    )


# ─── Flight Statistics ───────────────────────────────────────────────

def compute_path_distance_km(path: list[GlobeNode]) -> float:
    """Sum up haversine distances along the path in km."""
    total = 0.0
    for i in range(len(path) - 1):
        total += haversine_km(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng)
    return total


def compute_flight_stats(geodesic_km: float, optimized_km: float) -> dict:
    """Compute real-world flight statistics using Boeing 787-9 performance data."""
    ac = AIRCRAFT
    detour_pct = ((optimized_km - geodesic_km) / geodesic_km * 100) if geodesic_km > 0 else 0
    est_hours = optimized_km / ac["cruise_speed_kmh"]
    geo_hours = geodesic_km / ac["cruise_speed_kmh"]
    fuel_kg = optimized_km * ac["fuel_burn_kg_per_km"]
    geo_fuel_kg = geodesic_km * ac["fuel_burn_kg_per_km"]
    co2_kg = fuel_kg * ac["co2_per_kg_fuel"]
    geo_co2_kg = geo_fuel_kg * ac["co2_per_kg_fuel"]

    storm_penalty_pct = 15  # 12-18% more fuel through storms
    fuel_saved = geo_fuel_kg * (storm_penalty_pct / 100)
    net_diff = (fuel_kg - geo_fuel_kg) - fuel_saved

    return {
        "geodesic_km": round(geodesic_km),
        "optimized_km": round(optimized_km),
        "detour_percent": round(max(0, detour_pct), 1),
        "estimated_hours": round(est_hours, 1),
        "geodesic_hours": round(geo_hours, 1),
        "fuel_kg": round(fuel_kg),
        "geodesic_fuel_kg": round(geo_fuel_kg),
        "co2_kg": round(co2_kg),
        "geodesic_co2_kg": round(geo_co2_kg),
        "fuel_saved_kg": round(max(0, fuel_saved - (fuel_kg - geo_fuel_kg))),
        "net_savings_percent": round(
            max(0, (fuel_saved - (fuel_kg - geo_fuel_kg)) / geo_fuel_kg * 100) if geo_fuel_kg > 0 else 0,
            1,
        ),
        "cruise_altitude": ac["cruise_altitude_ft"],
        "cruise_speed": ac["cruise_speed_kmh"],
        "aircraft_name": ac["name"],
        "in_range": optimized_km <= ac["max_range_km"],
    }
