#!/usr/bin/env python3
"""
JalDurbin Coastal GIS: Dynamic Water Point Population Queue Time Calculator.

Simulates Ganges Delta community water collection dynamics:
1. Base flow rates by water technology (Solar RO = 10 L/min, Deep Tube Well = 20 L/min, PSF = 15 L/min).
2. Spatial isolation proxy using PostGIS ST_DWithin (2,000m radius):
   Isolated points with fewer functional alternatives face severe population surges (up to 2.5x wait multiplier).
3. Updates `water_points` PostGIS table with `est_queue_time_mins`.
4. Synchronizes GeoJSON and CSV runtime datasets for client and API fallback.
"""

import os
import sys
import json
import math
import socket
import asyncio
from collections import defaultdict
from typing import Dict, Any, List, Tuple
from dotenv import load_dotenv

# Ensure backend root is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(backend_dir), ".env"))

from app.core.config import settings


# Technology Base Flow Rates (Liters per Minute)
FLOW_RATES_L_MIN: Dict[str, float] = {
    "ro_plant": 10.0,           # Solar Reverse Osmosis (slow filtration rate)
    "solar_ro": 10.0,
    "deep_tube_well": 20.0,     # Deep motorized / high-yield handpump
    "psf": 15.0,                # Pond Sand Filter (gravity filtration)
    "rainwater_tank": 12.0,     # Rainwater harvesting community reservoir
    "shallow_tube_well": 18.0,  # Shallow manual pump
    "piped_water": 25.0,        # Communal tapstand
}
DEFAULT_FLOW_RATE_L_MIN: float = 15.0

# Typical coastal household collection: 40 liters (two 20L kalshis)
HOUSEHOLD_COLLECTION_LITERS: float = 40.0
# Baseline household queue at common delta collection point
BASELINE_HOUSEHOLD_QUEUE: float = 3.5

# Bengal delta metric conversion factors at ~22.3° latitude
M_PER_DEG_LAT: float = 110750.0
M_PER_DEG_LON: float = 102980.0
MAX_RADIUS_METERS: float = 2000.0
MAX_RADIUS_SQ: float = MAX_RADIUS_METERS * MAX_RADIUS_METERS

# Spatial grid cell size ~2.5 km in degrees
CELL_SIZE_LAT: float = 2500.0 / M_PER_DEG_LAT
CELL_SIZE_LON: float = 2500.0 / M_PER_DEG_LON


def get_base_queue_mins(source_type: str) -> float:
    """Calculates baseline queue duration in minutes from technology flow rate."""
    stype = (source_type or "").lower().strip()
    flow_rate = FLOW_RATES_L_MIN.get(stype, DEFAULT_FLOW_RATE_L_MIN)
    fill_time_per_hh = HOUSEHOLD_COLLECTION_LITERS / flow_rate
    return fill_time_per_hh * BASELINE_HOUSEHOLD_QUEUE


def get_isolation_multiplier(functional_neighbors_2km: int) -> float:
    """
    Population surge multiplier based on spatial isolation (within 2 km buffer).
    Isolated sources serve multiple adjacent villages with no alternative potable points.
    """
    if functional_neighbors_2km == 0:
        return 2.5  # Critical isolation: sole functional source for whole union/ward
    elif functional_neighbors_2km == 1:
        return 2.0  # High isolation: heavy reliance
    elif functional_neighbors_2km == 2:
        return 1.5  # Moderate isolation
    elif functional_neighbors_2km <= 5:
        return 1.0  # Standard coastal baseline
    else:
        return 0.75 # Dense cluster: load distributed across multiple points


