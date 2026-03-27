/**
 * astarWorker.ts
 *
 * Offline A* pathfinding WebWorker.
 *
 * Runs the complete grid-building + A* search off the main thread so
 * the React render loop is never blocked when the FastAPI backend is
 * unreachable. The weather-cost formula mirrors the Python backend
 * exactly (soft log-cap at MAX_WEATHER_COST = 1.5) so offline paths
 * are visually consistent with server-generated paths.
 *
 * Message protocol
 * ──────────────────
 * Inbound  { type: 'CALCULATE', payload: WorkerRequest }
 * Outbound { type: 'RESULT',   payload: WorkerResult  }
 *          { type: 'ERROR',    payload: string         }
 */

// ─── Types (duplicated here so the worker is a fully self-contained module) ──

interface GlobeNode {
  lat: number;
  lng: number;
  cost: number;
}

interface WeatherZone {
  lat: number;
  lng: number;
  radius: number;
  intensity: number;
  label?: string;
}

interface WorkerRequest {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  weatherZones: WeatherZone[];
  latStep?: number;
  lngStep?: number;
}

interface WorkerResult {
  path: GlobeNode[];
  computationTimeMs: number;
  source: 'LOCAL_WORKER';
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Must match backend pathfinding.py MAX_WEATHER_COST */
const MAX_WEATHER_COST = 1.5;
const MAX_ITERATIONS = 50_000;

// ─── Haversine (unit sphere) ────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

// ─── Grid Construction (matches backend soft log-cap formula) ───────────────

function createGrid(
  latStep: number,
  lngStep: number,
  zones: WeatherZone[],
): GlobeNode[][] {
  const grid: GlobeNode[][] = [];
  for (let lat = -90; lat <= 90; lat += latStep) {
    const row: GlobeNode[] = [];
    for (let lng = -180; lng < 180; lng += lngStep) {
      let cost = 1.0;
      for (const zone of zones) {
        const d = haversine(lat, lng, zone.lat, zone.lng);
        if (d < zone.radius) {
          // Soft logarithmic penalty — mirrors backend Python exactly:
          //   1 + MAX_WEATHER_COST * intensity_frac * log2(1 + proximity)
          const proximity = 1.0 - d / zone.radius;       // [0, 1]
          const intensityFrac = Math.min(zone.intensity / 5.0, 1.0);
          const zoneCost = 1.0 + MAX_WEATHER_COST * intensityFrac * (Math.log1p(proximity) / Math.log(2));
          cost = Math.max(cost, zoneCost);
        }
      }
      row.push({ lat, lng, cost });
    }
    grid.push(row);
  }
  return grid;
}

// ─── Neighbor expansion (8-way, longitude wraps) ───────────────────────────

function getNeighbors(
  node: GlobeNode,
  grid: GlobeNode[][],
  latStep: number,
  lngStep: number,
): GlobeNode[] {
  const latIdx = Math.round((node.lat + 90) / latStep);
  const lngIdx = Math.round((node.lng + 180) / lngStep);
  const maxLat = grid.length;
  const maxLng = grid[0]?.length ?? 0;
  const neighbors: GlobeNode[] = [];

  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;
      const ni = latIdx + di;
      const nj = ((lngIdx + dj) + maxLng) % maxLng;
      if (ni >= 0 && ni < maxLat && grid[ni]?.[nj]) {
        neighbors.push(grid[ni][nj]);
      }
    }
  }
  return neighbors;
}

// ─── Bearing-based path smoother ───────────────────────────────────────────

function bearing(a: GlobeNode, b: GlobeNode): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d <= 180 ? d : 360 - d;
}

function smoothPath(path: GlobeNode[], threshDeg = 5.0): GlobeNode[] {
  if (path.length <= 2) return path;
  const out: GlobeNode[] = [path[0]];
  let prevBearing = bearing(path[0], path[1]);
  for (let i = 1; i < path.length - 1; i++) {
    const curr = bearing(path[i], path[i + 1]);
    if (angularDiff(prevBearing, curr) >= threshDeg) {
      out.push(path[i]);
      prevBearing = curr;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

// ─── Chaikin spline + arc-length resampling ────────────────────────────────

function chaikinSmooth(path: GlobeNode[], iterations = 3, targetPoints = 60): GlobeNode[] {
  if (path.length < 2) return path;
  let pts = path;

  for (let it = 0; it < iterations; it++) {
    const refined: GlobeNode[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      refined.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng, cost: 0.75 * a.cost + 0.25 * b.cost });
      refined.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng, cost: 0.25 * a.cost + 0.75 * b.cost });
    }
    refined.push(pts[pts.length - 1]);
    pts = refined;
  }

  if (targetPoints <= 0 || pts.length <= targetPoints) return pts;

  // Build cumulative arc-length table
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[cum.length - 1] + haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng));
  }
  const totalArc = cum[cum.length - 1];
  if (totalArc === 0) return pts;

  const resampled: GlobeNode[] = [pts[0]];
  let j = 0;
  for (let k = 1; k < targetPoints - 1; k++) {
    const s = (totalArc * k) / (targetPoints - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 0 ? (s - cum[j]) / segLen : 0;
    const a = pts[j], b = pts[j + 1];
    resampled.push({
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
      cost: a.cost + t * (b.cost - a.cost),
    });
  }
  resampled.push(pts[pts.length - 1]);
  return resampled;
}

