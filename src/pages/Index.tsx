import { useState, useCallback, useEffect, useRef } from 'react';
import { Scene } from '@/components/Scene';
import { HUD } from '@/components/HUD';
import { GlobeNode, WeatherZone } from '@/lib/astar';
import { defaultWeatherZones, majorCities } from '@/lib/weatherData';
import {
  calculatePath,
  getConstraints,
  saveRoute,
  getRouteHistory,
  checkHealth,
  ApiError,
  type PathCalculateResponse,
  type ComputationMetrics,
  type FlightStatsResponse,
  type RouteHistoryItem,
  type ActiveConstraint,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAStarWorker } from '@/hooks/useAStarWorker';

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
  const { computePath } = useAStarWorker();
  const calculationIdRef = useRef(0);

  // ─── Check backend connectivity on mount ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await checkHealth();
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

  const fallbackCompute = useCallback(
    async (
      startCity: { lat: number; lng: number },
      endCity: { lat: number; lng: number },
      requestId: number,
    ) => {
      const result = await computePath(
        startCity.lat,
        startCity.lng,
        endCity.lat,
        endCity.lng,
        showWeather ? weatherZones : [],
        LAT_STEP,
        LNG_STEP,
      );

      if (requestId !== calculationIdRef.current) return;
      setPath(result);
      setBackendMetrics(null);
      setBackendFlightStats(null);
    },
    [computePath, showWeather, weatherZones],
  );

  // ─── Path computation (backend or fallback) ───────────────────────
  useEffect(() => {
    const requestId = ++calculationIdRef.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && requestId === calculationIdRef.current;

    if (!selectedStart || !selectedEnd) {
      setIsComputing(false);
      setPath([]);
      setBackendMetrics(null);
      setBackendFlightStats(null);
      return () => { cancelled = true; };
    }

    const startCity = majorCities.find((c) => c.name === selectedStart);
    const endCity = majorCities.find((c) => c.name === selectedEnd);
    if (!startCity || !endCity) {
      setIsComputing(false);
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    const runCalculation = async () => {
      setIsComputing(true);
      try {
        if (USE_BACKEND && backendAvailable) {
          const constraints: ActiveConstraint[] = showWeather
            ? weatherZones.map((z) => ({
              lat: z.lat,
              lng: z.lng,
              radius: z.radius,
              intensity: z.intensity,
              label: z.label,
            }))
            : [];

          try {
            const response: PathCalculateResponse = await calculatePath(
              { lat: startCity.lat, lng: startCity.lng },
              { lat: endCity.lat, lng: endCity.lng },
              constraints,
              LAT_STEP,
              LNG_STEP,
              abortController.signal,
            );
            if (!isCurrent()) return;

            if (response.status === 'ok' && response.path.length > 0) {
              setPath(response.path.map((wp) => ({
                lat: wp.lat,
                lng: wp.lng,
                cost: wp.cost,
              })));
              setBackendMetrics(response.metrics);
              setBackendFlightStats(response.flight_stats);
            } else {
              await fallbackCompute(startCity, endCity, requestId);
              if (isCurrent()) {
                toast({
                  title: 'Path obstructed',
                  description: response.message || 'No valid path found around constraints.',
                  variant: 'destructive',
                });
              }
            }
          } catch (err) {
            if (!isCurrent()) return;
            console.warn('Backend path calculation failed, using local worker:', err);
            await fallbackCompute(startCity, endCity, requestId);
            if (isCurrent() && err instanceof ApiError) {
              toast({
                title: 'Server computation failed',
                description: err.userMessage,
                variant: 'destructive',
              });
            }
          }
        } else {
          await fallbackCompute(startCity, endCity, requestId);
        }
      } catch (err) {
        if (isCurrent()) {
          setPath([]);
          console.warn('Local worker path calculation failed:', err);
          toast({
            title: 'Path calculation failed',
            description: 'The local routing worker could not calculate this path.',
            variant: 'destructive',
          });
        }
      } finally {
        if (isCurrent()) setIsComputing(false);
      }
    };

    void runCalculation();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [selectedStart, selectedEnd, backendAvailable, showWeather, weatherZones, fallbackCompute, toast]);

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
