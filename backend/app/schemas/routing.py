from typing import Optional, Literal, List
from pydantic import BaseModel, Field
from app.schemas.water_point import WaterPointGeoJSONFeature


class RouteRequest(BaseModel):
    user_lat: float = Field(..., ge=-90.0, le=90.0, description="User origin latitude (WGS84)")
    user_lon: float = Field(..., ge=-180.0, le=180.0, description="User origin longitude (WGS84)")
    mode: Literal["standard", "maternal_safe"] = Field(
        "maternal_safe", 
        description="Routing mode: 'standard' (all functional points) or 'maternal_safe' (effective sodium <= 300 mg/L)"
    )
    max_radius_km: Optional[float] = Field(
        5.0, 
        ge=0.1, 
        le=50.0, 
        description="Initial search radius in kilometers. Defaults to 5.0 km."
    )
    season: Literal["monsoon", "dry_season"] = Field(
        "dry_season",
        description="Seasonal hydrological mode: 'monsoon' or 'dry_season' (simulates seasonal salinity spikes & aquifer shifts)"
    )


class BypassedUnsafeSource(BaseModel):
    destination_water_point: WaterPointGeoJSONFeature = Field(..., description="Closer unsafe water point bypassed by maternal safe routing")
    straight_line_distance_meters: float = Field(..., description="Metric geodesic distance to the unsafe point")
    est_walk_time_minutes: float = Field(..., description="Walking time to the unsafe point")
    delta_walk_time_minutes: float = Field(..., description="Extra minutes walked to secure maternal safe water")
    delta_distance_meters: float = Field(..., description="Extra meters walked to secure maternal safe water")
    route_geometry: Optional[dict] = Field(None, description="Multi-segment GeoJSON LineString along dyke footpaths")


class RouteResponse(BaseModel):
    destination_water_point: WaterPointGeoJSONFeature = Field(..., description="Selected nearest water point as GeoJSON Feature")
    straight_line_distance_meters: float = Field(..., description="Metric geodesic distance calculated via PostGIS geography (meters)")
    effective_route_distance_meters: float = Field(..., description="Terrain tortuosity adjusted walking distance along embankments (meters)")
    est_walk_time_minutes: float = Field(..., description="Estimated one-way walking duration assuming rural pace and embankment tortuosity")
    fatigue_warning: bool = Field(..., description="True if one-way distance > 2.5 km (round-trip carrying burden > 5.0 km)")
    exceeds_safe_walking_radius: bool = Field(..., description="True if no candidate was within max_radius_km and expanded fallback was required")
    bypassed_unsafe_source: Optional[BypassedUnsafeSource] = Field(None, description="Closest unsafe source bypassed when in maternal_safe mode")
    route_geometry: Optional[dict] = Field(None, description="Multi-segment GeoJSON LineString along dyke footpaths")
    season_applied: str = Field("dry_season", description="Hydrological season state during evaluation")
