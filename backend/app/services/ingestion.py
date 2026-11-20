from __future__ import annotations
import io
import math
try:
    import pandas as pd
except ImportError:
    pd = None
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

try:
    from geoalchemy2.shape import from_shape
    from shapely.geometry import Point
except ImportError:
    from_shape = None
    Point = None


class WaterPointIngestionService:
    @staticmethod
    def compute_stoichiometric_sodium(
        sodium_mg_l: Optional[float] = None,
        chloride_mg_l: Optional[float] = None,
        tds_mg_l: Optional[float] = None
    ) -> Tuple[Optional[float], bool]:
        """
        Calculates effective sodium (mg/L) and maternal safety status.
        
        Stoichiometric fallback hierarchy:
        1. Direct measurement: Na+ if available.
        2. Fallback 1: Na+ = 0.55 * Cl- (coastal estuarine ratio).
        3. Fallback 2: Na+ = 0.31 * TDS (total dissolved solids coastal fraction).
        
        Maternal safety rule:
        - If effective Na+ > 300.0 mg/L -> is_maternal_safe = False
        - Otherwise -> is_maternal_safe = True
        """
        effective_na: Optional[float] = None

        def _is_na(val):
            if val is None:
                return True
            if isinstance(val, float) and math.isnan(val):
                return True
            if pd is not None and pd.isna(val):
                return True
            return False

        if sodium_mg_l is not None and not _is_na(sodium_mg_l):
            effective_na = float(sodium_mg_l)
        elif chloride_mg_l is not None and not _is_na(chloride_mg_l):
            effective_na = 0.55 * float(chloride_mg_l)
        elif tds_mg_l is not None and not _is_na(tds_mg_l):
            effective_na = 0.31 * float(tds_mg_l)

        is_safe = True
        if effective_na is not None and effective_na > 300.0:
            is_safe = False

        return effective_na, is_safe

    @classmethod
    def parse_csv(cls, csv_bytes: bytes) -> pd.DataFrame:
        """Parse raw CSV bytes into DataFrame, validate columns, and apply stoichiometric derivations."""
        df = pd.read_csv(io.BytesIO(csv_bytes))
        required_columns = {"external_code", "latitude", "longitude", "source_type"}
        missing = required_columns - set(df.columns)
        if missing:
            raise ValueError(f"Missing required CSV columns: {missing}")
        
        # Coerce types and drop invalid coordinates
        df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
        df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
        df = df.dropna(subset=["latitude", "longitude", "external_code"])
        
        # Valid bounds check
        df = df[(df["latitude"].between(-90, 90)) & (df["longitude"].between(-180, 180))]
        
        # Optional stoichiometric columns
        for col in ["sodium_mg_l", "chloride_mg_l", "tds_mg_l"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            else:
                df[col] = None

        # Compute derived sodium and maternal safety status
        derived = [
            cls.compute_stoichiometric_sodium(
                sodium_mg_l=row.get("sodium_mg_l"),
                chloride_mg_l=row.get("chloride_mg_l"),
                tds_mg_l=row.get("tds_mg_l")
            )
            for _, row in df.iterrows()
        ]
        
        df["effective_sodium_mg_l"] = [d[0] for d in derived]
        df["is_maternal_safe"] = [d[1] for d in derived]

        return df

    @classmethod
    async def batch_ingest(cls, df: pd.DataFrame, db: AsyncSession) -> Dict[str, Any]:
        """Upsert water points into PostGIS with stoichiometric values using GeoAlchemy2/PostGIS SQL."""
        inserted_count = 0
        
        for _, row in df.iterrows():
            effective_na, is_safe = cls.compute_stoichiometric_sodium(
                sodium_mg_l=row.get("sodium_mg_l"),
                chloride_mg_l=row.get("chloride_mg_l"),
                tds_mg_l=row.get("tds_mg_l")
            )
            
            stmt = text("""
                INSERT INTO water_points (
                    id, external_code, source_type, functional_status,
                    salinity_ppt, sodium_mg_l, chloride_mg_l, tds_mg_l, is_maternal_safe,
                    potable, queue_time_mins, est_queue_time_mins, elevation_m, location, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), :code, :stype, :status,
                    :salinity, :sodium, :chloride, :tds, :is_maternal_safe,
                    :potable, :queue, :est_queue, :elev,
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
                    est_queue_time_mins = EXCLUDED.est_queue_time_mins,
                    elevation_m = EXCLUDED.elevation_m,
                    location = EXCLUDED.location,
                    updated_at = NOW()
            """)
            
            await db.execute(stmt, {
                "code": str(row["external_code"]),
                "stype": str(row.get("source_type", "deep_tube_well")),
                "status": str(row.get("functional_status", "functional")),
                "salinity": float(row["salinity_ppt"]) if pd.notna(row.get("salinity_ppt")) else None,
                "sodium": float(row["sodium_mg_l"]) if pd.notna(row.get("sodium_mg_l")) else None,
                "chloride": float(row["chloride_mg_l"]) if pd.notna(row.get("chloride_mg_l")) else None,
                "tds": float(row["tds_mg_l"]) if pd.notna(row.get("tds_mg_l")) else None,
                "is_maternal_safe": bool(is_safe),
                "potable": bool(row.get("potable", True)),
                "queue": int(row.get("queue_time_mins", 0)) if pd.notna(row.get("queue_time_mins")) else 0,
                "est_queue": int(row.get("est_queue_time_mins") or row.get("queue_time_mins") or 15) if pd.notna(row.get("est_queue_time_mins") or row.get("queue_time_mins")) else 15,
                "elev": float(row["elevation_m"]) if pd.notna(row.get("elevation_m")) else None,
                "lng": float(row["longitude"]),
                "lat": float(row["latitude"])
            })
            inserted_count += 1
            
        await db.commit()
        return {"processed": len(df), "status": "success"}
