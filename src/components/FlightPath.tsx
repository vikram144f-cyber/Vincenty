import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GlobeNode, latLngToVector3 } from '@/lib/astar';
import { EARTH_RADIUS } from './EarthGlobe';

interface FlightPathProps {
  path: GlobeNode[];
  showWeather: boolean;
}

const SLERP_STEPS = 32;

export function FlightPath({ path }: FlightPathProps) {
  const pathRadius = EARTH_RADIUS * 1.05;
  const [progress, setProgress] = useState(0);
  const planeRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Points>(null);
  
  // Refs for drawing range updates to avoid memory leaks
  const lineGeomRef = useRef<THREE.BufferGeometry>(null);
  const glowGeomRef = useRef<THREE.BufferGeometry>(null);
  const trailGeomRef = useRef<THREE.BufferGeometry>(null);
  const instancedMarkersRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    setProgress(0);

    // Rule 2: Strictly dispose of all geometries and materials to wipe the 
    // Three.js context clean when the route state changes/unmounts,
    // preventing any ghost paths or memory stacking.
    return () => {
      if (lineGeomRef.current) lineGeomRef.current.dispose();
      if (glowGeomRef.current) glowGeomRef.current.dispose();
      if (trailGeomRef.current) trailGeomRef.current.dispose();
      
      if (instancedMarkersRef.current) {
        instancedMarkersRef.current.geometry?.dispose();
        const mat = instancedMarkersRef.current.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
      }
      
      if (planeRef.current) {
        planeRef.current.geometry?.dispose();
        const mat = planeRef.current.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
      }
    };
  }, [path]);

  // True spherical linear interpolation (SLERP) using Quaternions
  const allPoints = useMemo(() => {
    if (path.length < 2) return [];
    const points: { pos: THREE.Vector3; cost: number }[] = [];
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = latLngToVector3(path[i].lat, path[i].lng, pathRadius);
      const p2 = latLngToVector3(path[i + 1].lat, path[i + 1].lng, pathRadius);
      const v1 = new THREE.Vector3(...p1);
      const v2 = new THREE.Vector3(...p2);

      const q1 = new THREE.Quaternion().setFromUnitVectors(up, v1.clone().normalize());
      const q2 = new THREE.Quaternion().setFromUnitVectors(up, v2.clone().normalize());

      const steps = SLERP_STEPS;
      const isLast = i === path.length - 2;

      for (let s = 0; s <= (isLast ? steps : steps - 1); s++) {
        const t = s / steps;
        const qInterp = q1.clone().slerp(q2, t);
        const pt = up.clone().applyQuaternion(qInterp).multiplyScalar(pathRadius);
        const cost = path[i].cost + (path[i + 1].cost - path[i].cost) * t;
        points.push({ pos: pt, cost });
      }
    }
    return points;
  }, [path, pathRadius]);

  // Pre-calculate full geometry buffers ONE TIME to avoid memory leaks
  const { lineData, glowData, trailData, markerData } = useMemo(() => {
    if (allPoints.length < 2) {
      return { lineData: null, glowData: null, trailData: null, markerData: null };
    }
    
    // Main line
    const linePts = [];
    const lineCols = [];
    
    // Outer glow
    const glowPts = [];
    const glowCols = [];
    const glowStep = Math.max(1, Math.floor(allPoints.length / 120));
    
    // Inner trail
    const trailPts = [];
    const trailCols = [];
    const trailStep = Math.max(1, Math.floor(allPoints.length / 80));
    
    // Waypoint markers
    const markerPts = [];
    const markerCols = [];
    const markerStep = Math.max(1, Math.floor(allPoints.length / 20));

    for (let i = 0; i < allPoints.length; i++) {
      const p = allPoints[i];
      const cost = p.cost;
      
      // Line (every point)
      linePts.push(p.pos.x, p.pos.y, p.pos.z);
      if (cost > 3) lineCols.push(1, 0.25, 0.15);
      else if (cost > 1.5) lineCols.push(1, 0.8, 0.2);
      else lineCols.push(0.2, 0.93, 0.63);
      
      // Glow
      if (i % glowStep === 0) {
        const s = p.pos.clone().multiplyScalar(1.0005);
        glowPts.push(s.x, s.y, s.z);
        if (cost > 3) glowCols.push(1.0, 0.3, 0.2);
        else if (cost > 1.5) glowCols.push(1.0, 0.85, 0.3);
        else glowCols.push(0.1, 0.95, 0.7);
      }
      
      // Trail
      if (i % trailStep === 0) {
        const s = p.pos.clone().multiplyScalar(1.001);
        trailPts.push(s.x, s.y, s.z);
        const fade = i / allPoints.length;
        trailCols.push(0.2 + fade * 0.1, 0.9, 0.6 + fade * 0.1);
      }
      
      // Markers
      if (i % markerStep === 0) {
        const m = p.pos.clone().multiplyScalar(1.01);
        markerPts.push(m);
        if (cost > 3) markerCols.push(new THREE.Color('#ff4444'));
        else if (cost > 1.5) markerCols.push(new THREE.Color('#ffcc22'));
        else markerCols.push(new THREE.Color('#33eea0'));
      }
    }
    
    return {
      lineData: { pts: new Float32Array(linePts), cols: new Float32Array(lineCols), count: allPoints.length },
      glowData: { pts: new Float32Array(glowPts), cols: new Float32Array(glowCols), count: glowPts.length / 3, step: glowStep },
      trailData: { pts: new Float32Array(trailPts), cols: new Float32Array(trailCols), count: trailPts.length / 3, step: trailStep },
      markerData: { pts: markerPts, cols: markerCols, step: markerStep },
    };
  }, [allPoints]);

  // We assign dummy colors and transform matrices to the InstancedMesh
  useEffect(() => {
    if (instancedMarkersRef.current && markerData && markerData.pts.length > 0) {
      const mesh = instancedMarkersRef.current;
      const dummyObj = new THREE.Object3D();
      
      for (let i = 0; i < markerData.pts.length; i++) {
        dummyObj.position.copy(markerData.pts[i]);
        dummyObj.updateMatrix();
        mesh.setMatrixAt(i, dummyObj.matrix);
        mesh.setColorAt(i, markerData.cols[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [markerData]);

  // Update draw ranges every frame (no new memory allocations)
  useFrame((_, delta) => {
    if (allPoints.length < 2) return;

    if (progress < 1) {
      setProgress((p) => Math.min(1, p + delta * 0.4));
    }

    const visibleCount = Math.floor(progress * allPoints.length);

    if (lineGeomRef.current) lineGeomRef.current.setDrawRange(0, visibleCount);
    if (glowGeomRef.current && glowData) glowGeomRef.current.setDrawRange(0, Math.floor(visibleCount / glowData.step));
    if (trailGeomRef.current && trailData) trailGeomRef.current.setDrawRange(0, Math.floor(visibleCount / trailData.step));
    if (instancedMarkersRef.current && markerData) {
      const targetCount = Math.floor(visibleCount / markerData.step);
      // Fallback in case targetCount evaluates to outside the init range
      instancedMarkersRef.current.count = Math.min(Math.max(0, targetCount), markerData.pts.length);
    }

    // Plane movement
    if (planeRef.current && progress > 0) {
      const idx = Math.floor(progress * (allPoints.length - 1));
      const pt = allPoints[Math.min(idx, allPoints.length - 1)];
      planeRef.current.position.copy(pt.pos.clone().multiplyScalar(1.03));

      if (idx < allPoints.length - 1) {
        const next = allPoints[idx + 1];
        planeRef.current.lookAt(next.pos.clone().multiplyScalar(1.03));
      }
    }

    // Glow pulse logic
    if (glowRef.current && glowRef.current.material instanceof THREE.PointsMaterial) {
      const t = performance.now() * 0.001;
      glowRef.current.material.opacity = 0.35 + Math.sin(t * 2.0) * 0.15;
    }
  });

  if (!lineData || allPoints.length < 2) return null;

  return (
    <group>
      {/* Main path line */}
      <line>
        <bufferGeometry attach="geometry" ref={lineGeomRef}>
          <bufferAttribute attach="attributes-position" array={lineData.pts} count={lineData.count} itemSize={3} />
          <bufferAttribute attach="attributes-color" array={lineData.cols} count={lineData.count} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial attach="material" vertexColors linewidth={2} />
      </line>

      {/* Outer neon glow layer */}
      <points ref={glowRef}>
        <bufferGeometry attach="geometry" ref={glowGeomRef}>
          <bufferAttribute attach="attributes-position" array={glowData!.pts} count={glowData!.count} itemSize={3} />
          <bufferAttribute attach="attributes-color" array={glowData!.cols} count={glowData!.count} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial attach="material" size={0.06} vertexColors transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>

      {/* Inner glow trail */}
      <points>
        <bufferGeometry attach="geometry" ref={trailGeomRef}>
          <bufferAttribute attach="attributes-position" array={trailData!.pts} count={trailData!.count} itemSize={3} />
          <bufferAttribute attach="attributes-color" array={trailData!.cols} count={trailData!.count} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial attach="material" size={0.025} vertexColors transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>

      {/* Waypoint dots as InstancedMesh (1 Draw Call instead of N objects) */}
      {markerData && markerData.pts.length > 0 && (
        <instancedMesh
          ref={instancedMarkersRef}
          args={[
            null as unknown as THREE.BufferGeometry,
            null as unknown as THREE.Material,
            markerData.pts.length,
          ]}
        >
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshBasicMaterial transparent opacity={0.8} />
        </instancedMesh>
      )}

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
          <mesh><sphereGeometry args={[0.045, 16, 16]} /><meshBasicMaterial color="#33eea0" /></mesh>
          <mesh><sphereGeometry args={[0.07, 16, 16]} /><meshBasicMaterial color="#33eea0" transparent opacity={0.25} depthWrite={false} /></mesh>
          <mesh><sphereGeometry args={[0.1, 16, 16]} /><meshBasicMaterial color="#33eea0" transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
      )}

      {/* End beacon */}
      {path.length > 1 && progress > 0.95 && (
        <group position={latLngToVector3(path[path.length - 1].lat, path[path.length - 1].lng, pathRadius + 0.03)}>
          <mesh><sphereGeometry args={[0.045, 16, 16]} /><meshBasicMaterial color="#ff6644" /></mesh>
          <mesh><sphereGeometry args={[0.07, 16, 16]} /><meshBasicMaterial color="#ff6644" transparent opacity={0.25} depthWrite={false} /></mesh>
          <mesh><sphereGeometry args={[0.1, 16, 16]} /><meshBasicMaterial color="#ff6644" transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
      )}
    </group>
  );
}
