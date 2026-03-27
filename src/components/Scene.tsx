import { useRef, useEffect, Suspense, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EarthGlobe } from './EarthGlobe';
import { FlightPath } from './FlightPath';
import { GreatCirclePath } from './GreatCirclePath';
import { CityMarkers } from './CityMarkers';
import { GlobeNode, WeatherZone, latLngToVector3 } from '@/lib/astar';
import { majorCities } from '@/lib/weatherData';
import * as THREE from 'three';
import { EARTH_RADIUS } from './EarthGlobe';

interface SceneProps {
  onPointClick: (lat: number, lng: number) => void;
  showWeather: boolean;
  weatherZones: WeatherZone[];
  path: GlobeNode[];
  selectedStart: string | null;
  selectedEnd: string | null;
  weatherTime: number;
}

function CameraController({ selectedStart, selectedEnd, onInteract }: { selectedStart: string | null; selectedEnd: string | null; onInteract: () => void }) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const targetPos = useRef(new THREE.Vector3(0, 2, 5));
  const isAnimating = useRef(false);

  useEffect(() => {
    if (!selectedStart || !selectedEnd) return;

    const startCity = majorCities.find((c) => c.name === selectedStart);
    const endCity = majorCities.find((c) => c.name === selectedEnd);
    if (!startCity || !endCity) return;

    const midLat = (startCity.lat + endCity.lat) / 2;
    let dLng = endCity.lng - startCity.lng;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const midLng = startCity.lng + dLng / 2;

    const [mx, my, mz] = latLngToVector3(midLat, midLng, EARTH_RADIUS);
    const dir = new THREE.Vector3(mx, my, mz).normalize();

    const angularDist = Math.sqrt((startCity.lat - endCity.lat) ** 2 + dLng ** 2);
    const dist = Math.max(4.5, Math.min(8, angularDist * 0.06));

    targetPos.current = dir.multiplyScalar(dist);
    isAnimating.current = true;
  }, [selectedStart, selectedEnd]);

  useFrame(() => {
    if (isAnimating.current) {
      camera.position.lerp(targetPos.current, 0.02);
      camera.lookAt(0, 0, 0);

      if (camera.position.distanceTo(targetPos.current) < 0.05) {
        isAnimating.current = false;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      minDistance={3}
      maxDistance={12}
      enableDamping
      dampingFactor={0.05}
      rotateSpeed={0.5}
      onStart={onInteract}
    />
  );
}

// Get start/end coordinates for great circle
function useGreatCircleEndpoints(selectedStart: string | null, selectedEnd: string | null) {
  if (!selectedStart || !selectedEnd) return null;
  const s = majorCities.find(c => c.name === selectedStart);
  const e = majorCities.find(c => c.name === selectedEnd);
  if (!s || !e) return null;
  return { startLat: s.lat, startLng: s.lng, endLat: e.lat, endLng: e.lng };
}

/**
 * Shared rotation group: all geo-positioned objects (Earth mesh, overlays,
 * city markers, flight paths) live inside this group so they rotate together.
 * This prevents visual drift between the Earth texture and the overlay lines.
 */
function RotatingEarthGroup({
  onPointClick,
  showWeather,
  weatherZones,
  weatherTime,
  path,
  selectedStart,
  selectedEnd,
  autoRotate,
}: SceneProps & { autoRotate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const gcEndpoints = useGreatCircleEndpoints(selectedStart, selectedEnd);

  // Slow auto-rotation for the entire group (Earth + overlays together)
  useFrame(() => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y += 0.0003;
    }
  });

  return (
    <group ref={groupRef}>
      <Suspense fallback={null}>
        <EarthGlobe
          onPointClick={onPointClick}
          showWeather={showWeather}
          weatherZones={weatherZones}
          weatherTime={weatherTime}
        />
      </Suspense>

      <CityMarkers
        cities={majorCities}
        selectedStart={selectedStart}
        selectedEnd={selectedEnd}
      />

      {/* Great circle (geodesic) comparison path */}
      {gcEndpoints && path.length > 1 && (
        <GreatCirclePath {...gcEndpoints} />
      )}

      {path.length > 1 && (
        <FlightPath 
          key={`${selectedStart}-${selectedEnd}`} 
          path={path} 
          showWeather={showWeather} 
        />
      )}
    </group>
  );
}

export function Scene({ onPointClick, showWeather, weatherZones, path, selectedStart, selectedEnd, weatherTime }: SceneProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  return (
    <Canvas
      camera={{ position: [0, 2, 5], fov: 45 }}
      style={{ background: '#040810' }}
      gl={{ antialias: true, alpha: false }}
    >
      {/* Lighting */}
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 3, 5]} intensity={1.0} color="#ffffff" />
      <directionalLight position={[-3, -1, -4]} intensity={0.15} color="#4466aa" />
      <pointLight position={[0, 5, 0]} intensity={0.2} color="#88aaff" />

      {/* Star field */}
      <Stars radius={80} depth={60} count={5000} factor={4} saturation={0.1} fade speed={0.3} />

      {/* Background */}
      <mesh>
        <sphereGeometry args={[50, 16, 16]} />
        <meshBasicMaterial color="#060a14" side={THREE.BackSide} />
      </mesh>

      {/* Everything geo-positioned rotates together in one group */}
      <RotatingEarthGroup
        onPointClick={onPointClick}
        showWeather={showWeather}
        weatherZones={weatherZones}
        path={path}
        selectedStart={selectedStart}
        selectedEnd={selectedEnd}
        weatherTime={weatherTime}
        autoRotate={autoRotate}
      />

      <CameraController
        selectedStart={selectedStart}
        selectedEnd={selectedEnd}
        onInteract={() => setAutoRotate(false)}
      />
    </Canvas>
  );
}
