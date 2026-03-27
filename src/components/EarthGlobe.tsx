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

// ─── Weather Overlay via GPU Shader (zero per-frame allocations) ─────────────
//
// The old approach (createWeatherOverlayTexture) created a new 1024×512 HTML
// Canvas + THREE.CanvasTexture every single frame, uploading ~2 MB of pixel
// data to the GPU each tick and immediately abandoning the previous texture.
// This caused a progressive GPU memory leak.
//
// The new approach encodes all zone data as shader uniforms that are mutated
// in-place each frame (no allocations).  The fragment shader computes the
// same storm-blob visualisation entirely on the GPU.

const MAX_ZONES = 12; // must match the GLSL constant below

const weatherVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const weatherFragmentShader = `
  precision mediump float;

  #define MAX_ZONES ${MAX_ZONES}

  uniform float  uTime;
  uniform int    uZoneCount;
  uniform float  uZoneLat[MAX_ZONES];
  uniform float  uZoneLng[MAX_ZONES];
  uniform float  uZoneRadius[MAX_ZONES];
  uniform float  uZoneIntensity[MAX_ZONES];

  varying vec2 vUv;

  // Convert UV (equirectangular) to lat/lng in degrees.
  vec2 uvToLatLng(vec2 texCoord) {
    float lng = texCoord.x * 360.0 - 180.0;
    float lat = 90.0 - texCoord.y * 180.0;
    return vec2(lat, lng);
  }

  // Haversine distance on unit sphere, both inputs in degrees.
  float haversine(float lat1, float lng1, float lat2, float lng2) {
    float dLat = radians(lat2 - lat1);
    float dLng = radians(lng2 - lng1);
    float a = sin(dLat * 0.5) * sin(dLat * 0.5)
            + cos(radians(lat1)) * cos(radians(lat2))
            * sin(dLng * 0.5) * sin(dLng * 0.5);
    return 2.0 * asin(sqrt(clamp(a, 0.0, 1.0)));
  }

  void main() {
    vec2 latLng = uvToLatLng(vUv);
    vec4 color  = vec4(0.0);

    for (int i = 0; i < MAX_ZONES; i++) {
      if (i >= uZoneCount) break;

      // Gentle drift — mirrors createWeatherOverlayTexture's driftLng/driftLat
      float driftLng = uZoneLng[i] + sin(uTime * 0.3 + uZoneLat[i] * 0.1) * 3.0;
      float driftLat = uZoneLat[i] + cos(uTime * 0.2 + uZoneLng[i] * 0.05) * 1.5;

      float d   = haversine(latLng.x, latLng.y, driftLat, driftLng);
      float r   = uZoneRadius[i] * (1.0 + sin(uTime * 2.0 + uZoneIntensity[i]) * 0.15);

      if (d >= r) continue;

      float t      = 1.0 - d / r;             // 0 = edge, 1 = centre
      float alpha  = uZoneIntensity[i] / 5.0;

      vec3 stormColor;
      if (uZoneIntensity[i] > 3.5) {
        // Severe — red
        stormColor = mix(vec3(1.0, 0.47, 0.12), vec3(1.0, 0.16, 0.16), t);
        alpha *= mix(0.25, 0.75, t);
      } else if (uZoneIntensity[i] > 2.0) {
        // Moderate — amber
        stormColor = mix(vec3(1.0, 0.71, 0.31), vec3(1.0, 0.78, 0.16), t);
        alpha *= mix(0.15, 0.65, t);
      } else {
        // Light — blue
        stormColor = vec3(0.24, 0.63, 1.0);
        alpha *= mix(0.0, 0.50, t);
      }

      // Additive blending — matches THREE.AdditiveBlending on the mesh
      color.rgb += stormColor * alpha;
      color.a    = clamp(color.a + alpha, 0.0, 1.0);
    }

    gl_FragColor = color;
  }
`;

/** Build a single long-lived weather ShaderMaterial.  Uniforms are updated
 *  in-place each frame — no garbage objects are ever created. */