// ─── A* Search ─────────────────────────────────────────────────────────────

interface AStarEntry {
  node: GlobeNode;
  g: number;
  f: number;
  parent: AStarEntry | null;
}

function nodeKey(n: GlobeNode): string {
  return `${n.lat.toFixed(1)},${n.lng.toFixed(1)}`;
}

function findPath(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
  grid: GlobeNode[][],
  latStep: number, lngStep: number,
): GlobeNode[] | null {
  const snap = (v: number, step: number, off: number) => Math.round((v - off) / step) * step + off;
  const sLat = snap(startLat, latStep, -90);
  const sLng = snap(startLng, lngStep, -180);
  const eLat = snap(endLat, latStep, -90);
  const eLng = snap(endLng, lngStep, -180);

  const sLatI = Math.round((sLat + 90) / latStep);
  const sLngI = Math.round((sLng + 180) / lngStep);
  const eLatI = Math.round((eLat + 90) / latStep);
  const eLngI = Math.round((eLng + 180) / lngStep);

  const start = grid[sLatI]?.[sLngI];
  const end   = grid[eLatI]?.[eLngI];
  if (!start || !end) return null;

  const endKey = nodeKey(end);
  const openMap = new Map<string, AStarEntry>();
  const closedSet = new Set<string>();
  const h0 = haversine(start.lat, start.lng, end.lat, end.lng);
  openMap.set(nodeKey(start), { node: start, g: 0, f: h0, parent: null });

  for (let iter = 0; iter < MAX_ITERATIONS && openMap.size > 0; iter++) {
    // Pop min-f node
    let current: AStarEntry | null = null;
    for (const entry of openMap.values()) {
      if (!current || entry.f < current.f) current = entry;
    }
    if (!current) break;

    const cKey = nodeKey(current.node);
    if (cKey === endKey) {
      // Reconstruct → smooth → spline
      const raw: GlobeNode[] = [];
      let e: AStarEntry | null = current;
      while (e) { raw.unshift(e.node); e = e.parent; }
      return chaikinSmooth(smoothPath(raw), 3, 60);
    }

    openMap.delete(cKey);
    closedSet.add(cKey);

    for (const nb of getNeighbors(current.node, grid, latStep, lngStep)) {
      const nKey = nodeKey(nb);
      if (closedSet.has(nKey)) continue;
      const tentG = current.g + haversine(current.node.lat, current.node.lng, nb.lat, nb.lng) * nb.cost;
      const existing = openMap.get(nKey);
      if (existing && tentG >= existing.g) continue;
      const h = haversine(nb.lat, nb.lng, end.lat, end.lng);
      openMap.set(nKey, { node: nb, g: tentG, f: tentG + h, parent: current });
    }
  }
  return null;
}

// ─── Message Handler ────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<{ type: string; payload: WorkerRequest }>) => {
  if (e.data.type !== 'CALCULATE') return;

  const t0 = performance.now();
  const {
    startLat, startLng, endLat, endLng,
    weatherZones = [],
    latStep = 5, lngStep = 5,
  } = e.data.payload;

  try {
    const grid = createGrid(latStep, lngStep, weatherZones);
    const path = findPath(startLat, startLng, endLat, endLng, grid, latStep, lngStep);

    if (!path) {
      self.postMessage({ type: 'ERROR', payload: 'No path found — constraints may block the route entirely.' });
      return;
    }

    const result: WorkerResult = {
      path,
      computationTimeMs: Math.round(performance.now() - t0),
      source: 'LOCAL_WORKER',
    };
    self.postMessage({ type: 'RESULT', payload: result });
  } catch (err) {
    self.postMessage({ type: 'ERROR', payload: String(err) });
  }
};
