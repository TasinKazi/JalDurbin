from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.routing import RouteRequest, RouteResponse
from app.services.routing_engine import GeospatialRoutingEngine

router = APIRouter()


@router.post("/find-nearest", response_model=RouteResponse, status_code=status.HTTP_200_OK)
async def find_nearest_water_point(
    request: RouteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Finds the nearest accessible coastal water point from the user's origin coordinates.

    - **Coordinates**: (user_lon, user_lat) WGS84 point.
    - **Mode**:
        - `standard`: all functional water points.
        - `maternal_safe`: functional points with verified low salinity (Na+ <= 300 mg/L).
    - **Radius**: Queries within `max_radius_km` (default 5.0 km), expanding if needed with `exceeds_safe_walking_radius=True`.
    - **Fatigue Warning**: Flags routes where one-way walking distance > 2.5 km (round-trip carrying burden > 5.0 km).
    """
    try:
        response = await GeospatialRoutingEngine.calculate_nearest_water_point(
            db_session=db,
            user_lat=request.user_lat,
            user_lon=request.user_lon,
            mode=request.mode,
            max_radius_km=request.max_radius_km or 5.0,
            season=request.season
        )
        return response
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error evaluating nearest water point: {str(e)}"
        )
