CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verification notice
DO $$
BEGIN
    RAISE NOTICE 'PostGIS % initialized successfully.', postgis_full_version();
END $$;
