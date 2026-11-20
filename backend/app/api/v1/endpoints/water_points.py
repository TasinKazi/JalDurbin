from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.services.ingestion import WaterPointIngestionService
from app.schemas.water_point import WaterPointGeoJSONCollection, WaterPointGeoJSONFeature

router = APIRouter()


@router.get("", response_model=WaterPointGeoJSONCollection, status_code=status.HTTP_200_OK)
@router.get("/", response_model=WaterPointGeoJSONCollection, status_code=status.HTTP_200_OK)
async def list_water_points(
    min_lon: Optional[float] = Query(None, description="Bounding box minimum longitude (WGS84)"),
    min_lat: Optional[float] = Query(None, description="Bounding box minimum latitude (WGS84)"),
    max_lon: Optional[float] = Query(None, description="Bounding box maximum longitude (WGS84)"),
    max_lat: Optional[float] = Query(None, description="Bounding box maximum latitude (WGS84)"),
    # Compatibility aliases
    min_lng: Optional[float] = Query(None, include_in_schema=False),
    max_lng: Optional[float] = Query(None, include_in_schema=False),
    max_salinity: Optional[float] = Query(None, description="Filter for maximum salinity in ppt"),
    maternal_safe_only: Optional[bool] = Query(None, description="Filter strictly for maternal-safe points (effective Na+ <= 300 mg/L)"),
    db: AsyncSession = Depends(get_db)
):
    """
    Fetch coastal water points within a bounding box (min_lon, min_lat, max_lon, max_lat),
    optionally filtered by maternal safety and salinity thresholds.
    Returns GeoJSON FeatureCollection.
    """
    effective_min_lon = min_lon if min_lon is not None else min_lng
    effective_max_lon = max_lon if max_lon is not None else max_lng

    query = """
        SELECT id, external_code, source_type, functional_status, salinity_ppt,
               sodium_mg_l, chloride_mg_l, tds_mg_l, is_maternal_safe,
               potable, queue_time_mins, est_queue_time_mins, elevation_m,
               ST_X(location::geometry) as lon,
               ST_Y(location::geometry) as lat
        FROM water_points
        WHERE 1=1
    """
    params = {}

    if effective_min_lon is not None and min_lat is not None and effective_max_lon is not None and max_lat is not None:
        query += " AND location && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)"
        params.update({
            "min_lon": effective_min_lon,
            "min_lat": min_lat,
            "max_lon": effective_max_lon,
            "max_lat": max_lat
        })

    if max_salinity is not None:
        query += " AND (salinity_ppt <= :max_salinity OR salinity_ppt IS NULL)"
        params["max_salinity"] = max_salinity

    if maternal_safe_only is not None:
        query += " AND is_maternal_safe = :maternal_safe"
        params["maternal_safe"] = maternal_safe_only

    try:
        result = await db.execute(text(query), params)
        rows = result.mappings().all()
    except Exception as db_err:
        # Fallback to cleaned GeoJSON file if database is offline or not yet initialized
        import os
        import json
        
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
        geojson_candidates = [
            os.path.join(base_dir, "data", "wpdx_coastal_cleaned.geojson"),
            os.path.join(base_dir, "data", "wpdx_southwest_cleaned.geojson")
        ]
        
        target_file = None
        for cand in geojson_candidates:
            if os.path.exists(cand):
                target_file = cand
                break
                
        if target_file:
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                features = data.get("features", [])
                
                # Filter by bounding box
                if effective_min_lon is not None and min_lat is not None and effective_max_lon is not None and max_lat is not None:
                    features = [
                        f for f in features
                        if min_lat <= f["geometry"]["coordinates"][1] <= max_lat
                        and effective_min_lon <= f["geometry"]["coordinates"][0] <= effective_max_lon
                    ]
                    
                if maternal_safe_only is not None:
                    features = [f for f in features if f["properties"].get("is_maternal_safe") == maternal_safe_only]
                    
                if max_salinity is not None:
                    features = [
                        f for f in features
                        if f["properties"].get("salinity_ppt") is None or f["properties"].get("salinity_ppt") <= max_salinity
                    ]
                    
                return WaterPointGeoJSONCollection(
                    type="FeatureCollection",
                    features=[WaterPointGeoJSONFeature(**feat) for feat in features]
                )
            except Exception:
                pass
                
        return WaterPointGeoJSONCollection(type="FeatureCollection", features=[])

    features = []
    for r in rows:
        features.append(WaterPointGeoJSONFeature(
            type="Feature",
            geometry={"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
            properties={
                "id": str(r["id"]),
                "external_code": str(r["external_code"]),
                "source_type": str(r["source_type"]),
                "functional_status": str(r["functional_status"]),
                "salinity_ppt": float(r["salinity_ppt"]) if r.get("salinity_ppt") is not None else None,
                "sodium_mg_l": float(r["sodium_mg_l"]) if r.get("sodium_mg_l") is not None else None,
                "chloride_mg_l": float(r["chloride_mg_l"]) if r.get("chloride_mg_l") is not None else None,
                "tds_mg_l": float(r["tds_mg_l"]) if r.get("tds_mg_l") is not None else None,
                "is_maternal_safe": bool(r.get("is_maternal_safe", True)),
                "potable": bool(r.get("potable", True)),
                "queue_time_mins": int(r.get("queue_time_mins", 0)),
                "est_queue_time_mins": int(r.get("est_queue_time_mins") if r.get("est_queue_time_mins") is not None else r.get("queue_time_mins", 15)),
                "elevation_m": float(r["elevation_m"]) if r.get("elevation_m") is not None else None
            }
        ))
    return WaterPointGeoJSONCollection(type="FeatureCollection", features=features)


@router.post("/ingest/csv")
async def ingest_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Ingest water point survey data from CSV."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")
    
    contents = await file.read()
    try:
        df = WaterPointIngestionService.parse_csv(contents)
        result = await WaterPointIngestionService.batch_ingest(df, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Ingestion failed: {str(e)}")
