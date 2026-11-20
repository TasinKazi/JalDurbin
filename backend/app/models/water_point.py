import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Boolean, Integer, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID

try:
    from geoalchemy2 import Geometry
except ImportError:
    # Fallback type for host environments where GeoAlchemy2 is only in Docker
    from sqlalchemy import String as Geometry

from app.core.database import Base


class WaterPoint(Base):
    __tablename__ = "water_points"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    external_code = Column(String(64), unique=True, index=True, nullable=False)
    source_type = Column(String(50), nullable=False)  # deep_tube_well, psf, rainwater_tank, ro_plant
    functional_status = Column(String(30), nullable=False, default="functional")  # functional, partially_functional, dry, abandoned
    salinity_ppt = Column(Float, nullable=True)  # Salinity in parts per thousand (ppt)
    potable = Column(Boolean, nullable=False, default=True)
    queue_time_mins = Column(Integer, default=0)
    est_queue_time_mins = Column(Integer, default=15, nullable=True)  # Dynamic queue wait time based on flow rate & spatial isolation
    elevation_m = Column(Float, nullable=True)
    
    # Stoichiometric water quality parameters & maternal safety classification
    sodium_mg_l = Column(Float, nullable=True)
    chloride_mg_l = Column(Float, nullable=True)
    tds_mg_l = Column(Float, nullable=True)
    is_maternal_safe = Column(Boolean, nullable=False, default=True)
    
    # Point geometry in WGS84 EPSG:4326 with explicit spatial GiST indexing
    location = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=False)
    
    __table_args__ = (
        Index("idx_water_points_location", "location", postgresql_using="gist"),
        Index("idx_water_points_maternal_safe", "is_maternal_safe"),
    )
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
