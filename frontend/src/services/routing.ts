/**
 * JalDurbin Coastal GIS: Weather & Mud Routing Penalty Service.
 *
 * Integrates Open-Meteo live atmospheric observations with OSRM foot routing:
 * - Fetches real-time precipitation & WMO weather code for origin coordinates.
 * - If precipitation > 0 mm (active rain / saturated mud dykes), applies a 1.75x walking penalty
 *   (reducing pedestrian speed from ~5.0 km/h down to ~2.8 km/h along slippery earthen dykes).
 * - Dynamically updates route fatigue status and polyline coloring.
 */

import { Coordinates, FindNearestResponse } from "@/types/routing";

export interface LiveWeatherCondition {
  precipitation: number; // in mm
  weatherCode: number;
  isRaining: boolean;
  penaltyMultiplier: number; // 1.75 when raining, 1.0 when dry
  label: string;
  shortLabel: string;
  conditionDescription: string;
  speedKmh: number; // 2.8 km/h if rain, 5.0 km/h standard
  lastUpdated?: string;
}

export const DRY_WEATHER_CONDITION: LiveWeatherCondition = {
  precipitation: 0.0,
  weatherCode: 0,
  isRaining: false,
  penaltyMultiplier: 1.0,
  label: "Dry Conditions: Standard walking speed (~3.5–5.0 km/h)",
  shortLabel: "Dry Conditions",
  conditionDescription: "Clear / Dry Trails",
  speedKmh: 5.0
};

/**
 * Maps WMO Weather Code to human-readable description and rain classification.
 */
export function parseWmoWeatherCode(code: number, precipitation: number): {
  isRaining: boolean;
  description: string;
  shortLabel: string;
  label: string;
} {
  const isWet = precipitation > 0 || (code >= 51 && code <= 99);

  let desc = "Clear Sky";
  if (code === 0) desc = "Clear Sky";
  else if (code >= 1 && code <= 3) desc = "Partly Cloudy / Overcast";
  else if (code === 45 || code === 48) desc = "Coastal Fog / Mist";
  else if (code >= 51 && code <= 55) desc = "Light Drizzle";
  else if (code >= 61 && code <= 63) desc = "Moderate Rain";
  else if (code >= 65 && code <= 67) desc = "Heavy Coastal Downpour";
  else if (code >= 80 && code <= 82) desc = "Monsoon Showers";
  else if (code >= 95) desc = "Delta Thunderstorm";

  if (isWet) {
    return {
      isRaining: true,
      description: desc,
      shortLabel: `Rain (${precipitation > 0 ? `${precipitation}mm` : "Mud 1.75x"})`,
      label: `${desc} (${precipitation} mm): Embankments muddy & slippery. Walking speed reduced to ~2.8 km/h (1.75x penalty).`
    };
  }

  return {
    isRaining: false,
    description: desc,
    shortLabel: "Dry Conditions",
    label: `${desc}: Embankment paths firm. Standard walking speed (~3.5–5.0 km/h).`
  };
}

/**
 * Fetches real-time weather from Open-Meteo for given coordinates.
 */
export async function fetchCurrentWeather(
  coords: Coordinates,
  signal?: AbortSignal
): Promise<LiveWeatherCondition> {
  try {
    const lat = coords.lat.toFixed(4);
    const lon = coords.lng.toFixed(4);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,weather_code,weathercode`;

    const res = await fetch(url, { signal: signal || AbortSignal.timeout(4500) });
    if (!res.ok) {
      return DRY_WEATHER_CONDITION;
    }

    const data = await res.json();
    const current = data.current || {};
    const precip = Number(current.precipitation ?? 0);
    const code = Number(current.weather_code ?? current.weathercode ?? 0);

    const parsed = parseWmoWeatherCode(code, precip);
    const penalty = parsed.isRaining ? 1.75 : 1.0;

    return {
      precipitation: precip,
      weatherCode: code,
      isRaining: parsed.isRaining,
      penaltyMultiplier: penalty,
      label: parsed.label,
      shortLabel: parsed.shortLabel,
      conditionDescription: parsed.description,
      speedKmh: parsed.isRaining ? 2.8 : 5.0,
      lastUpdated: current.time || new Date().toISOString()
    };
  } catch {
    // Graceful offline fallback
    return DRY_WEATHER_CONDITION;
  }
}

/**
 * Applies the weather penalty to route duration and adjusts fatigue metrics.
 */
export function applyWeatherPenaltyToRoute(
  route: FindNearestResponse,
  weather: LiveWeatherCondition
): FindNearestResponse {
  if (!route) return route;

  const multiplier = weather.penaltyMultiplier;
  const baseMinutes = (route as any).base_walk_time_minutes ?? route.est_walk_time_minutes;
  const penalizedMinutes = Math.round(baseMinutes * multiplier * 10) / 10;

  // Clone route object to preserve immutability
  const updatedRoute: FindNearestResponse & { base_walk_time_minutes?: number } = {
    ...route,
    est_walk_time_minutes: penalizedMinutes,
    fatigue_warning: penalizedMinutes > 30 || route.straight_line_distance_meters > 2500,
    base_walk_time_minutes: baseMinutes
  };

  // Also penalize bypassed unsafe route duration if present
  if (updatedRoute.bypassed_unsafe_source) {
    const bypassed = updatedRoute.bypassed_unsafe_source;
    const baseBypassedMinutes =
      (bypassed as any).base_walk_time_minutes ?? bypassed.est_walk_time_minutes;
    const penalizedBypassedMinutes = Math.round(baseBypassedMinutes * multiplier * 10) / 10;
    const deltaMinutes = Math.round(Math.max(0, penalizedMinutes - penalizedBypassedMinutes) * 10) / 10;

    updatedRoute.bypassed_unsafe_source = {
      ...bypassed,
      est_walk_time_minutes: penalizedBypassedMinutes,
      delta_walk_time_minutes: deltaMinutes,
      ...{ base_walk_time_minutes: baseBypassedMinutes }
    };
  }

  return updatedRoute;
}
