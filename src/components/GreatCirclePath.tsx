import { useMemo } from 'react';
import * as THREE from 'three';
import { latLngToVector3 } from '@/lib/astar';
import { EARTH_RADIUS } from './EarthGlobe';

interface GreatCirclePathProps {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

/** High-resolution segments for a perfectly smooth great circle arc. */
const GC_SEGMENTS = 256;

export function GreatCirclePath({ startLat, startLng, endLat, endLng }: GreatCirclePathProps) {
  const pathRadius = EARTH_RADIUS * 1.04;

  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];

    // Proper SLERP for great circle
    const start = new THREE.Vector3(...latLngToVector3(startLat, startLng, pathRadius));
    const end = new THREE.Vector3(...latLngToVector3(endLat, endLng, pathRadius));

    for (let i = 0; i <= GC_SEGMENTS; i++) {
      const t = i / GC_SEGMENTS;
      const pt = new THREE.Vector3().copy(start).lerp(end, t).normalize().multiplyScalar(pathRadius);
      points.push(pt);
    }

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return geom;
  }, [startLat, startLng, endLat, endLng, pathRadius]);

  return (
    <line>
      <bufferGeometry attach="geometry" {...geometry} />
      <lineDashedMaterial
        attach="material"
        color="#ffffff"
        opacity={0.25}
        transparent
        dashSize={0.05}
        gapSize={0.03}
        depthWrite={false}
      />
    </line>
  );
}
