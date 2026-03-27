/**
 * API client for the Orbit Path Painter backend.
 *
 * All backend communication is centralized here.
 * Uses VITE_API_URL environment variable to resolve the backend origin.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Configuration ──────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 800;

// ─── Types ──────────────────────────────────────────────────────────

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface PathWaypoint {
  lat: number;
  lng: number;
  cost: number;
}

export interface ActiveConstraint {
  lat: number;
  lng: number;
  radius: number;
  intensity: number;
  label?: string;
}

export interface ComputationMetrics {
  iterations: number;
  nodes_explored: number;
  computation_time_ms: number;
  grid_size: string;
  formula_used?: string;
}

export interface FlightStatsResponse {
  geodesic_km: number;
  optimized_km: number;
  detour_percent: number;
  estimated_hours: number;
  geodesic_hours: number;
  fuel_kg: number;
  geodesic_fuel_kg: number;
  co2_kg: number;
  geodesic_co2_kg: number;
  fuel_saved_kg: number;
  net_savings_percent: number;
  cruise_altitude: number;
  cruise_speed: number;
  aircraft_name: string;
  in_range: boolean;
}

export interface PathCalculateResponse {
  path: PathWaypoint[];
  total_distance_km: number;
  geodesic_distance_km: number;
  flight_stats: FlightStatsResponse;
  metrics: ComputationMetrics;
  status: string;
  message?: string;
}

export interface EnvironmentConstraintData {
  id: string;
  name: string;
  constraint_type: string;
  lat: number;
  lng: number;
  radius: number;
  intensity: number;
  label: string;
  is_active: boolean;
}

export interface ConstraintsResponse {
  constraints: EnvironmentConstraintData[];
  source: string;
  total: number;
}

export interface RouteSaveRequest {
  name?: string;
  start_city: string;
  end_city: string;
  start: Coordinate;
  end: Coordinate;
  path: PathWaypoint[];
  geodesic_km?: number;
  optimized_km?: number;
  detour_percent?: number;
  estimated_hours?: number;
  fuel_kg?: number;
  co2_kg?: number;
  computation_time_ms?: number;
  constraints_active?: string[];
}

export interface RouteHistoryItem {
  id: string;
  name: string | null;
  start_city: string;
  end_city: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  geodesic_km: number | null;
  optimized_km: number | null;
  detour_percent: number | null;
  estimated_hours: number | null;
  fuel_kg: number | null;
  co2_kg: number | null;
  waypoint_count: number | null;
  computation_time_ms: number | null;
  created_at: string;
}

export interface RouteHistoryResponse {
  routes: RouteHistoryItem[];
  total: number;
}

// ─── Error Classes ──────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  detail: unknown;
  isNetworkError: boolean;

  constructor(message: string, status: number, detail?: unknown, isNetworkError = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.isNetworkError = isNetworkError;
  }

  /** Friendly message for toast notifications. */
  get userMessage(): string {
    if (this.isNetworkError) return "Cannot reach the flight computation server. Using local fallback.";
    if (this.status === 422) return "No valid path found — weather constraints may completely block the route.";
    if (this.status === 500) return "Server encountered an internal error. Please try again.";
    if (this.status === 0) return "Network connection lost. Check your internet and try again.";
    return this.message;
  }
}

// ─── API Client ─────────────────────────────────────────────────────

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const config: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: controller.signal,
    ...options,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }
      throw new ApiError(
        `API ${response.status}: ${response.statusText}`,
        response.status,
        detail,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // Retry on network errors with exponential backoff
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    const isNetworkError = !isAbort;

    if (isNetworkError && retries > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (MAX_RETRIES - retries + 1)));
      return request<T>(endpoint, options, retries - 1);
    }

    throw new ApiError(
      isAbort
        ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Network error: Could not reach backend at ${API_BASE}`,
      0,
      error,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Endpoint Functions ─────────────────────────────────────────────

/**
 * POST /api/path/calculate
 * Calculate optimized geodesic path with constraint avoidance.
 */
export async function calculatePath(
  start: Coordinate,
  end: Coordinate,
  constraints: ActiveConstraint[],
  latStep = 5,
  lngStep = 5,
): Promise<PathCalculateResponse> {
  return request<PathCalculateResponse>("/api/path/calculate", {
    method: "POST",
    body: JSON.stringify({
      start,
      end,
      constraints,
      lat_step: latStep,
      lng_step: lngStep,
    }),
  });
}

/**
 * GET /api/environment/constraints
 * Fetch active environmental constraint zones.
 */
export async function getConstraints(): Promise<ConstraintsResponse> {
  return request<ConstraintsResponse>("/api/environment/constraints");
}

/**
 * POST /api/routes/save
 * Save a computed route.
 */
export async function saveRoute(
  data: RouteSaveRequest,
): Promise<{ id: string; message: string }> {
  return request<{ id: string; message: string }>("/api/routes/save", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * GET /api/routes/history
 * Retrieve saved route history.
 */
export async function getRouteHistory(
  limit = 50,
  offset = 0,
): Promise<RouteHistoryResponse> {
  return request<RouteHistoryResponse>(
    `/api/routes/history?limit=${limit}&offset=${offset}`,
  );
}

/**
 * GET /health
 * Check backend connectivity.
 */
export async function checkHealth(): Promise<{
  status: string;
  database: string;
}> {
  return request<{ status: string; database: string }>("/health");
}