def compute_queues_for_features(features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Computes dynamic queue time using 2km spatial isolation on a list of GeoJSON features
    with high-performance 2D spatial grid partitioning.
    """
    grid: Dict[Tuple[int, int], List[Tuple[int, float, float]]] = defaultdict(list)

    # 1. Bucket functional points into spatial grid
    for idx, f in enumerate(features):
        status = f.get("properties", {}).get("functional_status", "functional")
        if status == "functional":
            coords = f.get("geometry", {}).get("coordinates", [0, 0])
            lon, lat = coords[0], coords[1]
            c_x = int(lat / CELL_SIZE_LAT)
            c_y = int(lon / CELL_SIZE_LON)
            grid[(c_x, c_y)].append((idx, lat, lon))

    # 2. Count functional neighbors within 2,000 meters for each point
    updated_features = []
    for idx, f in enumerate(features):
        props = dict(f.get("properties", {}))
        coords = f.get("geometry", {}).get("coordinates", [0, 0])
        lon, lat = coords[0], coords[1]
        source_type = props.get("source_type", "deep_tube_well")
        functional_status = props.get("functional_status", "functional")
        flow_rate = FLOW_RATES_L_MIN.get(str(source_type).lower(), DEFAULT_FLOW_RATE_L_MIN)
        props["flow_rate_l_min"] = flow_rate

        if functional_status != "functional":
            props["est_queue_time_mins"] = 0
            props["queue_time_mins"] = 0
            props["functional_neighbors_2km"] = 0
        else:
            c_x = int(lat / CELL_SIZE_LAT)
            c_y = int(lon / CELL_SIZE_LON)

            neighbors = 0
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    cell_pts = grid.get((c_x + dx, c_y + dy))
                    if not cell_pts:
                        continue
                    for other_idx, other_lat, other_lon in cell_pts:
                        if other_idx != idx:
                            d_lat_m = (lat - other_lat) * M_PER_DEG_LAT
                            d_lon_m = (lon - other_lon) * M_PER_DEG_LON
                            if d_lat_m * d_lat_m + d_lon_m * d_lon_m <= MAX_RADIUS_SQ:
                                neighbors += 1

            base_wait = get_base_queue_mins(source_type)
            multiplier = get_isolation_multiplier(neighbors)
            final_queue = int(round(base_wait * multiplier))
            final_queue = max(5, min(60, final_queue))

            props["est_queue_time_mins"] = final_queue
            props["queue_time_mins"] = final_queue
            props["functional_neighbors_2km"] = neighbors

        updated_features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": props
        })

    return updated_features


def is_postgres_listening(host="localhost", port=5432, timeout_sec=0.5) -> bool:
    """Fast non-blocking socket test to verify if PostgreSQL port is open."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout_sec)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        return False


async def update_postgis_database():
    """
    Connects to PostGIS if running, alters table if necessary, executes spatial ST_DWithin query,
    and updates est_queue_time_mins for all water points.
    """
    if not is_postgres_listening("localhost", 5432):
        print("[*] PostGIS is not currently running on localhost:5432. (Skipping live DB update, using runtime data sync).", flush=True)
        return

    db_url = settings.DATABASE_URL
    print(f"[*] Connecting to PostGIS database at: {db_url}...", flush=True)

    try:
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
        from sqlalchemy import text

        engine = create_async_engine(db_url, echo=False)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            # 1. Add column if it doesn't exist
            await session.execute(text("""
                ALTER TABLE water_points 
                ADD COLUMN IF NOT EXISTS est_queue_time_mins INTEGER DEFAULT 15;
            """))
            await session.commit()
            print("[OK] Column `est_queue_time_mins` verified on `water_points` table.", flush=True)

            # 2. Query spatial isolation with ST_DWithin (2000m)
            query = """
                SELECT 
                    a.id,
                    a.source_type,
                    a.functional_status,
                    COUNT(b.id) FILTER (
                        WHERE b.functional_status = 'functional' 
                          AND b.id != a.id
                    ) AS functional_neighbors_2km
                FROM water_points a
                LEFT JOIN water_points b 
                    ON ST_DWithin(a.location::geography, b.location::geography, 2000)
                GROUP BY a.id, a.source_type, a.functional_status;
            """
            result = await session.execute(text(query))
            rows = result.mappings().all()
            print(f"[*] Calculating dynamic queue times for {len(rows)} PostGIS records...", flush=True)

            update_stmt = text("""
                UPDATE water_points 
                SET est_queue_time_mins = :queue_time,
                    queue_time_mins = :queue_time
                WHERE id = :id;
            """)

            update_params = []
            for r in rows:
                p_id = r["id"]
                stype = r["source_type"]
                fstatus = r["functional_status"]
                neighbors = int(r["functional_neighbors_2km"] or 0)

                if fstatus != "functional":
                    q_mins = 0
                else:
                    base_wait = get_base_queue_mins(stype)
                    multiplier = get_isolation_multiplier(neighbors)
                    q_mins = int(round(base_wait * multiplier))
                    q_mins = max(5, min(60, q_mins))

                update_params.append({"id": p_id, "queue_time": q_mins})

            for chunk_start in range(0, len(update_params), 500):
                chunk = update_params[chunk_start:chunk_start + 500]
                await session.execute(update_stmt, chunk)

            await session.commit()
            print(f"[OK] Successfully updated {len(update_params)} records in PostGIS database!", flush=True)

        await engine.dispose()
    except Exception as e:
        print(f"[!] PostGIS update encountered: {e}", flush=True)


def synchronize_geojson_datasets():
    """
    Updates all project GeoJSON and CSV datasets with the new est_queue_time_mins.
    """
    root_dir = os.path.dirname(backend_dir)
    target_files = [
        os.path.join(root_dir, "frontend", "src", "lib", "southwest_water_points.json"),
        os.path.join(root_dir, "data", "wpdx_southwest_cleaned.geojson"),
        os.path.join(root_dir, "data", "wpdx_coastal_cleaned.geojson"),
    ]

    for fpath in target_files:
        if not os.path.exists(fpath):
            continue
        try:
            print(f"[*] Processing {os.path.basename(fpath)}...", flush=True)
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)

            features = data.get("features", [])
            if not features:
                continue

            updated_features = compute_queues_for_features(features)
            data["features"] = updated_features

            is_small = len(features) < 100
            with open(fpath, "w", encoding="utf-8") as f:
                if is_small:
                    json.dump(data, f, indent=2)
                else:
                    json.dump(data, f)

            print(f"[OK] Successfully updated {len(features)} points in {os.path.basename(fpath)} with `est_queue_time_mins`.", flush=True)
        except Exception as err:
            print(f"[!] Failed updating {fpath}: {err}", flush=True)


def main():
    print("=" * 65, flush=True)
    print("JalDurbin Coastal GIS: Dynamic Queue Times & Spatial Isolation", flush=True)
    print("=" * 65, flush=True)

    # 1. Update PostGIS database if reachable
    asyncio.run(update_postgis_database())

    # 2. Synchronize GeoJSON files
    synchronize_geojson_datasets()

    print("=" * 65, flush=True)
    print("[DONE] Dynamic queue calculation complete across PostGIS and GeoJSON.", flush=True)
    print("=" * 65, flush=True)


if __name__ == "__main__":
    main()
