/**
 * useAStarWorker.ts
 *
 * React hook that runs A* pathfinding inside a WebWorker.
 *
 * Usage
 * ──────
 * const { computePath, computing, source } = useAStarWorker();
 * const path = await computePath(startLat, startLng, endLat, endLng, zones);
 *
 * The hook manages the worker lifecycle (create once, terminate on unmount).
 * Results are returned as a Promise so callers can await them naturally.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { GlobeNode, WeatherZone } from '@/lib/astar';

export type PathSource = 'SERVER' | 'LOCAL_WORKER';

interface WorkerResult {
  path: GlobeNode[];
  computationTimeMs: number;
  source: 'LOCAL_WORKER';
}

type Resolve = (value: GlobeNode[]) => void;
type Reject  = (reason: string) => void;

interface UseAStarWorkerReturn {
  /** Runs A* in the worker; resolves with the smoothed path array. */
  computePath: (
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    weatherZones: WeatherZone[],
    latStep?: number,
    lngStep?: number,
  ) => Promise<GlobeNode[]>;

  /** True while the worker is currently processing a request. */
  computing: boolean;

  /** Source of the most recent path result. */
  source: PathSource;
}

export function useAStarWorker(): UseAStarWorkerReturn {
  const workerRef   = useRef<Worker | null>(null);
  const resolveRef  = useRef<Resolve | null>(null);
  const rejectRef   = useRef<Reject  | null>(null);
  const [computing, setComputing] = useState(false);
  const [source, setSource]       = useState<PathSource>('SERVER');

  useEffect(() => {
    // Vite exposes ?worker so the import is a constructor, not a URL
    const worker = new Worker(
      new URL('../workers/astarWorker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<{ type: string; payload: WorkerResult | string }>) => {
      setComputing(false);
      if (e.data.type === 'RESULT') {
        setSource('LOCAL_WORKER');
        resolveRef.current?.((e.data.payload as WorkerResult).path);
      } else {
        rejectRef.current?.(e.data.payload as string);
      }
      resolveRef.current = null;
      rejectRef.current  = null;
    };

    worker.onerror = (err) => {
      setComputing(false);
      rejectRef.current?.(err.message);
      resolveRef.current = null;
      rejectRef.current  = null;
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const computePath = useCallback(
    (
      startLat: number, startLng: number,
      endLat: number,   endLng: number,
      weatherZones: WeatherZone[],
      latStep = 5, lngStep = 5,
    ): Promise<GlobeNode[]> => {
      return new Promise<GlobeNode[]>((resolve, reject) => {
        if (!workerRef.current) {
          reject('WebWorker not initialized');
          return;
        }
        resolveRef.current = resolve;
        rejectRef.current  = reject;
        setComputing(true);
        workerRef.current.postMessage({
          type: 'CALCULATE',
          payload: { startLat, startLng, endLat, endLng, weatherZones, latStep, lngStep },
        });
      });
    },
    [],
  );

  return { computePath, computing, source };
}
