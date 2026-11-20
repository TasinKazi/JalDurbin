"""
JalDurbin Coastal GIS: Southwest Bangladesh High-Density Dataset Seeder.
Covers Khulna & Satkhira (Paikgachha, Shyamnagar, Dacope, Assasuni, Koyra).
Bounds: Latitude 21.8 to 22.8, Longitude 89.0 to 89.8.
"""

import os
import sys
import json
import asyncio
import pandas as pd
from typing import List, Dict, Any

# Ensure backend root is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.core.config import settings
from app.services.ingestion import WaterPointIngestionService
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text


SOUTHWEST_WATER_POINTS_DATA: List[Dict[str, Any]] = [
    # --- Solar RO Desalination Hubs (Low Sodium ~30-70 mg/L) ---
    {
        "external_code": "RO-SHY-001",
        "name": "Shyamnagar Solar Desalination Plant 1",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.3305,
        "longitude": 89.1020,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.08,
        "sodium_mg_l": 38.0,
        "chloride_mg_l": 68.0,
        "tds_mg_l": 115.0,
        "potable": True,
        "queue_time_mins": 25,
        "elevation_m": 2.8,
    },
    {
        "external_code": "RO-SHY-002",
        "name": "Munshiganj Forest Edge Solar RO",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.2150,
        "longitude": 89.1850,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.11,
        "sodium_mg_l": 45.0,
        "chloride_mg_l": 80.0,
        "tds_mg_l": 130.0,
        "potable": True,
        "queue_time_mins": 30,
        "elevation_m": 1.9,
    },
    {
        "external_code": "RO-DAC-001",
        "name": "Chalna Port Solar RO Facility",
        "upazila": "Dacope",
        "district": "Khulna",
        "latitude": 22.4510,
        "longitude": 89.2815,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.09,
        "sodium_mg_l": 42.0,
        "chloride_mg_l": 75.0,
        "tds_mg_l": 120.0,
        "potable": True,
        "queue_time_mins": 15,
        "elevation_m": 3.1,
    },
    {
        "external_code": "RO-PAI-001",
        "name": "Kapilmuni Solar RO Station",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.4850,
        "longitude": 89.2150,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.12,
        "sodium_mg_l": 55.0,
        "chloride_mg_l": 98.0,
        "tds_mg_l": 160.0,
        "potable": True,
        "queue_time_mins": 20,
        "elevation_m": 3.4,
    },
    {
        "external_code": "RO-KOY-001",
        "name": "Koyra Sadar Community RO Hub",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.3420,
        "longitude": 89.3010,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.14,
        "sodium_mg_l": 62.0,
        "chloride_mg_l": 110.0,
        "tds_mg_l": 180.0,
        "potable": True,
        "queue_time_mins": 35,
        "elevation_m": 1.7,
    },
    {
        "external_code": "RO-ASS-001",
        "name": "Assasuni Upazila Health RO",
        "upazila": "Assasuni",
        "district": "Satkhira",
        "latitude": 22.5520,
        "longitude": 89.1680,
        "source_type": "ro_plant",
        "functional_status": "functional",
        "salinity_ppt": 0.10,
        "sodium_mg_l": 48.0,
        "chloride_mg_l": 85.0,
        "tds_mg_l": 140.0,
        "potable": True,
        "queue_time_mins": 18,
        "elevation_m": 3.2,
    },

    # --- Pond Sand Filters (PSF) (Moderate Sodium, 110-230 mg/L) ---
    {
        "external_code": "PSF-PAI-001",
        "name": "Paikgachha Central Community PSF",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.4120,
        "longitude": 89.2080,
        "source_type": "psf",
        "functional_status": "functional",
        "salinity_ppt": 0.38,
        "sodium_mg_l": 145.0,
        "chloride_mg_l": 260.0,
        "tds_mg_l": 410.0,
        "potable": True,
        "queue_time_mins": 15,
        "elevation_m": 2.4,
    },
    {
        "external_code": "PSF-PAI-002",
        "name": "Soladana Union Community PSF",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.3850,
        "longitude": 89.2620,
        "source_type": "psf",
        "functional_status": "functional",
        "salinity_ppt": 0.45,
        "sodium_mg_l": 178.0,
        "chloride_mg_l": 320.0,
        "tds_mg_l": 490.0,
        "potable": True,
        "queue_time_mins": 20,
        "elevation_m": 2.0,
    },
    {
        "external_code": "PSF-SHY-001",
        "name": "Burigoalini Union PSF",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.2450,
        "longitude": 89.1450,
        "source_type": "psf",
        "functional_status": "functional",
        "salinity_ppt": 0.42,
        "sodium_mg_l": 165.0,
        "chloride_mg_l": 300.0,
        "tds_mg_l": 460.0,
        "potable": True,
        "queue_time_mins": 25,
        "elevation_m": 1.8,
    },
    {
        "external_code": "PSF-DAC-001",
        "name": "Pankhali Union Model PSF",
        "upazila": "Dacope",
        "district": "Khulna",
        "latitude": 22.4320,
        "longitude": 89.2480,
        "source_type": "psf",
        "functional_status": "functional",
        "salinity_ppt": 0.35,
        "sodium_mg_l": 135.0,
        "chloride_mg_l": 245.0,
        "tds_mg_l": 380.0,
        "potable": True,
        "queue_time_mins": 12,
        "elevation_m": 2.6,
    },
    {
        "external_code": "PSF-KOY-001",
        "name": "Amadi Union Seasonal PSF",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.4700,
        "longitude": 89.3250,
        "source_type": "psf",
        "functional_status": "functional",
        "salinity_ppt": 0.52,
        "sodium_mg_l": 210.0,
        "chloride_mg_l": 380.0,
        "tds_mg_l": 580.0,
        "potable": True,
        "queue_time_mins": 22,
        "elevation_m": 2.3,
    },
    {
        "external_code": "PSF-ASS-001",
        "name": "Pratapnagar PSF (Post-Cyclone Restored)",
        "upazila": "Assasuni",
        "district": "Satkhira",
        "latitude": 22.3880,
        "longitude": 89.1950,
        "source_type": "psf",
        "functional_status": "partially_functional",
        "salinity_ppt": 0.68,
        "sodium_mg_l": 275.0,
        "chloride_mg_l": 490.0,
        "tds_mg_l": 720.0,
        "potable": True,
        "queue_time_mins": 40,
        "elevation_m": 1.5,
    },

    # --- Rainwater Harvesting Systems (Very Low Sodium ~20-50 mg/L) ---
    {
        "external_code": "RWH-DAC-001",
        "name": "Bajua High School Rainwater Tank",
        "upazila": "Dacope",
        "district": "Khulna",
        "latitude": 22.4200,
        "longitude": 89.2600,
        "source_type": "rainwater_tank",
        "functional_status": "functional",
        "salinity_ppt": 0.05,
        "sodium_mg_l": 25.0,
        "chloride_mg_l": 45.0,
        "tds_mg_l": 70.0,
        "potable": True,
        "queue_time_mins": 8,
        "elevation_m": 3.0,
    },
    {
        "external_code": "RWH-SHY-001",
        "name": "Gabura Cyclone Shelter RWH System",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.2950,
        "longitude": 89.2250,
        "source_type": "rainwater_tank",
        "functional_status": "functional",
        "salinity_ppt": 0.07,
        "sodium_mg_l": 32.0,
        "chloride_mg_l": 58.0,
        "tds_mg_l": 90.0,
        "potable": True,
        "queue_time_mins": 10,
        "elevation_m": 4.5,
    },

    # --- Deep Tube Wells with Sweet Aquifer Access (Maternal Safe <= 300 mg/L) ---
    {
        "external_code": "DTW-PAI-001",
        "name": "Paikgachha Health Complex Deep Well",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.4220,
        "longitude": 89.2150,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 0.58,
        "sodium_mg_l": 285.0,
        "chloride_mg_l": 510.0,
        "tds_mg_l": 760.0,
        "potable": True,
        "queue_time_mins": 18,
        "elevation_m": 3.5,
    },
    {
        "external_code": "DTW-KOY-001",
        "name": "Koyra Upazila Deep Sweet Aquifer",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.3780,
        "longitude": 89.2600,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 0.49,
        "sodium_mg_l": 215.0,
        "chloride_mg_l": 380.0,
        "tds_mg_l": 540.0,
        "potable": True,
        "queue_time_mins": 30,
        "elevation_m": 2.1,
    },

    # --- HIGH SALINITY TUBEWELLS (Unsafe for Maternal Health: >300 up to 1,500+ mg/L) ---
    {
        "external_code": "STW-PAI-001",
        "name": "Paikgachha Bazaar Saline Tubewell",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.4050,
        "longitude": 89.1980,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 1.85,
        "sodium_mg_l": 410.0,  # Unsafe
        "chloride_mg_l": 740.0,
        "tds_mg_l": 1280.0,
        "potable": False,
        "queue_time_mins": 5,
        "elevation_m": 1.8,
    },
    {
        "external_code": "STW-PAI-002",
        "name": "Shibsa Riverbank Handpump",
        "upazila": "Paikgachha",
        "district": "Khulna",
        "latitude": 22.3950,
        "longitude": 89.2100,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 2.65,
        "sodium_mg_l": 590.0,  # Unsafe
        "chloride_mg_l": 1050.0,
        "tds_mg_l": 1780.0,
        "potable": False,
        "queue_time_mins": 8,
        "elevation_m": 1.4,
    },
    {
        "external_code": "STW-ASS-001",
        "name": "Assasuni Sluice Gate Shallow Well",
        "upazila": "Assasuni",
        "district": "Satkhira",
        "latitude": 22.4400,
        "longitude": 89.1700,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 2.40,
        "sodium_mg_l": 520.0,  # Unsafe
        "chloride_mg_l": 920.0,
        "tds_mg_l": 1560.0,
        "potable": False,
        "queue_time_mins": 6,
        "elevation_m": 1.6,
    },
    {
        "external_code": "STW-ASS-002",
        "name": "Kholpetua Embankment Tubewell",
        "upazila": "Assasuni",
        "district": "Satkhira",
        "latitude": 22.4100,
        "longitude": 89.1550,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 3.80,
        "sodium_mg_l": 860.0,  # Unsafe
        "chloride_mg_l": 1540.0,
        "tds_mg_l": 2450.0,
        "potable": False,
        "queue_time_mins": 4,
        "elevation_m": 1.2,
    },
    {
        "external_code": "STW-KOY-001",
        "name": "Bedkashi Coastal Dyke Handpump",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.3600,
        "longitude": 89.2200,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 2.90,
        "sodium_mg_l": 640.0,  # Unsafe
        "chloride_mg_l": 1100.0,
        "tds_mg_l": 1850.0,
        "potable": False,
        "queue_time_mins": 7,
        "elevation_m": 1.2,
    },
    {
        "external_code": "STW-KOY-002",
        "name": "South Bedkashi Sinking Well",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.2800,
        "longitude": 89.2900,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 4.50,
        "sodium_mg_l": 1120.0,  # Extreme Unsafe
        "chloride_mg_l": 2010.0,
        "tds_mg_l": 3100.0,
        "potable": False,
        "queue_time_mins": 5,
        "elevation_m": 0.9,
    },
    {
        "external_code": "STW-SHY-001",
        "name": "Padmapukur Gher Border Well",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.3150,
        "longitude": 89.1650,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 3.10,
        "sodium_mg_l": 710.0,  # Unsafe
        "chloride_mg_l": 1280.0,
        "tds_mg_l": 2100.0,
        "potable": False,
        "queue_time_mins": 10,
        "elevation_m": 1.5,
    },
    {
        "external_code": "STW-SHY-002",
        "name": "Gabura Polder Saline Leak Handpump",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.2850,
        "longitude": 89.2450,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 5.20,
        "sodium_mg_l": 1420.0,  # Critical >1400 mg/L
        "chloride_mg_l": 2560.0,
        "tds_mg_l": 3950.0,
        "potable": False,
        "queue_time_mins": 2,
        "elevation_m": 0.8,
    },
    {
        "external_code": "STW-DAC-001",
        "name": "Sutarkhali Embankment Handpump",
        "upazila": "Dacope",
        "district": "Khulna",
        "latitude": 22.3900,
        "longitude": 89.3100,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 3.40,
        "sodium_mg_l": 780.0,  # Unsafe
        "chloride_mg_l": 1390.0,
        "tds_mg_l": 2250.0,
        "potable": False,
        "queue_time_mins": 5,
        "elevation_m": 1.3,
    },
    {
        "external_code": "STW-DAC-002",
        "name": "Kamarkhola Tidal Flooded Tubewell",
        "upazila": "Dacope",
        "district": "Khulna",
        "latitude": 22.4450,
        "longitude": 89.3350,
        "source_type": "deep_tube_well",
        "functional_status": "functional",
        "salinity_ppt": 4.10,
        "sodium_mg_l": 980.0,  # Unsafe
        "chloride_mg_l": 1780.0,
        "tds_mg_l": 2790.0,
        "potable": False,
        "queue_time_mins": 6,
        "elevation_m": 1.1,
    },

    # --- Inactive / Abandoned / Dry Sources ---
    {
        "external_code": "INACT-SHY-001",
        "name": "Atulia Inundated PSF (Submerged)",
        "upazila": "Shyamnagar",
        "district": "Satkhira",
        "latitude": 22.3600,
        "longitude": 89.1200,
        "source_type": "psf",
        "functional_status": "non-functional",
        "salinity_ppt": 5.80,
        "sodium_mg_l": 1600.0,
        "chloride_mg_l": 2890.0,
        "tds_mg_l": 4400.0,
        "potable": False,
        "queue_time_mins": 0,
        "elevation_m": 0.5,
    },
    {
        "external_code": "INACT-KOY-001",
        "name": "Maharajpur Cracked Deep Well",
        "upazila": "Koyra",
        "district": "Khulna",
        "latitude": 22.3100,
        "longitude": 89.2800,
        "source_type": "deep_tube_well",
        "functional_status": "non-functional",
        "salinity_ppt": 6.10,
        "sodium_mg_l": 1720.0,
        "chloride_mg_l": 3100.0,
        "tds_mg_l": 4750.0,
        "potable": False,
        "queue_time_mins": 0,
        "elevation_m": 0.7,
    }
]


