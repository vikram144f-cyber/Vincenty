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

interface WorkerResponse {
  type: 'RESULT' | 'ERROR';
  requestId: number;
  payload: WorkerResult | string;
}

interface PendingRequest {
  resolve: (value: GlobeNode[]) => void;
  reject: (reason: Error) => void;
}

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
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const nextRequestIdRef = useRef(0);
  const [computing, setComputing] = useState(false);
  const [source, setSource] = useState<PathSource>('SERVER');

  useEffect(() => {
    // Vite exposes ?worker so the import is a constructor, not a URL
    const worker = new Worker(
      new URL('../workers/astarWorker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const pending = pendingRef.current.get(e.data.requestId);
      if (!pending) return;

      pendingRef.current.delete(e.data.requestId);
      setComputing(pendingRef.current.size > 0);

      if (e.data.type === 'RESULT') {
        setSource('LOCAL_WORKER');
        pending.resolve((e.data.payload as WorkerResult).path);
      } else {
        pending.reject(new Error(e.data.payload as string));
      }
    };

    worker.onerror = (err) => {
      const pending = pendingRef.current;
      pendingRef.current = new Map();
      setComputing(false);
      for (const request of pending.values()) {
        request.reject(new Error(err.message || 'A* worker failed'));
      }
    };

    workerRef.current = worker;
    return () => {
      for (const request of pendingRef.current.values()) {
        request.reject(new Error('A* worker terminated'));
      }
      pendingRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const computePath = useCallback(
    (
      startLat: number, startLng: number,
      endLat: number,   endLng: number,
      weatherZones: WeatherZone[],
      latStep = 5, lngStep = 5,
    ): Promise<GlobeNode[]> => {
      return new Promise<GlobeNode[]>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error('WebWorker not initialized'));
          return;
        }
        const requestId = ++nextRequestIdRef.current;
        pendingRef.current.set(requestId, { resolve, reject });
        setComputing(true);
        try {
          worker.postMessage({
            type: 'CALCULATE',
            requestId,
            payload: { startLat, startLng, endLat, endLng, weatherZones, latStep, lngStep },
          });
        } catch (error) {
          pendingRef.current.delete(requestId);
          setComputing(pendingRef.current.size > 0);
          reject(error instanceof Error ? error : new Error('Could not start A* worker'));
        }
      });
    },
    [],
  );

  return { computePath, computing, source };
}
