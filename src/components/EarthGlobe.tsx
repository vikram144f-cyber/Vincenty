import { useRef, useMemo, useCallback } from 'react';
import { useFrame, ThreeEvent, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { vector3ToLatLng, WeatherZone } from '@/lib/astar';

const EARTH_RADIUS = 2;

interface EarthGlobeProps {
  onPointClick: (lat: number, lng: number) => void;
  showWeather: boolean;
  weatherZones: WeatherZone[];
  weatherTime: number;
}

function createWeatherOverlayTexture(zones: WeatherZone[], time: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const zone of zones) {
    const driftLng = zone.lng + Math.sin(time * 0.3 + zone.lat * 0.1) * 3;
    const driftLat = zone.lat + Math.cos(time * 0.2 + zone.lng * 0.05) * 1.5;

    const x = ((driftLng + 180) / 360) * canvas.width;
    const y = ((90 - driftLat) / 180) * canvas.height;
    const pulseScale = 1 + Math.sin(time * 2 + zone.intensity) * 0.15;
    const r = zone.radius * 300 * pulseScale;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = zone.intensity / 5;

    if (zone.intensity > 3.5) {
      grad.addColorStop(0, `rgba(255, 40, 40, ${alpha * 0.75})`);
      grad.addColorStop(0.3, `rgba(255, 80, 20, ${alpha * 0.5})`);
      grad.addColorStop(0.6, `rgba(255, 120, 30, ${alpha * 0.25})`);
      grad.addColorStop(1, 'rgba(255, 120, 30, 0)');
    } else if (zone.intensity > 2) {
      grad.addColorStop(0, `rgba(255, 200, 40, ${alpha * 0.65})`);
      grad.addColorStop(0.4, `rgba(255, 170, 60, ${alpha * 0.35})`);
      grad.addColorStop(1, 'rgba(255, 180, 80, 0)');
    } else {
      grad.addColorStop(0, `rgba(60, 160, 255, ${alpha * 0.5})`);
      grad.addColorStop(1, 'rgba(60, 160, 255, 0)');
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Day/night shader with real textures
const earthVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const earthFragmentShader = `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform sampler2D bumpTexture;
  uniform sampler2D specularTexture;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec4 dayColor = texture2D(dayTexture, vUv);
    vec4 nightColor = texture2D(nightTexture, vUv);
    vec4 specMap = texture2D(specularTexture, vUv);
    
    // Sun illumination
    float sunDot = dot(vNormal, sunDirection);
    float dayFactor = smoothstep(-0.15, 0.25, sunDot);
    
    // Blend day and night
    vec3 color = mix(nightColor.rgb * 0.8, dayColor.rgb, dayFactor);
    
    // Specular highlight on water (where specMap is bright)
    vec3 viewDir = normalize(-vPosition);
    vec3 halfDir = normalize(sunDirection + viewDir);
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 40.0) * specMap.r * dayFactor;
    color += vec3(0.4, 0.5, 0.6) * spec;
    
    // Subtle rim light (atmosphere edge)
    float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
    color += vec3(0.15, 0.35, 0.65) * pow(rim, 3.0) * 0.4;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    vec3 atmosphere = vec3(0.3, 0.6, 1.0) * intensity;
    gl_FragColor = vec4(atmosphere, intensity * 0.6);
  }
`;

export function EarthGlobe({ onPointClick, showWeather, weatherZones, weatherTime }: EarthGlobeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const weatherRef = useRef<THREE.Mesh>(null);
  const weatherMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Load real textures
  const dayTexture = useLoader(THREE.TextureLoader, '/textures/earth-blue-marble.jpg');
  const nightTexture = useLoader(THREE.TextureLoader, '/textures/earth-night.jpg');
  const bumpTexture = useLoader(THREE.TextureLoader, '/textures/earth-bump.png');
  const specularTexture = useLoader(THREE.TextureLoader, '/textures/earth-specular.png');
  const cloudTexture = useLoader(THREE.TextureLoader, '/textures/earth-clouds.png');

  const sunDirection = useMemo(() => new THREE.Vector3(5, 3, 5).normalize(), []);

  const earthMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: {
        dayTexture: { value: dayTexture },
        nightTexture: { value: nightTexture },
        bumpTexture: { value: bumpTexture },
        specularTexture: { value: specularTexture },
        sunDirection: { value: sunDirection },
      },
    });
  }, [dayTexture, nightTexture, bumpTexture, specularTexture, sunDirection]);

  const atmosphereMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
  }, []);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0003;
    }
    if (cloudRef.current) {
      cloudRef.current.rotation.y = (meshRef.current?.rotation.y || 0) + weatherTime * 0.002;
    }
    if (weatherRef.current) {
      weatherRef.current.rotation.y = meshRef.current?.rotation.y || 0;
    }
    if (showWeather && weatherMatRef.current) {
      const newTex = createWeatherOverlayTexture(weatherZones, weatherTime);
      weatherMatRef.current.map = newTex;
      weatherMatRef.current.needsUpdate = true;
    }
  });

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point = e.point;
    if (!meshRef.current) return;
    const localPoint = meshRef.current.worldToLocal(point.clone());
    const { lat, lng } = vector3ToLatLng(localPoint.x, localPoint.y, localPoint.z, EARTH_RADIUS);
    onPointClick(lat, lng);
  }, [onPointClick]);

  const initialWeatherTex = useMemo(() => createWeatherOverlayTexture(weatherZones, 0), [weatherZones]);

  return (
    <group>
      {/* Earth with day/night shader */}
      <mesh ref={meshRef} onClick={handleClick} material={earthMaterial}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
      </mesh>

      {/* Cloud layer */}
      <mesh ref={cloudRef}>
        <sphereGeometry args={[EARTH_RADIUS * 1.008, 96, 96]} />
        <meshPhongMaterial
          map={cloudTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Inner atmosphere glow */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.015, 64, 64]} />
        <meshBasicMaterial
          color="#3388ff"
          transparent
          opacity={0.04}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Outer atmosphere shader */}
      <mesh material={atmosphereMaterial}>
        <sphereGeometry args={[EARTH_RADIUS * 1.15, 64, 64]} />
      </mesh>

      {/* Secondary outer glow */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.25, 32, 32]} />
        <meshBasicMaterial
          color="#2266cc"
          transparent
          opacity={0.015}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Weather overlay */}
      {showWeather && (
        <mesh ref={weatherRef}>
          <sphereGeometry args={[EARTH_RADIUS * 1.006, 64, 64]} />
          <meshBasicMaterial
            ref={weatherMatRef}
            map={initialWeatherTex}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

export { EARTH_RADIUS };
