import {
  WaterPointGeoJSONCollection,
  WaterPointGeoJSONFeature,
  FindNearestResponse,
  BypassedUnsafeSource
} from "@/types/routing";
import southwestData from "./southwest_water_points.json";

// Raw baseline features from verified survey dataset
export const BASELINE_SOUTHWEST_WATER_POINTS: WaterPointGeoJSONFeature[] = (
  southwestData as WaterPointGeoJSONCollection
).features;

export const PEDESTRIAN_TORTUOSITY_FACTOR = 1.35; // Embankment winding factor

/**
 * Transforms water points based on seasonal hydrology:
 * - "dry_season": 1.4x salinity/sodium spike in shallow wells and unlined PSFs due to evapo-concentration.
 *   Points crossing 300 mg/L sodium turn unsafe for maternal health. Shallow unlined PSFs lose functional yield.
 * - "monsoon": Baseline monsoon freshwater recharge; surface ponds diluted.
 */
export function applySeasonalAquiferShift(
  features: WaterPointGeoJSONFeature[],
  season: "monsoon" | "dry_season"
): WaterPointGeoJSONFeature[] {
  return features.map((f) => {
    const props = { ...f.properties };
    const stype = props.source_type.toLowerCase();
    const elev = props.elevation_m ?? 2.0;

    if (season === "dry_season") {
      // Shallow aquifers, PSFs, and low-lying wells subject to dry-season brackish intrusion
      if (
        stype === "psf" ||
        stype === "shallow_tube_well" ||
        (stype === "deep_tube_well" && elev < 2.2)
      ) {
        if (props.sodium_mg_l !== null && props.sodium_mg_l !== undefined) {
          props.sodium_mg_l = Math.round(props.sodium_mg_l * 1.4 * 10) / 10;
        }
        if (props.salinity_ppt !== null && props.salinity_ppt !== undefined) {
          props.salinity_ppt = Math.round(props.salinity_ppt * 1.4 * 100) / 100;
        }
        if (props.chloride_mg_l !== null && props.chloride_mg_l !== undefined) {
          props.chloride_mg_l = Math.round(props.chloride_mg_l * 1.4 * 10) / 10;
        }

        // Deplete unlined shallow PSFs during dry season (below 1.8m elevation)
        if (stype === "psf" && elev < 1.8) {
          props.functional_status = "partially_functional";
        }

        // Re-evaluate maternal health threshold (Sodium <= 300 mg/L)
        if (props.sodium_mg_l !== null && props.sodium_mg_l !== undefined) {
          props.is_maternal_safe = props.sodium_mg_l <= 300.0;
        }

        // Peak dry season queue surge due to local well drying
        if (props.est_queue_time_mins) {
          props.est_queue_time_mins = Math.min(60, Math.round(props.est_queue_time_mins * 1.3));
          props.queue_time_mins = props.est_queue_time_mins;
        }
      }
    } else {
      // Monsoon / Post-Monsoon recharge
      if (stype === "psf" && props.functional_status === "partially_functional") {
        props.functional_status = "functional";
      }
    }

    return {
      ...f,
      properties: props
    };
  });
}

export const SOUTHWEST_BANGLADESH_WATER_POINTS: WaterPointGeoJSONFeature[] =
  applySeasonalAquiferShift(BASELINE_SOUTHWEST_WATER_POINTS, "dry_season");

export const SOUTHWEST_BANGLADESH_COLLECTION: WaterPointGeoJSONCollection = {
  type: "FeatureCollection",
  features: SOUTHWEST_BANGLADESH_WATER_POINTS
};

/**
 * Calculates Great-Circle geodesic distance in meters between two lat/lon coordinates.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Generates realistic rural embankment and dyke footpath waypoints snapping around tidal canals.
 */
export function generateEmbankmentFootpathGeometry(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): {
  type: "LineString";
  coordinates: [number, number][]; // [[lon, lat], ...]
} {
  const dx = destLon - originLon;
  const dy = destLat - originLat;
  const length = Math.hypot(dx, dy);

  if (length < 1e-6) {
    return {
      type: "LineString",
      coordinates: [
        [originLon, originLat],
        [destLon, destLat]
      ]
    };
  }

  // Perpendicular unit vector
  const perpX = -dy / length;
  const perpY = dx / length;

  // Meander amplitude (approx 20 to 50 meters in degrees)
  const amplitude = Math.min(0.0006, Math.max(0.00018, length * 0.085));

  // Sample intermediate dyke berm points
  const w1: [number, number] = [
    Number((originLon + 0.20 * dx + perpX * amplitude * 0.75).toFixed(6)),
    Number((originLat + 0.20 * dy + perpY * amplitude * 0.75).toFixed(6))
  ];
  const w2: [number, number] = [
    Number((originLon + 0.45 * dx - perpX * amplitude * 0.60).toFixed(6)),
    Number((originLat + 0.45 * dy - perpY * amplitude * 0.60).toFixed(6))
  ];
  const w3: [number, number] = [
    Number((originLon + 0.72 * dx + perpX * amplitude * 0.45).toFixed(6)),
    Number((originLat + 0.72 * dy + perpY * amplitude * 0.45).toFixed(6))
  ];
  const w4: [number, number] = [
    Number((originLon + 0.88 * dx - perpX * amplitude * 0.20).toFixed(6)),
    Number((originLat + 0.88 * dy - perpY * amplitude * 0.20).toFixed(6))
  ];

  return {
    type: "LineString",
    coordinates: [
      [Number(originLon.toFixed(6)), Number(originLat.toFixed(6))],
      w1,
      w2,
      w3,
      w4,
      [Number(destLon.toFixed(6)), Number(destLat.toFixed(6))]
    ]
  };
}

