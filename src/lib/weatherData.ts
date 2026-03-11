import { WeatherZone } from './astar';

export const defaultWeatherZones: WeatherZone[] = [
  // North Atlantic — realistic winter storm belt (Icelandic Low)
  { lat: 55, lng: -30, radius: 0.35, intensity: 4.2, label: 'N. Atlantic Storm' },
  // Western Pacific typhoon alley (near Philippines/Taiwan)
  { lat: 18, lng: 130, radius: 0.3, intensity: 5, label: 'W. Pacific Typhoon' },
  // Bay of Bengal cyclone zone
  { lat: 12, lng: 85, radius: 0.22, intensity: 3.8, label: 'Bay of Bengal Cyclone' },
  // ITCZ — Intertropical Convergence Zone (equatorial thunderstorms)
  { lat: 5, lng: -20, radius: 0.25, intensity: 2.8, label: 'ITCZ Storms' },
  // Saharan dust (African easterly jet)
  { lat: 20, lng: 0, radius: 0.2, intensity: 2.2, label: 'Saharan Dust' },
  // Arctic polar vortex disruption
  { lat: 72, lng: 30, radius: 0.28, intensity: 3.0, label: 'Polar Vortex' },
  // South Indian Ocean (Roaring Forties)
  { lat: -42, lng: 70, radius: 0.25, intensity: 3.5, label: 'S. Indian Storm' },
  // Southern Ocean storm track
  { lat: -50, lng: -120, radius: 0.22, intensity: 3.2, label: 'S. Pacific Storm' },
];

export interface CityData {
  name: string;
  iata: string;
  lat: number;
  lng: number;
  region: string;
}

export const majorCities: CityData[] = [
  // North America
  { name: 'New York', iata: 'JFK', lat: 40.6413, lng: -73.7781, region: 'North America' },
  { name: 'Los Angeles', iata: 'LAX', lat: 33.9425, lng: -118.4081, region: 'North America' },
  { name: 'Chicago', iata: 'ORD', lat: 41.9742, lng: -87.9073, region: 'North America' },
  { name: 'San Francisco', iata: 'SFO', lat: 37.6213, lng: -122.3790, region: 'North America' },
  // South America
  { name: 'São Paulo', iata: 'GRU', lat: -23.4356, lng: -46.4731, region: 'South America' },
  { name: 'Rio de Janeiro', iata: 'GIG', lat: -22.8099, lng: -43.2505, region: 'South America' },
  { name: 'Buenos Aires', iata: 'EZE', lat: -34.8222, lng: -58.5358, region: 'South America' },
  // Europe
  { name: 'London', iata: 'LHR', lat: 51.4700, lng: -0.4543, region: 'Europe' },
  { name: 'Paris', iata: 'CDG', lat: 49.0097, lng: 2.5479, region: 'Europe' },
  { name: 'Frankfurt', iata: 'FRA', lat: 50.0379, lng: 8.5622, region: 'Europe' },
  { name: 'Istanbul', iata: 'IST', lat: 41.2753, lng: 28.7519, region: 'Europe' },
  { name: 'Moscow', iata: 'SVO', lat: 55.9726, lng: 37.4146, region: 'Europe' },
  // Middle East
  { name: 'Dubai', iata: 'DXB', lat: 25.2532, lng: 55.3657, region: 'Middle East' },
  { name: 'Doha', iata: 'DOH', lat: 25.2609, lng: 51.6138, region: 'Middle East' },
  // Africa
  { name: 'Cairo', iata: 'CAI', lat: 30.1219, lng: 31.4056, region: 'Africa' },
  { name: 'Cape Town', iata: 'CPT', lat: -33.9715, lng: 18.6021, region: 'Africa' },
  { name: 'Johannesburg', iata: 'JNB', lat: -26.1392, lng: 28.2460, region: 'Africa' },
  // South Asia
  { name: 'Mumbai', iata: 'BOM', lat: 19.0896, lng: 72.8656, region: 'South Asia' },
  { name: 'Delhi', iata: 'DEL', lat: 28.5562, lng: 77.1000, region: 'South Asia' },
  { name: 'Chennai', iata: 'MAA', lat: 12.9941, lng: 80.1709, region: 'South Asia' },
  { name: 'Bangalore', iata: 'BLR', lat: 13.1986, lng: 77.7066, region: 'South Asia' },
  // East/SE Asia
  { name: 'Tokyo', iata: 'NRT', lat: 35.7647, lng: 140.3864, region: 'East Asia' },
  { name: 'Beijing', iata: 'PEK', lat: 40.0799, lng: 116.6031, region: 'East Asia' },
  { name: 'Shanghai', iata: 'PVG', lat: 31.1443, lng: 121.8083, region: 'East Asia' },
  { name: 'Hong Kong', iata: 'HKG', lat: 22.3080, lng: 113.9185, region: 'East Asia' },
  { name: 'Singapore', iata: 'SIN', lat: 1.3644, lng: 103.9915, region: 'Southeast Asia' },
  { name: 'Bangkok', iata: 'BKK', lat: 13.6900, lng: 100.7501, region: 'Southeast Asia' },
  // Oceania
  { name: 'Sydney', iata: 'SYD', lat: -33.9461, lng: 151.1772, region: 'Oceania' },
  { name: 'Melbourne', iata: 'MEL', lat: -37.6690, lng: 144.8410, region: 'Oceania' },
  { name: 'Auckland', iata: 'AKL', lat: -37.0082, lng: 174.7850, region: 'Oceania' },
];

