export type WaterSourceType = "deep_tube_well" | "psf" | "rainwater_tank" | "ro_plant";
export type FunctionalStatus = "functional" | "partially_functional" | "dry" | "abandoned";

export interface WaterPointProperties {
  id: string;
  external_code: string;
  source_type: WaterSourceType;
  functional_status: FunctionalStatus;
  salinity_ppt: number | null;
  sodium_mg_l: number | null;
  chloride_mg_l: number | null;
  tds_mg_l: number | null;
  is_maternal_safe: boolean;
  potable: boolean;
  queue_time_mins: number;
  elevation_m: number | null;
}

export interface WaterPointFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: WaterPointProperties;
}

export interface WaterPointFeatureCollection {
  type: "FeatureCollection";
  features: WaterPointFeature[];
}