/**
 * Walking duration calculation adjusted with 1.35x rural embankment tortuosity.
 * Speed: 3.5 km/h = 58.333 m/min.
 */
export function calculateWalkingMetrics(straightDistanceMeters: number): {
  effectiveDistanceMeters: number;
  estWalkTimeMinutes: number;
  fatigueWarning: boolean;
} {
  const effectiveDistanceMeters = Math.round(straightDistanceMeters * PEDESTRIAN_TORTUOSITY_FACTOR * 10) / 10;
  const metersPerMinute = (3.5 * 1000) / 60;
  const estWalkTimeMinutes = Math.round((effectiveDistanceMeters / metersPerMinute) * 10) / 10;
  const fatigueWarning = straightDistanceMeters > 2500;
  return { effectiveDistanceMeters, estWalkTimeMinutes, fatigueWarning };
}

/**
 * Evaluates nearest water point with seasonal aquifer shifting,
 * embankment footpath multi-segment geometries, and side-by-side maternal protection deltas.
 */
export function evaluateNearestWaterPoint(
  userLat: number,
  userLon: number,
  mode: "standard" | "maternal_safe",
  maxRadiusKm = 5.0,
  candidates: WaterPointGeoJSONFeature[] = SOUTHWEST_BANGLADESH_WATER_POINTS,
  season: "monsoon" | "dry_season" = "dry_season"
): FindNearestResponse {
  const requireSafe = mode === "maternal_safe";

  // Apply seasonal hydrochemistry shifts
  const seasonalCandidates = applySeasonalAquiferShift(candidates, season);

  // Score all functional candidates
  const functionalCandidates = seasonalCandidates
    .filter((pt) => pt.properties.functional_status === "functional")
    .map((pt) => {
      const [ptLon, ptLat] = pt.geometry.coordinates;
      const straightDist = calculateHaversineDistanceMeters(userLat, userLon, ptLat, ptLon);
      const { effectiveDistanceMeters, estWalkTimeMinutes, fatigueWarning } =
        calculateWalkingMetrics(straightDist);
      return {
        feature: pt,
        straightDistanceMeters: straightDist,
        effectiveDistanceMeters,
        estWalkTimeMinutes,
        fatigueWarning
      };
    })
    .sort((a, b) => a.straightDistanceMeters - b.straightDistanceMeters);

  if (functionalCandidates.length === 0) {
    throw new Error("No functional water points found in the region.");
  }

  // Nearest overall candidate regardless of salinity
  const nearestOverall = functionalCandidates[0];

  // Candidates meeting the requested mode safety criteria
  const eligibleModeCandidates = functionalCandidates.filter((item) => {
    if (requireSafe) {
      return item.feature.properties.is_maternal_safe === true;
    }
    return true;
  });

  if (eligibleModeCandidates.length === 0) {
    throw new Error(
      "No accessible water points found matching maternal safe criteria during the active season."
    );
  }

  const chosenTarget = eligibleModeCandidates[0];
  const maxRadiusMeters = maxRadiusKm * 1000;
  const exceedsSafeWalkingRadius = chosenTarget.straightDistanceMeters > maxRadiusMeters;

  const [destLon, destLat] = chosenTarget.feature.geometry.coordinates;
  const routeGeometry = generateEmbankmentFootpathGeometry(userLat, userLon, destLat, destLon);

  // Bypassed closer unsafe source evaluation
  let bypassedUnsafeSource: BypassedUnsafeSource | null = null;
  if (
    requireSafe &&
    !nearestOverall.feature.properties.is_maternal_safe &&
    nearestOverall.feature.properties.id !== chosenTarget.feature.properties.id
  ) {
    const [unsafeLon, unsafeLat] = nearestOverall.feature.geometry.coordinates;
    const unsafeGeometry = generateEmbankmentFootpathGeometry(
      userLat,
      userLon,
      unsafeLat,
      unsafeLon
    );
    const deltaWalkTime = Math.round(
      Math.max(0, chosenTarget.estWalkTimeMinutes - nearestOverall.estWalkTimeMinutes) * 10
    ) / 10;
    const deltaDistance = Math.round(
      Math.max(0, chosenTarget.straightDistanceMeters - nearestOverall.straightDistanceMeters) * 10
    ) / 10;

    bypassedUnsafeSource = {
      destination_water_point: nearestOverall.feature,
      straight_line_distance_meters: nearestOverall.straightDistanceMeters,
      effective_route_distance_meters: nearestOverall.effectiveDistanceMeters,
      est_walk_time_minutes: nearestOverall.estWalkTimeMinutes,
      delta_walk_time_minutes: deltaWalkTime,
      delta_distance_meters: deltaDistance,
      route_geometry: unsafeGeometry
    };
  }

  return {
    destination_water_point: chosenTarget.feature,
    straight_line_distance_meters: chosenTarget.straightDistanceMeters,
    effective_route_distance_meters: chosenTarget.effectiveDistanceMeters,
    est_walk_time_minutes: chosenTarget.estWalkTimeMinutes,
    fatigue_warning: chosenTarget.fatigueWarning,
    exceeds_safe_walking_radius: exceedsSafeWalkingRadius,
    route_geometry: routeGeometry,
    bypassed_unsafe_source: bypassedUnsafeSource,
    season_applied: season
  };
}
