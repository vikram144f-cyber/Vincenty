import { latLngToVector3 } from '@/lib/astar';
import { EARTH_RADIUS } from './EarthGlobe';
import { Html } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CityData } from '@/lib/weatherData';

interface CityMarkersProps {
  cities: CityData[];
  selectedStart: string | null;
  selectedEnd: string | null;
}

function CityPin({ city, isStart, isEnd }: { city: CityData; isStart: boolean; isEnd: boolean }) {
  const markerRadius = EARTH_RADIUS * 1.01;
  const [x, y, z] = latLngToVector3(city.lat, city.lng, markerRadius);
  const isSelected = isStart || isEnd;
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (isSelected && ringRef.current) {
      ringRef.current.rotation.z = state.clock.elapsedTime * 1.5;
    }
    if (isSelected && pulseRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.3;
      pulseRef.current.scale.setScalar(scale);
    }
  });

  const pinColor = isStart ? '#33eea0' : isEnd ? '#ff6644' : '#4a9eff';

  return (
    <group position={[x, y, z]}>
      <mesh>
        <sphereGeometry args={[isSelected ? 0.035 : 0.018, 16, 16]} />
        <meshBasicMaterial color={pinColor} />
      </mesh>

      {isSelected && (
        <>
          <mesh ref={pulseRef}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshBasicMaterial color={pinColor} transparent opacity={0.15} depthWrite={false} />
          </mesh>
          <mesh ref={ringRef}>
            <torusGeometry args={[0.06, 0.004, 8, 32]} />
            <meshBasicMaterial color={pinColor} transparent opacity={0.5} />
          </mesh>
        </>
      )}

      <Html center distanceFactor={5} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: isSelected ? '9px' : '7px',
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? '#fff' : 'rgba(160,190,220,0.7)',
            background: isSelected ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.3)',
            padding: isSelected ? '2px 6px' : '1px 4px',
            borderRadius: '4px',
            border: `1px solid ${isSelected ? pinColor : 'rgba(100,140,180,0.2)'}`,
            transform: 'translateY(-20px)',
            boxShadow: isSelected ? `0 0 10px ${pinColor}40` : 'none',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}
        >
          {city.iata} · {city.name}
        </div>
      </Html>
    </group>
  );
}

export function CityMarkers({ cities, selectedStart, selectedEnd }: CityMarkersProps) {
  return (
    <group>
      {cities.map((city) => (
        <CityPin
          key={city.name}
          city={city}
          isStart={city.name === selectedStart}
          isEnd={city.name === selectedEnd}
        />
      ))}
    </group>
  );
}
