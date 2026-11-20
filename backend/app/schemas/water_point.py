from uuid import UUID
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class WaterPointBase(BaseModel):
    external_code: str
    source_type: str = Field(..., description="e.g. deep_tube_well, psf, rainwater_tank, ro_plant")
    functional_status: str = Field("functional", description="functional, partially_functional, dry, abandoned")
    salinity_ppt: Optional[float] = Field(None, ge=0.0, description="Salinity in parts per thousand")
    sodium_mg_l: Optional[float] = Field(None, ge=0.0, description="Sodium concentration in mg/L")
    chloride_mg_l: Optional[float] = Field(None, ge=0.0, description="Chloride concentration in mg/L")
    tds_mg_l: Optional[float] = Field(None, ge=0.0, description="Total dissolved solids in mg/L")
    is_maternal_safe: bool = Field(True, description="Evaluated maternal safety based on sodium threshold (<= 300 mg/L)")
    potable: bool = True
    queue_time_mins: int = Field(0, ge=0)
    est_queue_time_mins: Optional[int] = Field(15, ge=0, description="Estimated queue wait time in minutes")
    elevation_m: Optional[float] = None


class WaterPointCreate(WaterPointBase):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


class WaterPointResponse(WaterPointBase):
    id: UUID
    latitude: float
    longitude: float
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WaterPointGeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: dict
    properties: dict


class WaterPointGeoJSONCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[WaterPointGeoJSONFeature]
