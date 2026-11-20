export interface Coordinates {
  lat: number;
  lng: number;
}

export interface WaterPointProperties {
  id: string;
  external_code: string;
  source_type: "deep_tube_well" | "psf" | "rainwater_tank" | "ro_plant" | string;
  functional_status: "functional" | "partially_functional" | "dry" | "abandoned" | string;
  salinity_ppt?: number | null;
  sodium_mg_l?: number | null;
  chloride_mg_l?: number | null;
  tds_mg_l?: number | null;
  is_maternal_safe: boolean;
  potable: boolean;
  queue_time_mins: number;
  est_queue_time_mins?: number;
  flow_rate_l_min?: number;
  functional_neighbors_2km?: number;
  elevation_m?: number | null;
  name?: string;
  location_name?: string;
}

export interface WaterPointGeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lon, lat]
  };
  properties: WaterPointProperties;
}

export interface WaterPointGeoJSONCollection {
  type: "FeatureCollection";
  features: WaterPointGeoJSONFeature[];
}

export interface FindNearestRequest {
  user_lat: number;
  user_lon: number;
  mode: "standard" | "maternal_safe";
  max_radius_km?: number;
  season?: "monsoon" | "dry_season";
}

export interface BypassedUnsafeSource {
  destination_water_point: WaterPointGeoJSONFeature;
  straight_line_distance_meters: number;
  effective_route_distance_meters?: number;
  est_walk_time_minutes: number;
  delta_walk_time_minutes: number;
  delta_distance_meters: number;
  route_geometry?: {
    type: "LineString";
    coordinates: [number, number][]; // [[lon, lat], ...]
  };
}

export interface FindNearestResponse {
  destination_water_point: WaterPointGeoJSONFeature;
  straight_line_distance_meters: number;
  effective_route_distance_meters?: number;
  distance_meters?: number;
  est_walk_time_minutes: number;
  fatigue_warning: boolean;
  exceeds_safe_walking_radius: boolean;
  route_geometry?: {
    type: "LineString";
    coordinates: [number, number][]; // [[lon, lat], ...]
  };
  bypassed_unsafe_source?: BypassedUnsafeSource | null;
  season_applied?: string;
}

export interface RouteRequest {
  user_lat: number;
  user_lon: number;
  mode: "standard" | "maternal_safe";
  max_radius_km?: number;
  season?: "monsoon" | "dry_season";
  origin?: Coordinates;
  destination?: Coordinates;
  maternal_safe_mode?: boolean;
}

export interface RouteResponse extends FindNearestResponse {}

export interface DetectedGpsInfo {
  lat: number;
  lng: number;
  accuracy: number;
  locationName: string;
  isInsideBangladesh: boolean;
  timestamp: number;
}
