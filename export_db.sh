#!/usr/bin/env bash
# JalDurbin PostGIS Export & Migration Script
# Exports PostGIS schema and 18,414 coastal water point records
# Formatted for seamless pipe or migration into Supabase PostgreSQL

set -e

SOURCE_DB="${SOURCE_DB_URL:-postgresql://jaldurbin:jaldurbin_secret@localhost:5432/jaldurbin_gis}"
TARGET_DB="${1:-$TARGET_DB_URL}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV_FILE="${SCRIPT_DIR}/data/wpdx_coastal_cleaned.csv"

# Send diagnostic info to stderr so stdout remains purely executable SQL
echo "==> [JalDurbin DB Export] Initializing PostGIS Schema & Coastal Dataset Exporter..." >&2

generate_sql() {
    cat << 'EOF'
-- ============================================================================
-- JalDurbin Coastal GIS: PostGIS Schema & WPDX Coastal Dataset
-- Compatible with Supabase (extensions schema) & Standard PostGIS Instances
-- ============================================================================

-- Ensure PostGIS & UUID extensions are active in the extensions schema
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Set search_path so spatial types (geometry) and ST_* functions resolve cleanly
SET search_path = public, extensions;

-- Schema Definition
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

-- Spatial GiST Index and Maternal-Safe Filter Index
CREATE INDEX IF NOT EXISTS idx_water_points_location ON public.water_points USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_water_points_maternal_safe ON public.water_points (is_maternal_safe);

EOF

    # If pg_dump is available and local DB responds, dump table data
    if command -v pg_dump >/dev/null 2>&1 && pg_isready -d "$SOURCE_DB" -t 2 >/dev/null 2>&1; then
        echo "==> [JalDurbin DB Export] Extracting records using pg_dump from local PostGIS..." >&2
        pg_dump "$SOURCE_DB" \
            --table=public.water_points \
            --data-only \
            --no-owner \
            --no-privileges \
            --inserts \
            --on-conflict-do-nothing
    elif [ -f "$CSV_FILE" ]; then
        echo "==> [JalDurbin DB Export] Exporting 18,414 coastal records directly from cleaned dataset..." >&2
        python3 "${SCRIPT_DIR}/backend/scripts/generate_sql_dump.py" 2>&1 >&3 3>&- || python "${SCRIPT_DIR}/backend/scripts/generate_sql_dump.py"
    else
        echo "==> [Error] Neither live local PostgreSQL nor ${CSV_FILE} found." >&2
        exit 1
    fi
}

exec 3>&1

if [ -n "$TARGET_DB" ]; then
    echo "==> [JalDurbin DB Export] Piping SQL output directly to target database: ${TARGET_DB%:*}:***" >&2
    if command -v psql >/dev/null 2>&1; then
        generate_sql | psql "$TARGET_DB"
    else
        python "${SCRIPT_DIR}/backend/scripts/pipe_to_supabase.py" --target "$TARGET_DB"
    fi
    echo "==> [JalDurbin DB Export] Migration completed successfully." >&2
else
    # Output raw SQL stream to stdout for piping
    generate_sql
fi
