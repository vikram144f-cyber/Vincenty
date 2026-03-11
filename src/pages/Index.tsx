import { useState, useCallback, useMemo, useEffect } from 'react';
import { Scene } from '@/components/Scene';
import { HUD } from '@/components/HUD';
import { createGrid, findPath, GlobeNode, WeatherZone } from '@/lib/astar';
import { defaultWeatherZones, majorCities } from '@/lib/weatherData';
import {
  calculatePath,
  getConstraints,
  saveRoute,
  getRouteHistory,
  type PathCalculateResponse,
  type ComputationMetrics,
  type FlightStatsResponse,
  type RouteHistoryItem,
  type ActiveConstraint,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const LAT_STEP = 5;
const LNG_STEP = 5;

/**
 * Determines whether to use the backend API for pathfinding.
 * Falls back to client-side computation if the backend is unreachable.
 */
const USE_BACKEND = true;

const Index = () => {
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const [showWeather, setShowWeather] = useState(true);
  const [clickedLatLng, setClickedLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [path, setPath] = useState<GlobeNode[]>([]);
  const [selectMode, setSelectMode] = useState<'start' | 'end'>('start');
  const [weatherTime, setWeatherTime] = useState(0);

  // Backend-driven state
  const [isComputing, setIsComputing] = useState(false);
  const [backendMetrics, setBackendMetrics] = useState<ComputationMetrics | null>(null);
  const [backendFlightStats, setBackendFlightStats] = useState<FlightStatsResponse | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [routeHistory, setRouteHistory] = useState<RouteHistoryItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Active weather constraints (from backend or defaults)
  const [weatherZones, setWeatherZones] = useState<WeatherZone[]>(defaultWeatherZones);

  const { toast } = useToast();

  // ─── Check backend connectivity on mount ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/health`
        );
        if (resp.ok) {
          setBackendAvailable(true);
          // Fetch constraints from backend
          try {
            const data = await getConstraints();
            if (data.constraints?.length) {
              setWeatherZones(
                data.constraints.map((c) => ({
                  lat: c.lat,
                  lng: c.lng,
                  radius: c.radius,
                  intensity: c.intensity,
                  label: c.label || c.name,
                }))
              );
            }
          } catch {
            // Use defaults silently
          }
          // Fetch route history
          try {
            const history = await getRouteHistory(20);
            setRouteHistory(history.routes);
          } catch {
            // Ignore — history is optional
          }
        } else {
          setBackendAvailable(false);
        }
      } catch {
        setBackendAvailable(false);
      }
    })();
  }, []);

  // Animate weather time for drifting clouds
  useEffect(() => {
    const interval = setInterval(() => {
      setWeatherTime((t) => t + 0.016);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Client-side grid (used as fallback)
  const grid = useMemo(
    () => createGrid(LAT_STEP, LNG_STEP, showWeather ? weatherZones : []),
    [showWeather, weatherZones]
  );

  // ─── Path computation (backend or fallback) ───────────────────────
  useEffect(() => {
    if (!selectedStart || !selectedEnd) {
      setPath([]);
      setBackendMetrics(null);
      setBackendFlightStats(null);
      return;
    }

    const startCity = majorCities.find((c) => c.name === selectedStart);
    const endCity = majorCities.find((c) => c.name === selectedEnd);
    if (!startCity || !endCity) return;

    // Attempt backend calculation
    if (USE_BACKEND && backendAvailable) {
      setIsComputing(true);

      const constraints: ActiveConstraint[] = showWeather
        ? weatherZones.map((z) => ({
          lat: z.lat,
          lng: z.lng,
          radius: z.radius,
          intensity: z.intensity,
          label: z.label,
        }))
        : [];

      calculatePath(
        { lat: startCity.lat, lng: startCity.lng },
        { lat: endCity.lat, lng: endCity.lng },
        constraints,
        LAT_STEP,
        LNG_STEP
      )
        .then((response: PathCalculateResponse) => {
          if (response.status === 'ok' && response.path.length > 0) {
            setPath(
              response.path.map((wp) => ({
                lat: wp.lat,
                lng: wp.lng,
                cost: wp.cost,
              }))
            );
            setBackendMetrics(response.metrics);
            setBackendFlightStats(response.flight_stats);
          } else {
            // Backend returned no path — fallback
            fallbackCompute(startCity, endCity);
            toast({
              title: 'Path obstructed',
              description:
                response.message || 'No valid path found around constraints.',
              variant: 'destructive',
            });
          }
        })
        .catch((err) => {
          console.warn('Backend path calculation failed, using fallback:', err);
          fallbackCompute(startCity, endCity);
        })
        .finally(() => setIsComputing(false));
    } else {
      // Client-side fallback
      fallbackCompute(startCity, endCity);
    }
  }, [selectedStart, selectedEnd, grid, backendAvailable, showWeather, weatherZones]);

  function fallbackCompute(
    startCity: { lat: number; lng: number },
    endCity: { lat: number; lng: number }
  ) {
    const result = findPath(
      startCity.lat,
      startCity.lng,
      endCity.lat,
      endCity.lng,
      grid,
      LAT_STEP,
      LNG_STEP
    );
    setPath(result || []);
    setBackendMetrics(null);
    setBackendFlightStats(null);
  }

  // ─── Save route ───────────────────────────────────────────────────
  const handleSaveRoute = useCallback(async () => {
    if (!selectedStart || !selectedEnd || path.length < 2) return;
    if (!backendAvailable) {
      toast({
        title: 'Backend unavailable',
        description: 'Cannot save routes while the backend is offline.',
        variant: 'destructive',
      });
      return;
    }

    const startCity = majorCities.find((c) => c.name === selectedStart);
    const endCity = majorCities.find((c) => c.name === selectedEnd);
    if (!startCity || !endCity) return;

    setIsSaving(true);
    try {
      await saveRoute({
        start_city: selectedStart,
        end_city: selectedEnd,
        start: { lat: startCity.lat, lng: startCity.lng },
        end: { lat: endCity.lat, lng: endCity.lng },
        path: path.map((p) => ({ lat: p.lat, lng: p.lng, cost: p.cost })),
        geodesic_km: backendFlightStats?.geodesic_km,
        optimized_km: backendFlightStats?.optimized_km,
        detour_percent: backendFlightStats?.detour_percent,
        estimated_hours: backendFlightStats?.estimated_hours,
        fuel_kg: backendFlightStats?.fuel_kg,
        co2_kg: backendFlightStats?.co2_kg,
        computation_time_ms: backendMetrics?.computation_time_ms,
      });

      toast({
        title: 'Route saved ✓',
        description: `${selectedStart} → ${selectedEnd} saved successfully.`,
      });

      // Refresh history
      const history = await getRouteHistory(20);
      setRouteHistory(history.routes);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [selectedStart, selectedEnd, path, backendAvailable, backendFlightStats, backendMetrics, toast]);

  // ─── Click handler ────────────────────────────────────────────────
  const handlePointClick = useCallback(
    (lat: number, lng: number) => {
      setClickedLatLng({ lat, lng });

      let nearest: (typeof majorCities)[0] | null = null;
      let minDist = Infinity;
      for (const city of majorCities) {
        const d = Math.sqrt((city.lat - lat) ** 2 + (city.lng - lng) ** 2);
        if (d < minDist && d < 15) {
          minDist = d;
          nearest = city;
        }
      }

      if (nearest) {
        if (selectMode === 'start') {
          setSelectedStart(nearest.name);
          setSelectMode('end');
        } else {
          setSelectedEnd(nearest.name);
          setSelectMode('start');
        }
      }
    },
    [selectMode]
  );

  const handleClear = useCallback(() => {
    setSelectedStart(null);
    setSelectedEnd(null);
    setPath([]);
    setClickedLatLng(null);
    setSelectMode('start');
    setBackendMetrics(null);
    setBackendFlightStats(null);
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-background">
      <Scene
        onPointClick={handlePointClick}
        showWeather={showWeather}
        weatherZones={weatherZones}
        path={path}
        selectedStart={selectedStart}
        selectedEnd={selectedEnd}
        weatherTime={weatherTime}
      />
      <HUD
        selectedStart={selectedStart}
        selectedEnd={selectedEnd}
        onSelectStart={setSelectedStart}
        onSelectEnd={setSelectedEnd}
        showWeather={showWeather}
        onToggleWeather={() => setShowWeather((s) => !s)}
        clickedLatLng={clickedLatLng}
        path={path}
        onClear={handleClear}
        selectMode={selectMode}
        onToggleMode={() => setSelectMode((m) => (m === 'start' ? 'end' : 'start'))}
        isComputing={isComputing}
        backendAvailable={backendAvailable}
        backendMetrics={backendMetrics}
        backendFlightStats={backendFlightStats}
        onSaveRoute={handleSaveRoute}
        isSaving={isSaving}
        routeHistory={routeHistory}
      />
    </div>
  );
};

export default Index;
