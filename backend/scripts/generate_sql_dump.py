#!/usr/bin/env python3
"""
Generates raw SQL INSERT statements from wpdx_coastal_cleaned.csv
Streams to stdout formatted for PostGIS / Supabase.
"""
import os
import sys
import pandas as pd

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(os.path.dirname(script_dir))
csv_path = os.path.join(project_dir, "data", "wpdx_coastal_cleaned.csv")

if not os.path.exists(csv_path):
    print(f"-- ERROR: {csv_path} not found", file=sys.stderr)
    sys.exit(1)

df = pd.read_csv(csv_path, low_memory=False)

print("BEGIN;")
print("-- Bulk inserting 18,414 coastal water point records")

batch_size = 500
records = df.to_dict(orient="records")

for i in range(0, len(records), batch_size):
    chunk = records[i:i + batch_size]
    vals = []
    for r in chunk:
        code = str(r.get("external_code", "")).replace("'", "''")
        stype = str(r.get("source_type", "shallow_tube_well")).replace("'", "''")
        status = str(r.get("functional_status", "functional")).replace("'", "''")
        
        sal = "NULL" if pd.isna(r.get("salinity_ppt")) else f"{float(r['salinity_ppt']):.2f}"
        sod = "NULL" if pd.isna(r.get("sodium_mg_l")) else f"{float(r['sodium_mg_l']):.1f}"
        chl = "NULL" if pd.isna(r.get("chloride_mg_l")) else f"{float(r['chloride_mg_l']):.1f}"
        tds = "NULL" if pd.isna(r.get("tds_mg_l")) else f"{float(r['tds_mg_l']):.1f}"
        elev = "NULL" if pd.isna(r.get("elevation_m")) else f"{float(r['elevation_m']):.2f}"
        
        is_safe = "TRUE" if bool(r.get("is_maternal_safe")) else "FALSE"
        potable = "TRUE" if bool(r.get("potable", True)) else "FALSE"
        queue = int(r.get("queue_time_mins", 0)) if pd.notna(r.get("queue_time_mins")) else 0
        
        lon = float(r.get("longitude", r.get("lon_deg", 0.0)))
        lat = float(r.get("latitude", r.get("lat_deg", 0.0)))
        
        val_str = (
            f"(gen_random_uuid(), '{code}', '{stype}', '{status}', {sal}, {sod}, {chl}, {tds}, "
            f"{is_safe}, {potable}, {queue}, {elev}, extensions.ST_SetSRID(extensions.ST_MakePoint({lon}, {lat}), 4326), NOW(), NOW())"
        )
        vals.append(val_str)
    
    insert_stmt = (
        "INSERT INTO public.water_points ("
        "id, external_code, source_type, functional_status, salinity_ppt, sodium_mg_l, chloride_mg_l, tds_mg_l, "
        "is_maternal_safe, potable, queue_time_mins, elevation_m, location, created_at, updated_at) VALUES\n  "
        + ",\n  ".join(vals)
        + "\nON CONFLICT (external_code) DO NOTHING;\n"
    )
    sys.stdout.write(insert_stmt)

print("COMMIT;")
print("-- Verification check query:")
print("SELECT COUNT(*) AS total_water_points, COUNT(*) FILTER (WHERE is_maternal_safe) AS maternal_safe_points FROM public.water_points;")