// Haversine distance in km (Earth radius = 6371km)
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Real-world aircraft performance data
export const AIRCRAFT = {
  name: 'Boeing 787-9 Dreamliner',
  cruiseSpeedKmh: 903,
  cruiseAltitudeFt: 39000,
  fuelBurnKgPerKm: 5.2, // ~5.2 kg/km at cruise
  co2PerKgFuel: 3.16, // kg CO2 per kg jet fuel
  maxRangeKm: 14140,
} as const;

// Compute real flight stats
export function computeFlightStats(
  geodesicKm: number,
  astarKm: number,
) {
  const aircraft = AIRCRAFT;
  const detourPercent = ((astarKm - geodesicKm) / geodesicKm) * 100;
  const estimatedHours = astarKm / aircraft.cruiseSpeedKmh;
  const geodesicHours = geodesicKm / aircraft.cruiseSpeedKmh;
  const fuelKg = astarKm * aircraft.fuelBurnKgPerKm;
  const geodesicFuelKg = geodesicKm * aircraft.fuelBurnKgPerKm;
  const co2Kg = fuelKg * aircraft.co2PerKgFuel;
  const geodesicCo2Kg = geodesicFuelKg * aircraft.co2PerKgFuel;
  // Storm penalty: flying through storms uses ~12-18% more fuel due to turbulence/headwinds
  const stormFuelPenaltyPercent = 15;
  const fuelSavedByAvoidingStorms = geodesicFuelKg * (stormFuelPenaltyPercent / 100);
  const netFuelDifference = (fuelKg - geodesicFuelKg) - fuelSavedByAvoidingStorms;

  return {
    geodesicKm: Math.round(geodesicKm),
    astarKm: Math.round(astarKm),
    detourPercent: Math.max(0, detourPercent).toFixed(1),
    estimatedHours: estimatedHours.toFixed(1),
    geodesicHours: geodesicHours.toFixed(1),
    fuelKg: Math.round(fuelKg),
    geodesicFuelKg: Math.round(geodesicFuelKg),
    co2Kg: Math.round(co2Kg),
    geodesicCo2Kg: Math.round(geodesicCo2Kg),
    fuelSavedKg: Math.round(Math.max(0, fuelSavedByAvoidingStorms - (fuelKg - geodesicFuelKg))),
    netSavingsPercent: Math.max(0, ((fuelSavedByAvoidingStorms - (fuelKg - geodesicFuelKg)) / geodesicFuelKg) * 100).toFixed(1),
    cruiseAltitude: aircraft.cruiseAltitudeFt,
    cruiseSpeed: aircraft.cruiseSpeedKmh,
    aircraftName: aircraft.name,
    inRange: astarKm <= aircraft.maxRangeKm,
  };
}
