"""Focused tests for the spherical grid and A* search engine."""

from app.pathfinding import WeatherZone, create_grid, find_path


def test_find_path_returns_metrics_and_endpoints():
    grid = create_grid(10.0, 10.0, [])

    result = find_path(10.0, 10.0, 30.0, 40.0, grid, 10.0, 10.0)

    assert result is not None
    assert result.path
    assert result.iterations > 0
    assert result.nodes_explored > 0
    assert result.computation_time_ms >= 0
    assert result.grid_rows == 19
    assert result.grid_cols == 36


def test_grid_applies_the_strongest_overlapping_weather_cost():
    grid = create_grid(
        10.0,
        10.0,
        [
            WeatherZone(lat=0.0, lng=0.0, radius=0.5, intensity=2.0),
            WeatherZone(lat=0.0, lng=0.0, radius=0.5, intensity=5.0),
        ],
    )

    assert grid[9][18].cost == 2.5


def test_iteration_limit_returns_empty_path_with_bounded_work():
    grid = create_grid(5.0, 5.0, [])

    result = find_path(0.0, 0.0, 80.0, 80.0, grid, 5.0, 5.0, max_iterations=1)

    assert result is not None
    assert result.path == []
    assert result.iterations == 1
