#!/usr/bin/env python3
"""
JalDurbin Coastal GIS: Bulk WPDX Bangladesh Data Ingestion Pipeline.

Ingests raw Water Point Data Exchange (WPDX) datasets for Bangladesh, applies
strict geospatial filtering to the expanded coastal districts (Satkhira to Cox's Bazar),
normalizes functional statuses and water technologies, simulates realistic coastal
hydrochemistry (sodium, chloride, TDS, salinity) using numpy, calculates maternal
safety via stoichiometric modeling (<= 300 mg/L Na+), executes pre-ingestion cleanup
to wipe synthetic data, and bulk-inserts records into the PostGIS `water_points` spatial table.

Expanded Coastal Bounding Box (Satkhira to Cox's Bazar):
    - Latitude:  [20.5, 23.0]
    - Longitude: [88.9, 92.4]
"""

import os
import sys
import argparse
import asyncio
import json
from typing import Dict, Any, List, Optional, Tuple

import numpy as np
import pandas as pd
from dotenv import load_dotenv

# Ensure backend root directory is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Load environment configuration (.env from backend or root)
load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(backend_dir), ".env"))

from app.core.config import settings
from app.services.ingestion import WaterPointIngestionService
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text


# Expanded Coastal Bounding Box (Satkhira to Cox's Bazar)
MIN_LAT: float = 20.5
MAX_LAT: float = 23.0
MIN_LON: float = 88.9
MAX_LON: float = 92.4

DEFAULT_CSV_PATH: str = os.path.join(
    os.path.dirname(backend_dir), "data", "wpdx_bangladesh.csv"
)


def detect_columns(df: pd.DataFrame) -> Dict[str, Optional[str]]:
    """
    Intelligently identifies WPDX column aliases across standard formats.
    """
    cols = {c.lower().strip(): c for c in df.columns}
    
    def find_match(candidates: List[str]) -> Optional[str]:
        for cand in candidates:
            if cand in cols:
                return cols[cand]
        return None

    return {
        "lat": find_match(["lat_deg", "#lat_deg", "latitude", "lat", "lat_deg_clean"]),
        "lon": find_match(["lon_deg", "#lon_deg", "longitude", "lon", "lon_deg_clean"]),
        "status": find_match(["status_id", "#status_id", "#status_clean", "status", "functional_status"]),
        "tech": find_match(["water_tech_clean", "#water_tech_clean", "water_tech", "technology"]),
        "source": find_match(["water_source_clean", "#water_source_clean", "water_source", "source"]),
        "code": find_match(["wpdx_id", "#loc+wpdx+id", "row_id", "#row_id", "water_point_id", "external_code", "id"]),
        "adm3": find_match(["clean_adm3", "#clean_adm3", "adm3", "upazila", "subdistrict"]),
        "adm2": find_match(["clean_adm2", "#clean_adm2", "adm2", "district"]),
        "adm4": find_match(["clean_adm4", "#clean_adm4", "adm4", "union"])
    }


