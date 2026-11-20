#!/usr/bin/env python3
"""
Direct Migration Tool for Supabase PostgreSQL.
Handles schema initialization with PostGIS under 'extensions' schema,
and bulk-inserts records directly with asyncpg.
"""
import os
import sys
import argparse
import asyncio
import ssl
import pandas as pd
import asyncpg

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.water_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    location extensions.geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_points_location ON public.water_points USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_water_points_maternal_safe ON public.water_points (is_maternal_safe);
"""

UPSERT_SQL = """
INSERT INTO public.water_points (
    external_code, source_type, functional_status,
    salinity_ppt, sodium_mg_l, chloride_mg_l, tds_mg_l, is_maternal_safe,
    potable, queue_time_mins, elevation_m, location
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
    extensions.ST_SetSRID(extensions.ST_MakePoint($12, $13), 4326)
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
"""

async def run_migration(target_url: str):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(os.path.dirname(script_dir))
    csv_path = os.path.join(project_dir, "data", "wpdx_coastal_cleaned.csv")
    
    if not os.path.exists(csv_path):
        print(f"[Error] Dataset not found: {csv_path}", file=sys.stderr)
        sys.exit(1)
        
    print(f"==> Reading coastal dataset: {csv_path}...")
    df = pd.read_csv(csv_path)
    total_records = len(df)
    print(f"==> Loaded {total_records:,} coastal water point records.")
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    print(f"==> Connecting to remote database...")
    try:
        conn = await asyncpg.connect(target_url, ssl=ctx, statement_cache_size=0, timeout=15)
    except Exception as e:
        print(f"[Fatal Connection Error] Could not connect to target database: {e}", file=sys.stderr)
        sys.exit(1)
        
    try:
        print("==> Initializing PostGIS extensions and schema in Supabase...")
        await conn.execute(SCHEMA_SQL)
        print("[OK] PostGIS schema initialized successfully with search_path = public, extensions.")
        
        # Batch insert
        batch_size = 500
        records = df.to_dict(orient="records")
        inserted = 0
        
        print(f"==> Streaming {total_records:,} records into public.water_points...")
        for i in range(0, total_records, batch_size):
            chunk = records[i:i + batch_size]
            batch_data = [
                (
                    str(r["external_code"]),
                    str(r.get("source_type", "shallow_tube_well")),
                    str(r.get("functional_status", "functional")),
                    float(r["salinity_ppt"]) if pd.notna(r.get("salinity_ppt")) else None,
                    float(r["sodium_mg_l"]) if pd.notna(r.get("sodium_mg_l")) else None,
                    float(r["chloride_mg_l"]) if pd.notna(r.get("chloride_mg_l")) else None,
                    float(r["tds_mg_l"]) if pd.notna(r.get("tds_mg_l")) else None,
                    bool(r.get("is_maternal_safe", True)),
                    bool(r.get("potable", True)),
                    int(r.get("queue_time_mins", 0)) if pd.notna(r.get("queue_time_mins")) else 0,
                    float(r["elevation_m"]) if pd.notna(r.get("elevation_m")) else None,
                    float(r.get("longitude", r.get("lon_deg", 0.0))),
                    float(r.get("latitude", r.get("lat_deg", 0.0)))
                )
                for r in chunk
            ]
            await conn.executemany(UPSERT_SQL, batch_data)
            inserted += len(chunk)
            if inserted % 2500 == 0 or inserted == total_records:
                print(f"    - Ingested {inserted:,} / {total_records:,} points...")
                
        # Verification query
        count_row = await conn.fetchrow("""
            SELECT 
                COUNT(*) AS total_points,
                COUNT(*) FILTER (WHERE is_maternal_safe) AS maternal_safe_count,
                COUNT(*) FILTER (WHERE location IS NOT NULL) AS valid_geometry_count
            FROM public.water_points;
        """)
        
        print("\n" + "=" * 60)
        print("[MIGRATION SUCCESS REPORT]")
        print(f"Total Imported Water Points: {count_row['total_points']:,}")
        print(f"Maternal-Safe Points:        {count_row['maternal_safe_count']:,}")
        print(f"Valid PostGIS Geometries:    {count_row['valid_geometry_count']:,}")
        print("=" * 60)
        
    finally:
        await conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, help="Target PostgreSQL connection string")
    args = parser.parse_args()
    asyncio.run(run_migration(args.target))
