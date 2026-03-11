import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GlobeNode, latLngToVector3 } from '@/lib/astar';
import { EARTH_RADIUS } from './EarthGlobe';

interface FlightPathProps {
  path: GlobeNode[];
  showWeather: boolean;
}

export function FlightPath({ path }: FlightPathProps) {
  const pathRadius = EARTH_RADIUS * 1.05;
  const [progress, setProgress] = useState(0);
  const planeRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Points>(null);

  // Reset animation when path changes
  useEffect(() => {
    setProgress(0);
  }, [path]);

  // All interpolated points for the full path
  const allPoints = useMemo(() => {
    if (path.length < 2) return [];
    const points: { pos: THREE.Vector3; cost: number }[] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const steps = 4;
      for (let s = 0; s <= (i === path.length - 2 ? steps : steps - 1); s++) {
        const t = s / steps;
        const lat = path[i].lat + (path[i + 1].lat - path[i].lat) * t;
        let dLng = path[i + 1].lng - path[i].lng;
        if (dLng > 180) dLng -= 360;
        if (dLng < -180) dLng += 360;
        const interpLng = path[i].lng + dLng * t;
        const cost = path[i].cost + (path[i + 1].cost - path[i].cost) * t;

        const [x, y, z] = latLngToVector3(lat, interpLng, pathRadius);
        points.push({ pos: new THREE.Vector3(x, y, z), cost });
      }
    }
    return points;
  }, [path, pathRadius]);

  // Animate the path drawing and plane movement
  useFrame((_, delta) => {
    if (allPoints.length < 2) return;

    if (progress < 1) {
      setProgress((p) => Math.min(1, p + delta * 0.4)); // ~2.5 second animation
    }

    // Move the plane indicator
    if (planeRef.current && progress > 0) {
      const idx = Math.floor(progress * (allPoints.length - 1));
      const pt = allPoints[Math.min(idx, allPoints.length - 1)];
      planeRef.current.position.copy(pt.pos.clone().multiplyScalar(1.03));

      // Look in direction of travel
      if (idx < allPoints.length - 1) {
        const next = allPoints[idx + 1];
        planeRef.current.lookAt(next.pos.clone().multiplyScalar(1.03));
      }
    }
  });

  // Visible points based on progress
  const visibleCount = Math.floor(progress * allPoints.length);

  const { lineGeometry } = useMemo(() => {
    if (visibleCount < 2) return { lineGeometry: null };

    const pts = allPoints.slice(0, visibleCount).map((p) => p.pos);
    const colorArr: number[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const cost = allPoints[i].cost;
      if (cost > 3) {
        colorArr.push(1, 0.25, 0.15);
      } else if (cost > 1.5) {
        colorArr.push(1, 0.8, 0.2);
      } else {
        colorArr.push(0.2, 0.93, 0.63);
      }
    }

    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));
    return { lineGeometry: geom };
  }, [allPoints, visibleCount]);

  // Glow trail particles
  const trailGeometry = useMemo(() => {
    if (visibleCount < 2) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const step = Math.max(1, Math.floor(visibleCount / 60));

    for (let i = 0; i < visibleCount; i += step) {
      const p = allPoints[i];
      const s = p.pos.clone().multiplyScalar(1.001);
      positions.push(s.x, s.y, s.z);
      const fade = i / visibleCount;
      colors.push(0.2 + fade * 0.1, 0.9, 0.6 + fade * 0.1);
      sizes.push(0.02 + (1 - fade) * 0.01);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, [allPoints, visibleCount]);

  const markerPositions = useMemo(() => {
    if (visibleCount < 2) return [];
    const step = Math.max(1, Math.floor(visibleCount / 20));
    return allPoints
      .slice(0, visibleCount)
      .filter((_, i) => i % step === 0)
      .map((p) => ({
        pos: [p.pos.x * 1.01, p.pos.y * 1.01, p.pos.z * 1.01] as [number, number, number],
        cost: p.cost,
      }));
  }, [allPoints, visibleCount]);

  if (!lineGeometry || allPoints.length < 2) return null;

  return (
    <group>
      {/* Main path line */}
      <line>
        <bufferGeometry attach="geometry" {...lineGeometry} />
        <lineBasicMaterial attach="material" vertexColors linewidth={2} />
      </line>

      {/* Glow trail */}
      {trailGeometry && (
        <points ref={trailRef}>
          <bufferGeometry attach="geometry" {...trailGeometry} />
          <pointsMaterial
            attach="material"
            size={0.025}
            vertexColors
            transparent
            opacity={0.6}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}

      {/* Waypoint dots */}
      {markerPositions.map((m, i) => (
        <mesh key={i} position={m.pos}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshBasicMaterial
            color={m.cost > 3 ? '#ff4444' : m.cost > 1.5 ? '#ffcc22' : '#33eea0'}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}

      {/* Animated plane indicator */}
      {progress > 0.01 && (
        <mesh ref={planeRef}>
          <coneGeometry args={[0.03, 0.08, 4]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}

      {/* Start beacon */}
      {path.length > 0 && (
        <group position={latLngToVector3(path[0].lat, path[0].lng, pathRadius + 0.03)}>
          <mesh>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshBasicMaterial color="#33eea0" />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#33eea0" transparent opacity={0.2} depthWrite={false} />
          </mesh>
        </group>
      )}

      {/* End beacon */}
      {path.length > 1 && progress > 0.95 && (
        <group position={latLngToVector3(path[path.length - 1].lat, path[path.length - 1].lng, pathRadius + 0.03)}>
          <mesh>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshBasicMaterial color="#ff6644" />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#ff6644" transparent opacity={0.2} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}