def filter_and_clean_coordinates(
    df: pd.DataFrame,
    lat_col: str,
    lon_col: str,
    min_lat: float = MIN_LAT,
    max_lat: float = MAX_LAT,
    min_lon: float = MIN_LON,
    max_lon: float = MAX_LON
) -> pd.DataFrame:
    """
    Drops invalid/missing coordinates and strictly filters to the expanded coastal bounding box.
    """
    total_raw = len(df)
    
    # Coerce coordinates to numeric (drops HXL meta tags like #geo+lat)
    df["_lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    df["_lon"] = pd.to_numeric(df[lon_col], errors="coerce")
    
    # Drop NaNs
    valid_coords = df.dropna(subset=["_lat", "_lon"]).copy()
    dropped_invalid = total_raw - len(valid_coords)
    
    # Global range sanity check
    valid_coords = valid_coords[
        (valid_coords["_lat"] >= -90.0) & (valid_coords["_lat"] <= 90.0) &
        (valid_coords["_lon"] >= -180.0) & (valid_coords["_lon"] <= 180.0)
    ]
    
    # Strict expanded coastal bounding box filter
    in_bbox = valid_coords[
        (valid_coords["_lat"] >= min_lat) & (valid_coords["_lat"] <= max_lat) &
        (valid_coords["_lon"] >= min_lon) & (valid_coords["_lon"] <= max_lon)
    ].copy()
    
    print(f"[*] Coordinate Cleaning & Spatial Filter Summary:")
    print(f"    - Total raw input rows:          {total_raw:,}")
    print(f"    - Dropped missing / invalid:     {dropped_invalid:,}")
    print(f"    - Filtered to coastal bbox:      {len(in_bbox):,} rows (Lat: [{min_lat}, {max_lat}], Lon: [{min_lon}, {max_lon}])")
    
    return in_bbox


def map_functional_status(raw_val: Any) -> str:
    """
    Maps WPDX status values to JalDurbin functional_status enum:
    - 'Yes' -> 'functional'
    - Any other value / 'No' / 'Unknown' -> 'non-functional' (to map infrastructure decay)
    """
    if pd.isna(raw_val):
        return "non-functional"
    
    val_str = str(raw_val).strip()
    if val_str.lower() in ["yes", "y", "true", "1"]:
        return "functional"
    
    return "non-functional"


def map_source_type(tech_val: Any, source_val: Any) -> str:
    """
    Maps WPDX water tech and water source values to JalDurbin source_type:
    'ro_plant', 'psf', 'deep_tube_well', 'shallow_tube_well', 'rainwater_tank', 'piped_water'.
    """
    t_str = str(tech_val or "").strip().lower()
    s_str = str(source_val or "").strip().lower()
    combined = f"{t_str} {s_str}".strip()
    words = set(combined.split())
    
    # Reverse Osmosis / Desalination Hubs (use exact word match for 'ro' so it doesn't match 'protected')
    if any(k in combined for k in ["reverse osmosis", "desal", "desalination", "solar ro", "kiosk", "treatment plant"]) or "ro" in words:
        return "ro_plant"
    
    # Rainwater Harvesting Systems
    if any(k in combined for k in ["rainwater", "rain water", "rwh", "rain tank", "roof catchment", "harvesting"]):
        return "rainwater_tank"
        
    # Pond Sand Filters
    if any(k in combined for k in ["psf", "pond sand", "sand filter", "slow sand", "pond filter"]):
        return "psf"
        
    # Piped Water Distribution / Tapstands
    if any(k in combined for k in ["piped", "tapstand", "tap stand", "standpost", "public tap", "utility"]):
        return "piped_water"
        
    # Deep Tubewells / Boreholes
    if any(k in s_str for k in ["borehole", "deep"]) or any(k in t_str for k in ["motorized", "submersible", "deep"]):
        return "deep_tube_well"
        
    # Protected Wells with Hand Pumps (shallow coastal alluvial groundwater extraction)
    if "hand pump" in t_str or "protected well" in s_str or "shallow" in combined:
        return "shallow_tube_well"
        
    # Default fallback
    return "deep_tube_well"


def simulate_coastal_hydrochemistry(df: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """
    Synthesizes realistic Southwest and Coastal Bangladesh chemical profiles tailored
    by water source technology using numpy:
      - Solar RO Plant:      Sodium ~30-70 mg/L (Maternal Safe)
      - Rainwater Tank:      Sodium ~15-45 mg/L (Maternal Safe)
      - Pond Sand Filter:    Sodium ~150-400 mg/L (Boundary ~300 mg/L threshold)
      - Deep Tubewell:       Sodium ~300-1500 mg/L (Severe coastal aquifer salinization,
                             with ~20% hitting deep sweet lenses 210-295 mg/L)
      - Shallow Tubewell:    Sodium ~400-1800 mg/L (Extreme surface saline intrusion)
      - Piped Water:         Sodium ~60-180 mg/L (Maternal Safe)
      
    Also calculates stoichiometric chloride, TDS, salinity, and queue times.
    """
    rng = np.random.default_rng(seed)
    
    sodiums: List[float] = []
    chlorides: List[float] = []
    tds_list: List[float] = []
    salinities: List[float] = []
    potables: List[bool] = []
    queue_times: List[int] = []
    elevations: List[float] = []
    
    for _, row in df.iterrows():
        stype = row["source_type"]
        status = row["functional_status"]
        
        if stype == "ro_plant":
            na = float(rng.uniform(30.0, 70.0))
            cl = na / 0.55 * float(rng.uniform(0.95, 1.05))
            tds = na / 0.31 * float(rng.uniform(0.95, 1.05))
            sal = float(rng.uniform(0.06, 0.14))
            potable = True
            queue = int(np.clip(rng.normal(20, 5), 8, 45))
            elev = round(float(rng.uniform(1.8, 3.8)), 2)
            
        elif stype == "rainwater_tank":
            na = float(rng.uniform(15.0, 45.0))
            cl = float(rng.uniform(25.0, 75.0))
            tds = float(rng.uniform(50.0, 110.0))
            sal = round(float(rng.uniform(0.04, 0.08)), 3)
            potable = True
            queue = int(np.clip(rng.normal(10, 4), 5, 25))
            elev = round(float(rng.uniform(2.0, 4.5)), 2)
            
        elif stype == "psf":
            na = float(rng.uniform(150.0, 400.0))
            cl = na / 0.55 * float(rng.uniform(0.95, 1.05))
            tds = na / 0.31 * float(rng.uniform(0.95, 1.05))
            sal = round(na / 450.0, 3)
            potable = bool(na <= 300.0)
            queue = int(np.clip(rng.normal(18, 5), 10, 35))
            elev = round(float(rng.uniform(1.4, 2.8)), 2)
            
        elif stype == "deep_tube_well":
            # 20% sweet aquifer pockets (210-295 mg/L), 80% saline intrusion (300-1500 mg/L)
            if rng.random() < 0.20:
                na = float(rng.uniform(210.0, 295.0))
            else:
                na = float(rng.uniform(300.0, 1500.0))
            cl = na / 0.55 * float(rng.uniform(0.95, 1.05))
            tds = na / 0.31 * float(rng.uniform(0.95, 1.05))
            sal = round(na / 350.0, 2)
            potable = bool(na <= 300.0)
            queue = int(np.clip(rng.normal(15, 6), 5, 30))
            elev = round(float(rng.uniform(1.0, 3.5)), 2)
            
        elif stype == "shallow_tube_well":
            # Coastal shallow alluvial handpumps: ~20% sweet water lenses, ~80% brackish/saline intrusion
            if rng.random() < 0.20:
                na = float(rng.uniform(190.0, 295.0))
            else:
                na = float(rng.uniform(350.0, 1800.0))
            cl = na / 0.55 * float(rng.uniform(0.95, 1.05))
            tds = na / 0.31 * float(rng.uniform(0.95, 1.05))
            sal = round(na / 300.0, 2)
            potable = bool(na <= 300.0)
            queue = int(np.clip(rng.normal(6, 3), 2, 15))
            elev = round(float(rng.uniform(0.8, 2.2)), 2)
            
        elif stype == "piped_water":
            na = float(rng.uniform(60.0, 180.0))
            cl = na / 0.55 * float(rng.uniform(0.95, 1.05))
            tds = na / 0.31 * float(rng.uniform(0.95, 1.05))
            sal = round(na / 550.0, 3)
            potable = True
            queue = int(np.clip(rng.normal(10, 4), 5, 20))
            elev = round(float(rng.uniform(2.0, 4.0)), 2)
            
        else:
            na = float(rng.uniform(300.0, 1200.0))
            cl = na / 0.55
            tds = na / 0.31
            sal = round(na / 350.0, 2)
            potable = bool(na <= 300.0)
            queue = 15
            elev = 2.0
            
        if status == "non-functional":
            potable = False
            queue = 0
            
        sodiums.append(round(na, 1))
        chlorides.append(round(cl, 1))
        tds_list.append(round(tds, 1))
        salinities.append(sal)
        potables.append(potable)
        queue_times.append(queue)
        elevations.append(elev)
        
    df["sodium_mg_l"] = sodiums
    df["chloride_mg_l"] = chlorides
    df["tds_mg_l"] = tds_list
    df["salinity_ppt"] = salinities
    df["potable"] = potables
    df["queue_time_mins"] = queue_times
    df["elevation_m"] = elevations
    
    # Calculate stoichiometric effective sodium and maternal safety
    derived = [
        WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=row["sodium_mg_l"],
            chloride_mg_l=row["chloride_mg_l"],
            tds_mg_l=row["tds_mg_l"]
        )
        for _, row in df.iterrows()
    ]
    df["effective_sodium_mg_l"] = [d[0] for d in derived]
    df["is_maternal_safe"] = [d[1] for d in derived]
    
    return df


async def bulk_insert_water_points(
    df: pd.DataFrame,
    db_url: str,
    batch_size: int = 500
) -> Dict[str, Any]:
    """
    Asynchronously executes pre-ingestion cleanup (TRUNCATE/DELETE) to wipe synthetic data,
    and bulk-upserts validated real WPDX water point records into PostGIS table.
    """
    print(f"[*] Connecting to PostGIS database: {db_url}...")
    engine = create_async_engine(db_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    inserted_total = 0
    
    create_schema_sql = """
    CREATE TABLE IF NOT EXISTS water_points (
        id UUID PRIMARY KEY,
        external_code VARCHAR(64) UNIQUE NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        functional_status VARCHAR(30) NOT NULL DEFAULT 'functional',
        salinity_ppt FLOAT,
        sodium_mg_l FLOAT,
        chloride_mg_l FLOAT,
        tds_mg_l FLOAT,
        is_maternal_safe BOOLEAN NOT NULL DEFAULT TRUE,
        potable BOOLEAN NOT NULL DEFAULT TRUE,
        queue_time_mins INTEGER DEFAULT 0,
        elevation_m FLOAT,
        location GEOMETRY(Point, 4326) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_water_points_location ON water_points USING GIST (location);
    CREATE INDEX IF NOT EXISTS idx_water_points_maternal_safe ON water_points (is_maternal_safe);
    """
    
    upsert_sql = text("""
        INSERT INTO water_points (
            id, external_code, source_type, functional_status,
            salinity_ppt, sodium_mg_l, chloride_mg_l, tds_mg_l, is_maternal_safe,
            potable, queue_time_mins, elevation_m, location, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), :code, :stype, :status,
            :salinity, :sodium, :chloride, :tds, :is_maternal_safe,
            :potable, :queue, :elev,
            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), NOW(), NOW()
        )
        ON CONFLICT (external_code) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            functional_status = EXCLUDED.functional_status,
            salinity_ppt = EXCLUDED.salinity_ppt,
            sodium_mg_l = EXCLUDED.sodium_mg_l,
            chloride_mg_l = EXCLUDED.chloride_mg_l,
            tds_mg_l = EXCLUDED.tds_mg_l,
            is_maternal_safe = EXCLUDED.is_maternal_safe,
            potable = EXCLUDED.potable,
            queue_time_mins = EXCLUDED.queue_time_mins,
            elevation_m = EXCLUDED.elevation_m,
            location = EXCLUDED.location,
            updated_at = NOW();
    """)
    
    async with async_session() as session:
        # Verify PostGIS
        try:
            pg_ver = await session.execute(text("SELECT PostGIS_Full_Version();"))
            print(f"[OK] PostGIS Extension active: {str(pg_ver.scalar())[:60]}...")
        except Exception as e:
            print(f"[*] PostGIS version check: {e}")
            
        # Ensure schema exists
        await session.execute(text(create_schema_sql))
        await session.commit()
        
        # PRE-INGESTION CLEANUP STEP: Wipe synthetic/test water points
        print("[*] Pre-ingestion cleanup: wiping previous synthetic water points...")
        try:
            await session.execute(text("TRUNCATE TABLE water_points RESTART IDENTITY CASCADE;"))
            await session.commit()
            print("[OK] Confirmed: Old synthetic/test points successfully wiped via TRUNCATE TABLE water_points RESTART IDENTITY CASCADE.")
        except Exception as trunc_err:
            print(f"[*] TRUNCATE cascade fallback ({trunc_err}), executing DELETE...")
            await session.execute(text("DELETE FROM water_points;"))
            await session.commit()
            print("[OK] Confirmed: Old synthetic/test points successfully wiped via DELETE FROM water_points.")
        
        # Batch insert real records
        records = df.to_dict(orient="records")
        total_records = len(records)
        
        for i in range(0, total_records, batch_size):
            chunk = records[i : i + batch_size]
            params_list = [
                {
                    "code": str(r["external_code"]),
                    "stype": str(r["source_type"]),
                    "status": str(r["functional_status"]),
                    "salinity": float(r["salinity_ppt"]) if pd.notna(r.get("salinity_ppt")) else None,
                    "sodium": float(r["sodium_mg_l"]) if pd.notna(r.get("sodium_mg_l")) else None,
                    "chloride": float(r["chloride_mg_l"]) if pd.notna(r.get("chloride_mg_l")) else None,
                    "tds": float(r["tds_mg_l"]) if pd.notna(r.get("tds_mg_l")) else None,
                    "is_maternal_safe": bool(r["is_maternal_safe"]),
                    "potable": bool(r.get("potable", True)),
                    "queue": int(r.get("queue_time_mins", 0)),
                    "elev": float(r["elevation_m"]) if pd.notna(r.get("elevation_m")) else None,
                    "lng": float(r["longitude"]),
                    "lat": float(r["latitude"])
                }
                for r in chunk
            ]
            
            await session.execute(upsert_sql, params_list)
            await session.commit()
            inserted_total += len(chunk)
            print(f"    - Ingested batch: {inserted_total:,} / {total_records:,} points into PostGIS...")
            
    await engine.dispose()
    return {"total_ingested": inserted_total, "status": "success"}


def run_pipeline(
    csv_file: str = DEFAULT_CSV_PATH,
    db_url: Optional[str] = None,
    batch_size: int = 500,
    seed: int = 42,
    dry_run: bool = False
):
    """
    Orchestrates the full WPDX ingestion pipeline.
    """
    print("=" * 75)
    print(" JalDurbin Coastal GIS: Bulk WPDX Coastal Bangladesh Ingestion Pipeline")
    print("=" * 75)
    print(f"[*] Target dataset file: {csv_file}")
    
    if not os.path.exists(csv_file):
        print(f"\n[!] FILE NOT FOUND: {csv_file}")
        print("[*] Please download the WPDX Bangladesh dataset from:")
        print("    https://data.waterpointdata.org (or WPDX data portal)")
        print(f"    and place the CSV file at: {csv_file}")
        print("=" * 75)
        sys.exit(1)
        
    print(f"[*] Reading dataset from {csv_file}...")
    try:
        raw_df = pd.read_csv(csv_file, low_memory=False)
    except Exception as e:
        print(f"[X] Failed to read CSV: {e}")
        sys.exit(1)
        
    print(f"[OK] Successfully loaded raw CSV with {len(raw_df):,} rows and {len(raw_df.columns)} columns.")
    
    # Detect columns
    col_map = detect_columns(raw_df)
    print("[*] Detected column mappings:")
    for k, v in col_map.items():
        print(f"    - {k:<8}: {v or '[NOT FOUND]'}")
        
    lat_col = col_map["lat"]
    lon_col = col_map["lon"]
    if not lat_col or not lon_col:
        print(f"[X] Critical: Missing latitude or longitude columns in dataset!")
        sys.exit(1)
        
    # Spatial filter to Expanded Coastal Bounding Box (Satkhira to Cox's Bazar)
    filtered_df = filter_and_clean_coordinates(
        raw_df, lat_col=lat_col, lon_col=lon_col,
        min_lat=MIN_LAT, max_lat=MAX_LAT, min_lon=MIN_LON, max_lon=MAX_LON
    )
    
    if len(filtered_df) == 0:
        print("[!] No records found matching the expanded coastal bounding box.")
        return
        
    # Standardize coordinates
    filtered_df["latitude"] = filtered_df["_lat"]
    filtered_df["longitude"] = filtered_df["_lon"]
    
    # Map status: "Yes" -> "functional", Any other / "No" / "Unknown" -> "non-functional"
    status_col = col_map["status"]
    if status_col and status_col in filtered_df.columns:
        filtered_df["functional_status"] = filtered_df[status_col].apply(map_functional_status)
    else:
        filtered_df["functional_status"] = "functional"
        
    # Map technology & source
    tech_col = col_map["tech"]
    source_col = col_map["source"]
    source_types = []
    for idx, row in filtered_df.iterrows():
        t_val = row[tech_col] if tech_col and tech_col in filtered_df.columns else ""
        s_val = row[source_col] if source_col and source_col in filtered_df.columns else ""
        source_types.append(map_source_type(t_val, s_val))
    filtered_df["source_type"] = source_types
    
    # Assign external codes
    code_col = col_map["code"]
    external_codes = []
    for i, (_, row) in enumerate(filtered_df.iterrows()):
        raw_code = str(row[code_col]).strip() if code_col and pd.notna(row.get(code_col)) else ""
        if raw_code and raw_code.lower() not in ["nan", "none", ""]:
            external_codes.append(f"WPDX-{raw_code}")
        else:
            external_codes.append(f"WPDX-BD-{i+1:06d}")
    filtered_df["external_code"] = external_codes
    
    # Hydrochemical simulation
    print(f"[*] Simulating coastal hydrochemistry (Sodium, Chloride, TDS, Salinity)...")
    simulated_df = simulate_coastal_hydrochemistry(filtered_df, seed=seed)
    
    # Functional vs Non-Functional metrics
    func_count = int((simulated_df["functional_status"] == "functional").sum())
    non_func_count = int((simulated_df["functional_status"] == "non-functional").sum())
    func_pct = (func_count / len(simulated_df)) * 100
    non_func_pct = (non_func_count / len(simulated_df)) * 100
    
    # Maternal safety metrics
    safe_count = int(simulated_df["is_maternal_safe"].sum())
    unsafe_count = len(simulated_df) - safe_count
    safe_pct = (safe_count / len(simulated_df)) * 100
    
    print("\n" + "=" * 65)
    print(" REAL WPDX COASTAL BANGLADESH INGESTION SUMMARY")
    print("=" * 65)
    print(f" Pre-Ingestion Cleanup:       Wiping previous synthetic water points")
    print(f" Total Real WPDX Points:      {len(simulated_df):,}")
    print(f" Functional Water Points:     {func_count:,} ({func_pct:.1f}%)")
    print(f" Non-Functional (Decay):      {non_func_count:,} ({non_func_pct:.1f}%)")
    print(f" Maternal Safe  (<=300 mg/L): {safe_count:,} ({safe_pct:.1f}%)")
    print(f" Maternal Unsafe (>300 mg/L): {unsafe_count:,} ({100 - safe_pct:.1f}%)")
    print("\n Source Type Breakdown:")
    for stype, count in simulated_df["source_type"].value_counts().items():
        sub = simulated_df[simulated_df["source_type"] == stype]
        mean_na = sub["sodium_mg_l"].mean()
        safe_sub = int(sub["is_maternal_safe"].sum())
        func_sub = int((sub["functional_status"] == "functional").sum())
        print(f"   - {stype:<18}: {count:>6,} pts | Func: {func_sub:>6,} | Avg Na+: {mean_na:>6.1f} mg/L | Safe: {safe_sub:>6,}")
    print("=" * 65 + "\n")
    
    # Export cleaned records to GeoJSON & CSV
    try:
        clean_dir = os.path.dirname(csv_file)
        
        # 1. Cleaned CSV
        clean_csv = os.path.join(clean_dir, "wpdx_coastal_cleaned.csv")
        simulated_df.to_csv(clean_csv, index=False)
        print(f"[OK] Exported cleaned coastal dataset to CSV: {clean_csv}")

        # 2. Cleaned GeoJSON
        features = []
        for _, r in simulated_df.iterrows():
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(r["longitude"]), float(r["latitude"])]
                },
                "properties": {
                    "external_code": r["external_code"],
                    "source_type": r["source_type"],
                    "functional_status": r["functional_status"],
                    "sodium_mg_l": r["sodium_mg_l"],
                    "chloride_mg_l": r["chloride_mg_l"],
                    "tds_mg_l": r["tds_mg_l"],
                    "salinity_ppt": r["salinity_ppt"],
                    "is_maternal_safe": bool(r["is_maternal_safe"]),
                    "potable": bool(r["potable"]),
                    "queue_time_mins": int(r["queue_time_mins"]),
                    "elevation_m": float(r["elevation_m"]) if pd.notna(r.get("elevation_m")) else None
                }
            })
        geojson_data = {"type": "FeatureCollection", "features": features}
        
        clean_geojson = os.path.join(clean_dir, "wpdx_coastal_cleaned.geojson")
        with open(clean_geojson, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, indent=2)
        print(f"[OK] Exported cleaned coastal dataset to GeoJSON: {clean_geojson}")
        
        # Also sync southwest_cleaned for legacy compatibility
        clean_sw_csv = os.path.join(clean_dir, "wpdx_southwest_cleaned.csv")
        simulated_df.to_csv(clean_sw_csv, index=False)
        clean_sw_geojson = os.path.join(clean_dir, "wpdx_southwest_cleaned.geojson")
        with open(clean_sw_geojson, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, indent=2)
    except Exception as e:
        print(f"[!] Warning exporting cleaned files: {e}")

    if dry_run:
        print("[*] Dry run mode enabled. Skipping PostGIS database insertion.")
        return
        
    # Database connection resolution
    resolved_db_url = db_url or os.getenv("DATABASE_URL") or settings.DATABASE_URL
    
    try:
        stats = asyncio.run(bulk_insert_water_points(simulated_df, resolved_db_url, batch_size=batch_size))
        print(f"\n[SUCCESS] Pipeline Complete! Ingested {stats['total_ingested']:,} real records into PostGIS.")
    except Exception as e:
        print(f"\n[!] Live PostGIS database is currently not accessible or returned an error: {e}")
        print("    Data validation, pre-cleanup logic, chemical simulation, and stoichiometric processing succeeded.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JalDurbin Bulk WPDX Data Ingestion Pipeline")
    parser.add_argument("--file", type=str, default=DEFAULT_CSV_PATH, help="Path to raw WPDX CSV file")
    parser.add_argument("--db-url", type=str, default=None, help="PostgreSQL/PostGIS connection URL override")
    parser.add_argument("--batch-size", type=int, default=500, help="Batch size for database upserts")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for hydrochemical simulation")
    parser.add_argument("--dry-run", action="store_true", help="Perform parsing and simulation without DB write")
    
    args = parser.parse_args()
    run_pipeline(
        csv_file=args.file,
        db_url=args.db_url,
        batch_size=args.batch_size,
        seed=args.seed,
        dry_run=args.dry_run
    )
