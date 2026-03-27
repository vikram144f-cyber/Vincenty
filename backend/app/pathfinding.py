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

# WGS-84 ellipsoid parameters for Vincenty
WGS84_A = 6_378_137.0          # semi-major axis (m)
WGS84_B = 6_356_752.314245     # semi-minor axis (m)
WGS84_F = 1 / 298.257223563    # flattening

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
    
    # Heuristic Distance Wrapping
    lng_diff = abs(lng2 - lng1)
    d_lng_deg = min(lng_diff, 360.0 - lng_diff)
    d_lng = math.radians(d_lng_deg)
    
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


# ─── Vincenty (WGS-84 Ellipsoid) ─────────────────────────────────────

def vincenty_km(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
    max_iterations: int = 200,
    tol: float = 1e-12,
) -> float:
    """
    Vincenty's inverse formula for geodesic distance on the WGS-84 ellipsoid.
    Returns distance in **kilometers** with millimeter-level accuracy.

    Falls back to Haversine if the iterative solution fails to converge
    (e.g. nearly antipodal points).
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    
    # Heuristic Distance Wrapping
    lng_diff = lng2 - lng1
    if lng_diff > 180.0:
        lng_diff -= 360.0
    elif lng_diff < -180.0:
        lng_diff += 360.0
    L = math.radians(lng_diff)

    U1 = math.atan((1 - WGS84_F) * math.tan(phi1))
    U2 = math.atan((1 - WGS84_F) * math.tan(phi2))
    sin_U1, cos_U1 = math.sin(U1), math.cos(U1)
    sin_U2, cos_U2 = math.sin(U2), math.cos(U2)

    lam = L  # initial approximation
    for _ in range(max_iterations):
        sin_lam = math.sin(lam)
        cos_lam = math.cos(lam)

        sin_sigma = math.sqrt(
            (cos_U2 * sin_lam) ** 2
            + (cos_U1 * sin_U2 - sin_U1 * cos_U2 * cos_lam) ** 2
        )
        if sin_sigma == 0:
            return 0.0  # coincident points

        cos_sigma = sin_U1 * sin_U2 + cos_U1 * cos_U2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)

        sin_alpha = cos_U1 * cos_U2 * sin_lam / sin_sigma
        cos2_alpha = 1 - sin_alpha ** 2

        if cos2_alpha == 0:
            cos_2sigma_m = 0.0  # equatorial line
        else:
            cos_2sigma_m = cos_sigma - 2 * sin_U1 * sin_U2 / cos2_alpha

        C = WGS84_F / 16 * cos2_alpha * (4 + WGS84_F * (4 - 3 * cos2_alpha))
        lam_prev = lam
        lam = L + (1 - C) * WGS84_F * sin_alpha * (
            sigma + C * sin_sigma * (
                cos_2sigma_m + C * cos_sigma * (-1 + 2 * cos_2sigma_m ** 2)
            )
        )

        if abs(lam - lam_prev) < tol:
            break
    else:
        # Failed to converge — fall back to Haversine
        return haversine_km(lat1, lng1, lat2, lng2)

    u2 = cos2_alpha * (WGS84_A ** 2 - WGS84_B ** 2) / (WGS84_B ** 2)
    A_coeff = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    B_coeff = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    delta_sigma = B_coeff * sin_sigma * (
        cos_2sigma_m + B_coeff / 4 * (
            cos_sigma * (-1 + 2 * cos_2sigma_m ** 2)
            - B_coeff / 6 * cos_2sigma_m * (-3 + 4 * sin_sigma ** 2)
            * (-3 + 4 * cos_2sigma_m ** 2)
        )
    )

    distance_m = WGS84_B * A_coeff * (sigma - delta_sigma)
    return distance_m / 1000.0  # metres → km


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
                    # Soft logarithmic penalty: rises steeply inside the zone
                    # core but caps at MAX_WEATHER_COST so the algorithm
                    # hugs the storm edge rather than taking a global detour.
                    # Formula: 1 + MAX_COST * ln(1 + proximity) / ln(2)
                    # where proximity = (1 - d/radius) in [0, 1].
                    proximity = 1.0 - d / zone.radius          # 0=edge, 1=centre
                    # Scale by normalised intensity so a 2.0-intensity zone
                    # is half the penalty of a 5.0-intensity zone.
                    intensity_frac = min(zone.intensity / 5.0, 1.0)
                    zone_cost = 1.0 + MAX_WEATHER_COST * intensity_frac * (
                        math.log1p(proximity) / math.log(2)
                    )
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


# Maximum weather cost multiplier.
# At intensity=5 (centre of storm) the node becomes 1.5× more expensive
# than clear air.  This is deliberately modest so the algorithm prefers
# a gentle edge-hugging detour over a 2 000 km global swing.
MAX_WEATHER_COST: float = 1.5


def _get_neighbors(
    node: GlobeNode,
    grid: list[list[GlobeNode]],
    lat_step: float,
    lng_step: float,
) -> list[tuple[GlobeNode, bool]]:
    """
    Return all 8-connected neighbors of a grid node.

    Each entry is ``(neighbor_node, is_diagonal)`` so the caller can
    apply the correct √2 movement-cost multiplier for diagonal steps.
    Longitude wraps around the antimeridian automatically.
    """
    lat_idx = round((node.lat + 90) / lat_step)
    lng_idx = round((node.lng + 180) / lng_step)
    max_lat = len(grid)
    max_lng = len(grid[0]) if grid else 0
    neighbors: list[tuple[GlobeNode, bool]] = []

    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == 0 and dj == 0:
                continue
            ni = lat_idx + di
            
            # Neighbor Generation Wrapping: Date Line Wraparound
            nj = lng_idx + dj
            if nj < 0:
                nj += max_lng
            elif nj >= max_lng:
                nj -= max_lng
                
            if 0 <= ni < max_lat and grid[ni] and nj < len(grid[ni]):
                is_diagonal = (di != 0 and dj != 0)
                neighbors.append((grid[ni][nj], is_diagonal))
    return neighbors


# ─── Path Smoothing ───────────────────────────────────────────────────

def smooth_path(path: list[GlobeNode], angle_thresh_deg: float = 5.0) -> list[GlobeNode]:
    """
    Remove redundant collinear waypoints from the raw A* grid path.

    The A* grid search produces staircase artefacts because every node
    lives on a fixed lat/lng lattice.  This post-processor walks the
    path and drops any intermediate node whose bearing deviation from
    the previous segment is below ``angle_thresh_deg``.  The result is
    a compact list of *turning-point* waypoints that closely follows the
    geodesic without the taxicab zigzag.

    Parameters
    ----------
    path:
        Raw A* node list (start … end).
    angle_thresh_deg:
        Waypoints whose bearing change is smaller than this value are
        removed.  5° keeps slight course corrections while eliminating
        redundant collinear nodes on straight grid runs.

    Returns
    -------
    list[GlobeNode]
        Smoothed path, always including the original start and end nodes.
    """
    if len(path) <= 2:
        return path

    def _bearing(a: GlobeNode, b: GlobeNode) -> float:
        """Initial bearing (degrees) from a to b on the sphere."""
        lat1 = math.radians(a.lat)
        lat2 = math.radians(b.lat)
        d_lng = math.radians(b.lng - a.lng)
        x = math.sin(d_lng) * math.cos(lat2)
        y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lng)
        return math.degrees(math.atan2(x, y)) % 360.0

    def _angle_diff(a: float, b: float) -> float:
        """Absolute angular difference between two bearings, in [0, 180]."""
        diff = abs(a - b) % 360.0
        return diff if diff <= 180.0 else 360.0 - diff

    smoothed: list[GlobeNode] = [path[0]]
    prev_bearing = _bearing(path[0], path[1])

    for i in range(1, len(path) - 1):
        curr_bearing = _bearing(path[i], path[i + 1])
        if _angle_diff(prev_bearing, curr_bearing) >= angle_thresh_deg:
            smoothed.append(path[i])
            prev_bearing = curr_bearing

    smoothed.append(path[-1])
    return smoothed


def _lerp_lng(a: float, b: float, t: float) -> float:
    """Shortest path linear interpolation for longitude across the antimeridian."""
    diff = b - a
    if diff > 180.0:
        diff -= 360.0
    elif diff < -180.0:
        diff += 360.0
    lng = a + diff * t
    if lng > 180.0:
        lng -= 360.0
    elif lng <= -180.0:
        lng += 360.0
    return lng


def chaikin_smooth(
    path: list[GlobeNode],
    iterations: int = 3,
    target_points: int = 60,
) -> list[GlobeNode]:
    """
    Chaikin corner-cutting algorithm — turns a sparse polyline of A* nodes
    into a dense, visually smooth curve without introducing new dependencies.

    Each iteration replaces every segment AB with two new points at the
    1/4 and 3/4 positions, doubling the point count and rounding all corners.
    After ``iterations`` passes the path is resampled to ``target_points``
    evenly-spaced intermediate nodes so the frontend always receives a
    predictable, dense waypoint array.

    Parameters
    ----------
    path:
        Keypoint list from smooth_path() (start … end).
    iterations:
        Number of Chaikin refinement passes.  3 passes on a 10-node path
        produces 80 points — more than enough for smooth 3D rendering.
    target_points:
        Final waypoint count after resampling.  Set to 0 to skip resampling
        and return the raw Chaikin output.

    Returns
    -------
    list[GlobeNode]
        Dense smoothed path.  Start and end nodes are always preserved exactly.
    """
    if len(path) < 2:
        return path

    pts = path  # work on the full list

    for _ in range(iterations):
        refined: list[GlobeNode] = [pts[0]]  # always keep start
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            # Q = 3/4 A + 1/4 B
            q_lat = 0.75 * a.lat + 0.25 * b.lat
            q_lng = _lerp_lng(a.lng, b.lng, 0.25)
            q_cost = 0.75 * a.cost + 0.25 * b.cost
            # R = 1/4 A + 3/4 B
            r_lat = 0.25 * a.lat + 0.75 * b.lat
            r_lng = _lerp_lng(a.lng, b.lng, 0.75)
            r_cost = 0.25 * a.cost + 0.75 * b.cost
            refined.append(GlobeNode(lat=q_lat, lng=q_lng, cost=q_cost))
            refined.append(GlobeNode(lat=r_lat, lng=r_lng, cost=r_cost))
        refined.append(pts[-1])  # always keep end
        pts = refined

    if target_points <= 0 or len(pts) <= target_points:
        return pts

    # Resample to ``target_points`` evenly spaced along the cumulative arc.
    # Build cumulative arc-length table.
    cum: list[float] = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + haversine_unit(
            pts[i - 1].lat, pts[i - 1].lng,
            pts[i].lat, pts[i].lng,
        ))
    total_arc = cum[-1]
    if total_arc == 0.0:
        return pts

    resampled: list[GlobeNode] = [pts[0]]
    j = 0
    for k in range(1, target_points - 1):
        s = total_arc * k / (target_points - 1)
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg_len = cum[j + 1] - cum[j]
        t = (s - cum[j]) / seg_len if seg_len > 0 else 0.0
        a, b = pts[j], pts[j + 1]
        resampled.append(GlobeNode(
            lat=a.lat + t * (b.lat - a.lat),
            lng=_lerp_lng(a.lng, b.lng, t),
            cost=a.cost + t * (b.cost - a.cost),
        ))
    resampled.append(pts[-1])
    return resampled


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
            raw_path: list[GlobeNode] = []
            entry: Optional[AStarEntry] = current
            while entry is not None:
                raw_path.append(entry.node)
                entry = entry.parent
            raw_path.reverse()

            # ── Smoothing pass ─────────────────────────────────────────
            # 1. Remove collinear staircase artefacts.
            keypoints = smooth_path(raw_path)
            # 2. Chaikin corner-cutting: turns sparse keypoints into a
            #    dense, visually smooth 60-point curve that the frontend
            #    can render without any further interpolation.
            final_path = chaikin_smooth(keypoints, iterations=3, target_points=60)

            elapsed_ms = (time.perf_counter() - t0) * 1000
            return PathResult(
                path=final_path,
                iterations=iterations,
                nodes_explored=nodes_explored,
                computation_time_ms=round(elapsed_ms, 2),
                grid_rows=grid_rows,
                grid_cols=grid_cols,
            )

        # Expand neighbors.
        # haversine_unit computes the TRUE great-circle arc between any
        # two grid nodes, so diagonal neighbors already return a larger
        # value (~√2×) than orthogonal ones naturally.  No extra factor
        # is applied — adding _DIAG_FACTOR would double-penalize diagonals
        # and force the algorithm back into a staircase pattern.
        for neighbor, _ in _get_neighbors(current.node, grid, lat_step, lng_step):
            n_key = _node_key(neighbor)
            if n_key in closed_set:
                continue

            # True arc-distance between the two grid nodes × weather cost.
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

def compute_path_distance_km(path: list[GlobeNode], use_vincenty: bool = True) -> float:
    """Sum up distances along the path in km using Vincenty (default) or Haversine."""
    dist_fn = vincenty_km if use_vincenty else haversine_km
    total = 0.0
    for i in range(len(path) - 1):
        total += dist_fn(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng)
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