function buildWeatherMaterial(zones: WeatherZone[]): THREE.ShaderMaterial {
  const count = Math.min(zones.length, MAX_ZONES);
  const pad   = (arr: number[]) => { while (arr.length < MAX_ZONES) arr.push(0); return arr; };

  return new THREE.ShaderMaterial({
    vertexShader:   weatherVertexShader,
    fragmentShader: weatherFragmentShader,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    uniforms: {
      uTime:          { value: 0 },
      uZoneCount:     { value: count },
      uZoneLat:       { value: pad(zones.slice(0, MAX_ZONES).map(z => z.lat)) },
      uZoneLng:       { value: pad(zones.slice(0, MAX_ZONES).map(z => z.lng)) },
      uZoneRadius:    { value: pad(zones.slice(0, MAX_ZONES).map(z => z.radius)) },
      uZoneIntensity: { value: pad(zones.slice(0, MAX_ZONES).map(z => z.intensity)) },
    },
  });
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
  const meshRef    = useRef<THREE.Mesh>(null);
  const cloudRef   = useRef<THREE.Mesh>(null);
  const weatherRef = useRef<THREE.Mesh>(null);

  // Load real textures
  const dayTexture      = useLoader(THREE.TextureLoader, '/textures/earth-blue-marble.jpg');
  const nightTexture    = useLoader(THREE.TextureLoader, '/textures/earth-night.jpg');
  const bumpTexture     = useLoader(THREE.TextureLoader, '/textures/earth-bump.png');
  const specularTexture = useLoader(THREE.TextureLoader, '/textures/earth-specular.png');
  const cloudTexture    = useLoader(THREE.TextureLoader, '/textures/earth-clouds.png');

  const sunDirection = useMemo(() => new THREE.Vector3(5, 3, 5).normalize(), []);

  const earthMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: {
        dayTexture:      { value: dayTexture },
        nightTexture:    { value: nightTexture },
        bumpTexture:     { value: bumpTexture },
        specularTexture: { value: specularTexture },
        sunDirection:    { value: sunDirection },
      },
    });
  }, [dayTexture, nightTexture, bumpTexture, specularTexture, sunDirection]);

  const atmosphereMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader:   atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      blending:    THREE.AdditiveBlending,
      side:        THREE.BackSide,
      transparent: true,
      depthWrite:  false,
    });
  }, []);

  // ── Weather ShaderMaterial (created once per zone-set change) ─────────
  // buildWeatherMaterial constructs a ShaderMaterial whose uniform arrays
  // are pre-sized to MAX_ZONES.  In useFrame we only mutate the uTime
  // uniform value — no new objects are ever allocated per frame.
  const weatherMaterial = useMemo(
    () => (showWeather ? buildWeatherMaterial(weatherZones) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showWeather, weatherZones],
  );

  useFrame(() => {
    if (cloudRef.current) {
      cloudRef.current.rotation.y = weatherTime * 0.002;
    }
    // ─── GPU weather animation: mutate only uTime — zero allocations ────
    // Previously this called createWeatherOverlayTexture() every frame,
    // allocating a ~2 MB Canvas + CanvasTexture and abandoning the previous
    // one, causing a progressive GPU VRAM leak.
    if (showWeather && weatherMaterial) {
      weatherMaterial.uniforms.uTime.value = weatherTime;
    }
  });

  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    
    // Drag vs Click threshold
    if (pointerDownPos.current) {
      const dx = e.clientX - pointerDownPos.current.x;
      const dy = e.clientY - pointerDownPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 5) {
        return; // User dragged, ignore the click
      }
    }

    const point = e.point;
    if (!meshRef.current) return;
    const localPoint = meshRef.current.worldToLocal(point.clone());
    const { lat, lng } = vector3ToLatLng(localPoint.x, localPoint.y, localPoint.z, EARTH_RADIUS);
    onPointClick(lat, lng);
  }, [onPointClick]);

  return (
    <group>
      {/* Earth with day/night shader */}
      <mesh ref={meshRef} onPointerDown={handlePointerDown} onClick={handleClick} material={earthMaterial}>
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

      {/* Weather overlay — GPU ShaderMaterial, zero per-frame allocations */}
      {showWeather && weatherMaterial && (
        <mesh ref={weatherRef}>
          <sphereGeometry args={[EARTH_RADIUS * 1.006, 64, 64]} />
          <primitive object={weatherMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
}

export { EARTH_RADIUS };