def generate_geojson(data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Converts structured dataset to standard GeoJSON FeatureCollection."""
    features = []
    for item in data:
        # Evaluate stoichiometric sodium and maternal safety
        na_val, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=item.get("sodium_mg_l"),
            chloride_mg_l=item.get("chloride_mg_l"),
            tds_mg_l=item.get("tds_mg_l")
        )

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(item["longitude"]), float(item["latitude"])]
            },
            "properties": {
                "id": item["external_code"].lower(),
                "external_code": item["external_code"],
                "name": item["name"],
                "location_name": f"{item['upazila']}, {item['district']}",
                "source_type": item["source_type"],
                "functional_status": item["functional_status"],
                "salinity_ppt": item.get("salinity_ppt"),
                "sodium_mg_l": item.get("sodium_mg_l", na_val),
                "chloride_mg_l": item.get("chloride_mg_l"),
                "tds_mg_l": item.get("tds_mg_l"),
                "is_maternal_safe": is_safe,
                "potable": item.get("potable", True),
                "queue_time_mins": item.get("queue_time_mins", 0),
                "elevation_m": item.get("elevation_m")
            }
        })
    return {"type": "FeatureCollection", "features": features}


async def seed_database():
    """Seeds the PostGIS database via asyncpg and GeoAlchemy2 if reachable."""
    print("=" * 60)
    print("JalDurbin Southwest Bangladesh Water Point Seeder")
    print("=" * 60)

    # 1. Export CSV
    data_dir = os.path.join(os.path.dirname(backend_dir), "data", "raw")
    os.makedirs(data_dir, exist_ok=True)
    csv_path = os.path.join(data_dir, "southwest_water_points.csv")
    df = pd.DataFrame(SOUTHWEST_WATER_POINTS_DATA)
    df.to_csv(csv_path, index=False)
    print(f"[OK] Saved {len(df)} water points to CSV: {csv_path}")

    # 2. Export GeoJSON for Frontend Direct Import
    frontend_lib_dir = os.path.join(os.path.dirname(backend_dir), "frontend", "src", "lib")
    os.makedirs(frontend_lib_dir, exist_ok=True)
    geojson = generate_geojson(SOUTHWEST_WATER_POINTS_DATA)
    geojson_path = os.path.join(frontend_lib_dir, "southwest_water_points.json")
    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, indent=2)
    print(f"[OK] Exported GeoJSON collection: {geojson_path}")

    # 3. Attempt PostGIS DB connection
    db_url = settings.DATABASE_URL
    print(f"[*] Attempting database connection to {db_url}...")

    try:
        engine = create_async_engine(db_url, echo=False)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            # Check PostGIS extension
            result = await session.execute(text("SELECT PostGIS_Full_Version();"))
            row = result.scalar()
            print(f"[OK] Connected to PostgreSQL. PostGIS: {row}")

            # Ensure table exists
            create_table_stmt = """
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
                est_queue_time_mins INTEGER DEFAULT 15,
                elevation_m FLOAT,
                location GEOMETRY(Point, 4326) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_water_points_location ON water_points USING GIST (location);
            CREATE INDEX IF NOT EXISTS idx_water_points_maternal_safe ON water_points (is_maternal_safe);
            """
            await session.execute(text(create_table_stmt))
            await session.commit()

            # Batch ingest using service
            stats = await WaterPointIngestionService.batch_ingest(df, session)
            print(f"[OK] Successfully ingested {stats['processed']} records into PostGIS database!")

        await engine.dispose()
    except Exception as e:
        print(f"[!] Live PostGIS database is currently not accessible: {e}")
        print("    Data has been successfully exported to CSV and GeoJSON for API and Frontend runtimes.")


if __name__ == "__main__":
    asyncio.run(seed_database())
