import { majorCities, haversineKm, computeFlightStats } from '@/lib/weatherData';
import { GlobeNode } from '@/lib/astar';
import { useMemo } from 'react';
import type { ComputationMetrics, FlightStatsResponse, RouteHistoryItem } from '@/lib/api';

interface HUDProps {
  selectedStart: string | null;
  selectedEnd: string | null;
  onSelectStart: (city: string) => void;
  onSelectEnd: (city: string) => void;
  showWeather: boolean;
  onToggleWeather: () => void;
  clickedLatLng: { lat: number; lng: number } | null;
  path: GlobeNode[];
  onClear: () => void;
  selectMode: 'start' | 'end';
  onToggleMode: () => void;
  // Backend integration props
  isComputing?: boolean;
  backendAvailable?: boolean | null;
  backendMetrics?: ComputationMetrics | null;
  backendFlightStats?: FlightStatsResponse | null;
  onSaveRoute?: () => void;
  isSaving?: boolean;
  routeHistory?: RouteHistoryItem[];
}

export function HUD({
  selectedStart,
  selectedEnd,
  onSelectStart,
  onSelectEnd,
  showWeather,
  onToggleWeather,
  clickedLatLng,
  path,
  onClear,
  selectMode,
  onToggleMode,
  isComputing = false,
  backendAvailable = null,
  backendMetrics = null,
  backendFlightStats = null,
  onSaveRoute,
  isSaving = false,
  routeHistory = [],
}: HUDProps) {
  // Use backend flight stats if available, else compute client-side
  const flightStats = useMemo(() => {
    if (backendFlightStats && path.length >= 2) {
      return {
        geodesicKm: backendFlightStats.geodesic_km,
        astarKm: backendFlightStats.optimized_km,
        detourPercent: String(backendFlightStats.detour_percent),
        estimatedHours: String(backendFlightStats.estimated_hours),
        geodesicHours: String(backendFlightStats.geodesic_hours),
        fuelKg: backendFlightStats.fuel_kg,
        geodesicFuelKg: backendFlightStats.geodesic_fuel_kg,
        co2Kg: backendFlightStats.co2_kg,
        geodesicCo2Kg: backendFlightStats.geodesic_co2_kg,
        fuelSavedKg: backendFlightStats.fuel_saved_kg,
        netSavingsPercent: String(backendFlightStats.net_savings_percent),
        cruiseAltitude: backendFlightStats.cruise_altitude,
        cruiseSpeed: backendFlightStats.cruise_speed,
        aircraftName: backendFlightStats.aircraft_name,
        inRange: backendFlightStats.in_range,
      };
    }

    if (!selectedStart || !selectedEnd || path.length < 2) return null;

    const startCity = majorCities.find((c) => c.name === selectedStart);
    const endCity = majorCities.find((c) => c.name === selectedEnd);
    if (!startCity || !endCity) return null;

    const geodesicKm = haversineKm(startCity.lat, startCity.lng, endCity.lat, endCity.lng);
    let astarKm = 0;
    for (let i = 0; i < path.length - 1; i++) {
      astarKm += haversineKm(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng);
    }

    return computeFlightStats(geodesicKm, astarKm);
  }, [selectedStart, selectedEnd, path, backendFlightStats]);

  // Group cities by region
  const cityGroups = useMemo(() => {
    const groups: Record<string, typeof majorCities> = {};
    for (const city of majorCities) {
      if (!groups[city.region]) groups[city.region] = [];
      groups[city.region].push(city);
    }
    return groups;
  }, []);

  const selectedStartCity = majorCities.find(c => c.name === selectedStart);
  const selectedEndCity = majorCities.find(c => c.name === selectedEnd);

  return (
    <div className="fixed inset-0 pointer-events-none z-10">
      {/* Title bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="hud-panel px-4 sm:px-8 py-3 pointer-events-auto flex items-center gap-2 sm:gap-4">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <h1 className="text-[10px] sm:text-base font-bold font-display tracking-[0.12em] sm:tracking-[0.2em] text-foreground whitespace-nowrap">
            VINCENTY <span className="text-primary">GEODESIC ROUTING LAB</span>
          </h1>
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          {/* Backend status indicator */}
          <div className="flex items-center gap-1.5 ml-2 pl-3 border-l" style={{ borderColor: 'hsl(var(--border))' }}>
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${backendAvailable === true
                  ? 'bg-accent'
                  : backendAvailable === false
                    ? 'bg-destructive'
                    : 'bg-muted-foreground animate-pulse'
                }`}
            />
            <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider">
              {backendAvailable === true
                ? 'API ONLINE'
                : backendAvailable === false
                  ? 'OFFLINE'
                  : 'CHECKING…'}
            </span>
          </div>
        </div>
      </div>

      {/* Left panel */}
      <div className="absolute top-20 left-4 w-72 space-y-3 pointer-events-auto max-h-[calc(100vh-120px)] overflow-y-auto scrollbar-thin hud-left-panel">
        {/* Route */}
        <div className="hud-panel p-4 space-y-3">
          <div className="hud-label flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full" />
            Route Selection
          </div>

          <div className="space-y-1.5">
            <label className="hud-label text-[9px]">Origin</label>
            <select
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all duration-300"
              value={selectedStart || ''}
              onChange={(e) => onSelectStart(e.target.value)}
            >
              <option value="">Select origin...</option>
              {Object.entries(cityGroups).map(([region, cities]) => (
                <optgroup key={region} label={region}>
                  {cities.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.iata})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedStartCity && (
              <div className="text-[9px] font-mono text-muted-foreground transition-opacity duration-300">
                {selectedStartCity.iata} · {selectedStartCity.lat.toFixed(2)}°N, {Math.abs(selectedStartCity.lng).toFixed(2)}°{selectedStartCity.lng >= 0 ? 'E' : 'W'}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="hud-label text-[9px]">Destination</label>
            <select
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all duration-300"
              value={selectedEnd || ''}
              onChange={(e) => onSelectEnd(e.target.value)}
            >
              <option value="">Select destination...</option>
              {Object.entries(cityGroups).map(([region, cities]) => (
                <optgroup key={region} label={region}>
                  {cities.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.iata})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedEndCity && (
              <div className="text-[9px] font-mono text-muted-foreground transition-opacity duration-300">
                {selectedEndCity.iata} · {selectedEndCity.lat.toFixed(2)}°N, {Math.abs(selectedEndCity.lng).toFixed(2)}°{selectedEndCity.lng >= 0 ? 'E' : 'W'}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button className="hud-button flex-1" onClick={onClear}>
              ✕ Clear
            </button>
            {onSaveRoute && path.length >= 2 && (
              <button
                className={`hud-button flex-1 ${isSaving ? 'opacity-60' : ''}`}
                onClick={onSaveRoute}
                disabled={isSaving || !backendAvailable}
                title={!backendAvailable ? 'Backend required to save routes' : ''}
              >
                {isSaving ? '⏳ Saving…' : '💾 Save'}
              </button>
            )}
          </div>
        </div>

        {/* Click mode */}
        <div className="hud-panel p-4 space-y-2">
          <div className="hud-label flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-accent rounded-full" />
            Click-to-Set
          </div>
          <button
            className={`hud-button w-full ${selectMode === 'start' ? 'active' : ''}`}
            onClick={onToggleMode}
          >
            {selectMode === 'start' ? '🟢 Setting: ORIGIN' : '🔴 Setting: DESTINATION'}
          </button>
          <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
            Click any point on the globe or near a city pin
          </p>
        </div>

        {/* Weather */}
        <div className="hud-panel p-4 space-y-3">
          <div className="hud-label flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-cost-high rounded-full animate-pulse" />
            Weather Systems
          </div>
          <button
            className={`hud-button w-full ${showWeather ? 'active' : ''}`}
            onClick={onToggleWeather}
          >
            {showWeather ? '🌩️ Weather: ACTIVE' : '☀️ Weather: OFF'}
          </button>

          {showWeather && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-cost-high animate-pulse" />
                <span className="text-[10px] font-mono text-muted-foreground">Severe (Cat 4-5 Storm)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-cost-medium" />
                <span className="text-[10px] font-mono text-muted-foreground">Moderate (Turbulence/Wind)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-cost-low" />
                <span className="text-[10px] font-mono text-muted-foreground">Light (CAT / Dust)</span>
              </div>
            </div>
          )}
        </div>

        {/* Route History */}
        {routeHistory.length > 0 && (
          <div className="hud-panel p-4 space-y-3">
            <div className="hud-label flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full" />
              Saved Routes ({routeHistory.length})
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
              {routeHistory.slice(0, 8).map((route) => (
                <div
                  key={route.id}
                  className="p-2 rounded-md cursor-pointer transition-all duration-300 hover:border-primary hover:shadow-[0_0_12px_hsl(200_95%_55%/0.15)]"
                  style={{ background: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}
                  onClick={() => {
                    onSelectStart(route.start_city);
                    onSelectEnd(route.end_city);
                  }}
                >
                  <div className="text-[10px] font-mono font-semibold text-foreground truncate">
                    {route.start_city} → {route.end_city}
                  </div>
                  <div className="flex gap-3 mt-0.5">
                    {route.optimized_km && (
                      <span className="text-[8px] font-mono text-muted-foreground">
                        {Math.round(route.optimized_km).toLocaleString()} km
                      </span>
                    )}
                    {route.estimated_hours && (
                      <span className="text-[8px] font-mono text-muted-foreground">
                        {route.estimated_hours.toFixed(1)}h
                      </span>
                    )}
                    <span className="text-[8px] font-mono text-muted-foreground">
                      {new Date(route.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — Flight Dashboard */}
      <div className="absolute top-20 right-4 w-80 space-y-3 pointer-events-auto max-h-[calc(100vh-120px)] overflow-y-auto scrollbar-thin hud-right-panel">
        {/* Computing indicator with skeleton loader */}
        {isComputing && (
          <div className="hud-panel p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
              <div>
                <div className="text-[11px] font-mono font-semibold text-primary">
                  COMPUTING PATH…
                </div>
                <div className="text-[9px] font-mono text-muted-foreground">
                  A* pathfinding with Vincenty precision
                </div>
              </div>
            </div>
            <div className="progress-indeterminate" />
            {/* Skeleton loaders for flight data */}
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-16 rounded-md" />
              <div className="skeleton h-16 rounded-md" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="skeleton h-12 rounded-md" />
              <div className="skeleton h-12 rounded-md" />
              <div className="skeleton h-12 rounded-md" />
            </div>
          </div>
        )}

        {/* Coordinates */}
        {clickedLatLng && (
          <div className="hud-panel p-4 space-y-2">
            <div className="hud-label flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full" />
              Raycast Coordinates
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="hud-label text-[9px]">Latitude</div>
                <div className="hud-value text-base">{clickedLatLng.lat.toFixed(3)}°</div>
              </div>
              <div>
                <div className="hud-label text-[9px]">Longitude</div>
                <div className="hud-value text-base">{clickedLatLng.lng.toFixed(3)}°</div>
              </div>
            </div>
          </div>
        )}

        {/* Flight Comparison Dashboard */}
        {flightStats && !isComputing && (
          <div className="hud-panel p-4 space-y-3">
            <div className="hud-label flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-accent rounded-full" />
              Flight Analysis
            </div>

            {/* Aircraft */}
            <div className="p-2.5 rounded-md" style={{ background: 'hsl(var(--secondary))' }}>
              <div className="hud-label text-[8px] mb-0.5">Aircraft</div>
              <div className="text-[11px] font-mono font-semibold text-foreground">{flightStats.aircraftName}</div>
              <div className="flex gap-3 mt-1">
                <span className="text-[9px] font-mono text-muted-foreground">FL{Math.round(flightStats.cruiseAltitude / 100)}</span>
                <span className="text-[9px] font-mono text-muted-foreground">M 0.85</span>
                <span className="text-[9px] font-mono text-muted-foreground">{flightStats.cruiseSpeed} km/h</span>
              </div>
            </div>

            {/* Route comparison */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 p-2.5 rounded-md transition-all duration-300" style={{ background: 'hsl(var(--secondary))' }}>
                <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider block">Geodesic</span>
                <div className="hud-value text-sm">{flightStats.geodesicKm.toLocaleString()} km</div>
                <div className="text-[9px] font-mono text-muted-foreground">{flightStats.geodesicHours}h flight</div>
              </div>
              <div className="space-y-1 p-2.5 rounded-md border transition-all duration-300" style={{ background: 'hsl(var(--primary) / 0.05)', borderColor: 'hsl(var(--primary) / 0.2)' }}>
                <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider block">
                  Optimized <span className="cost-medium">+{flightStats.detourPercent}%</span>
                </span>
                <div className="hud-value text-sm">{flightStats.astarKm.toLocaleString()} km</div>
                <div className="text-[9px] font-mono text-muted-foreground">{flightStats.estimatedHours}h flight</div>
              </div>
            </div>

            {/* Fuel & emissions */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded transition-all duration-300" style={{ background: 'hsl(var(--secondary))' }}>
                <div className="hud-label text-[7px]">Fuel</div>
                <div className="hud-value text-[11px]">{(flightStats.fuelKg / 1000).toFixed(1)}t</div>
              </div>
              <div className="p-2 rounded transition-all duration-300" style={{ background: 'hsl(var(--secondary))' }}>
                <div className="hud-label text-[7px]">CO₂</div>
                <div className="hud-value text-[11px]">{(flightStats.co2Kg / 1000).toFixed(1)}t</div>
              </div>
              <div className="p-2 rounded transition-all duration-300" style={{ background: 'hsl(var(--secondary))' }}>
                <div className="hud-label text-[7px]">Waypoints</div>
                <div className="hud-value text-[11px]">{path.length}</div>
              </div>
            </div>

            {/* Fuel impact */}
            <div className="p-3 rounded-md border transition-all duration-300" style={{ background: 'hsl(var(--accent) / 0.06)', borderColor: 'hsl(var(--accent) / 0.2)' }}>
              <div className="hud-label text-[9px] mb-1">⛽ Estimated Weather Effect</div>
              <p className="text-[11px] font-mono leading-relaxed" style={{ color: 'hsl(var(--accent))' }}>
                Estimated <span className="font-bold">{flightStats.fuelSavedKg.toLocaleString()} kg</span> fuel impact ({flightStats.netSavingsPercent}%) under the configured storm-penalty model
              </p>
            </div>

            {/* Backend computation metrics */}
            {backendMetrics && (
              <div className="p-2.5 rounded-md border transition-all duration-300" style={{ background: 'hsl(var(--primary) / 0.04)', borderColor: 'hsl(var(--primary) / 0.15)' }}>
                <div className="hud-label text-[8px] mb-1.5">⚡ Server Computation</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[8px] font-mono text-muted-foreground">Time</div>
                    <div className="text-[10px] font-mono font-semibold text-primary">{backendMetrics.computation_time_ms.toFixed(1)} ms</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-mono text-muted-foreground">Grid</div>
                    <div className="text-[10px] font-mono font-semibold text-primary">{backendMetrics.grid_size}</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-mono text-muted-foreground">Iterations</div>
                    <div className="text-[10px] font-mono font-semibold text-primary">{backendMetrics.iterations.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-mono text-muted-foreground">Formula</div>
                    <div className="text-[10px] font-mono font-semibold text-accent uppercase">{backendMetrics.formula_used || 'haversine'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Range check */}
            {!flightStats.inRange && (
              <div className="notification-error">
                <span className="text-[10px] font-mono font-semibold" style={{ color: 'hsl(var(--destructive))' }}>
                  ⚠ Exceeds max range — refueling stop required
                </span>
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <span className="hud-label text-[9px]">Status</span>
              <span className="text-[11px] font-mono font-semibold" style={{ color: 'hsl(var(--accent))' }}>
                ● PATH COMPUTED {backendMetrics ? '(SERVER)' : '(LOCAL)'}
              </span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!flightStats && !isComputing && (
          <div className="hud-panel p-4 space-y-2">
            <div className="hud-label">Flight Dashboard</div>
            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
              Select origin &amp; destination to compute a constraint-aware path with the configured Boeing 787-9 performance model.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
              <span className="text-[9px] font-mono text-muted-foreground">AWAITING INPUT</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="hud-panel px-8 py-2.5 flex items-center gap-6">
          <span className="text-[9px] font-mono text-muted-foreground tracking-wider">SCROLL zoom</span>
          <span className="text-[9px] text-border">|</span>
          <span className="text-[9px] font-mono text-muted-foreground tracking-wider">DRAG rotate</span>
          <span className="text-[9px] text-border">|</span>
          <span className="text-[9px] font-mono text-muted-foreground tracking-wider">CLICK set waypoint</span>
          <span className="text-[9px] text-border">|</span>
          <span className="text-[9px] font-mono tracking-wider" style={{ color: 'hsl(var(--primary))' }}>
            ── geodesic &nbsp; ━━ optimized
          </span>
        </div>
      </div>
    </div>
  );
}
