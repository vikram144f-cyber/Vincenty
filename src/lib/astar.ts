// A* pathfinding on a spherical grid

export interface GlobeNode {
  lat: number;
  lng: number;
  cost: number; // weather cost multiplier (1 = clear, 5 = heavy storm)
}

const MAX_WEATHER_COST = 1.5;

interface AStarNode {
  node: GlobeNode;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 1; // unit sphere
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const longitudeDelta = Math.abs(lng2 - lng1);
  const shortestLongitudeDelta = Math.min(longitudeDelta, 360 - longitudeDelta);
  const dLng = (shortestLongitudeDelta * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getNeighbors(node: GlobeNode, grid: GlobeNode[][], latStep: number, lngStep: number): GlobeNode[] {
  const neighbors: GlobeNode[] = [];
  const latIdx = Math.round((node.lat + 90) / latStep);
  const lngIdx = Math.round((node.lng + 180) / lngStep);
  const maxLat = grid.length;
  const maxLng = grid[0]?.length || 0;

  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;
      const ni = latIdx + di;
      const nj = (lngIdx + dj + maxLng) % maxLng; // wrap longitude
      if (ni >= 0 && ni < maxLat && grid[ni]?.[nj]) {
        neighbors.push(grid[ni][nj]);
      }
    }
  }
  return neighbors;
}

function nodeKey(n: GlobeNode): string {
  return `${n.lat.toFixed(1)},${n.lng.toFixed(1)}`;
}

export function createGrid(latStep: number, lngStep: number, weatherZones: WeatherZone[]): GlobeNode[][] {
  const grid: GlobeNode[][] = [];
  for (let lat = -90; lat <= 90; lat += latStep) {
    const row: GlobeNode[] = [];
    for (let lng = -180; lng < 180; lng += lngStep) {
      let cost = 1;
      for (const zone of weatherZones) {
        const d = haversine(lat, lng, zone.lat, zone.lng);
        if (d < zone.radius) {
          const proximity = 1 - d / zone.radius;
          const intensityFrac = Math.min(zone.intensity / 5, 1);
          const zoneCost = 1 + MAX_WEATHER_COST * intensityFrac * (
            Math.log1p(proximity) / Math.log(2)
          );
          cost = Math.max(cost, zoneCost);
        }
      }
      row.push({ lat, lng, cost });
    }
    grid.push(row);
  }
  return grid;
}

export interface WeatherZone {
  lat: number;
  lng: number;
  radius: number; // in haversine units on unit sphere
  intensity: number; // 1-5
  label?: string;
}

export function findPath(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  grid: GlobeNode[][],
  latStep: number,
  lngStep: number
): GlobeNode[] | null {
  // Snap to grid
  const snapLat = (lat: number) => Math.round((lat + 90) / latStep) * latStep - 90;
  const snapLng = (lng: number) => Math.round((lng + 180) / lngStep) * lngStep - 180;

  const sLat = snapLat(startLat);
  const sLng = snapLng(startLng);
  const eLat = snapLat(endLat);
  const eLng = snapLng(endLng);

  const sLatIdx = Math.round((sLat + 90) / latStep);
  const sLngIdx = Math.round((sLng + 180) / lngStep);
  const eLatIdx = Math.round((eLat + 90) / latStep);
  const eLngIdx = Math.round((eLng + 180) / lngStep);

  const startNode = grid[sLatIdx]?.[sLngIdx];
  const endNode = grid[eLatIdx]?.[eLngIdx];
  if (!startNode || !endNode) return null;

  const openSet = new Map<string, AStarNode>();
  const closedSet = new Set<string>();

  const startAstar: AStarNode = {
    node: startNode,
    g: 0,
    h: haversine(startNode.lat, startNode.lng, endNode.lat, endNode.lng),
    f: 0,
    parent: null,
  };
  startAstar.f = startAstar.g + startAstar.h;
  openSet.set(nodeKey(startNode), startAstar);

  let iterations = 0;
  const maxIterations = 50000;

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let current: AStarNode | null = null;
    for (const n of openSet.values()) {
      if (!current || n.f < current.f) current = n;
    }
    if (!current) break;

    if (nodeKey(current.node) === nodeKey(endNode)) {
      // Reconstruct path
      const path: GlobeNode[] = [];
      let c: AStarNode | null = current;
      while (c) {
        path.unshift(c.node);
        c = c.parent;
      }
      return path;
    }

    openSet.delete(nodeKey(current.node));
    closedSet.add(nodeKey(current.node));

    const neighbors = getNeighbors(current.node, grid, latStep, lngStep);
    for (const neighbor of neighbors) {
      const key = nodeKey(neighbor);
      if (closedSet.has(key)) continue;

      const moveCost = haversine(current.node.lat, current.node.lng, neighbor.lat, neighbor.lng) * neighbor.cost;
      const tentG = current.g + moveCost;

      const existing = openSet.get(key);
      if (existing && tentG >= existing.g) continue;

      const h = haversine(neighbor.lat, neighbor.lng, endNode.lat, endNode.lng);
      const astarNode: AStarNode = {
        node: neighbor,
        g: tentG,
        h,
        f: tentG + h,
        parent: current,
      };
      openSet.set(key, astarNode);
    }
  }

  return null;
}

export function latLngToVector3(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return [x, y, z];
}

export function vector3ToLatLng(x: number, y: number, z: number, radius: number): { lat: number; lng: number } {
  const lat = 90 - Math.acos(y / radius) * (180 / Math.PI);
  const lng = ((Math.atan2(z, -x) * 180) / Math.PI) - 180;
  return {
    lat,
    lng: lng < -180 ? lng + 360 : lng > 180 ? lng - 360 : lng,
  };
}
