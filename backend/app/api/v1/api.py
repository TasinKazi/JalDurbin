from fastapi import APIRouter
from app.api.v1.endpoints import water_points, routing

api_router = APIRouter()
api_router.include_router(water_points.router, prefix="/water-points", tags=["Water Points"])
api_router.include_router(routing.router, prefix="/routing", tags=["Geospatial Routing"])
