import pytest
from typing import Dict, Any, List, Optional
from app.services.routing_engine import GeospatialRoutingEngine
from app.schemas.routing import RouteResponse


class MockQueryResult:
    def __init__(self, rows: List[Dict[str, Any]]):
        self._rows = rows

    def mappings(self):
        return self

    def all(self) -> List[Dict[str, Any]]:
        return self._rows

    def first(self) -> Optional[Dict[str, Any]]:
        return self._rows[0] if self._rows else None


class MockAsyncSession:
    """
    Mock SQLAlchemy AsyncSession simulating PostGIS spatial queries,
    bounding radius (ST_DWithin), and maternal safety filters.
    """
    def __init__(self, dataset: List[Dict[str, Any]]):
        self.dataset = dataset
        self.executed_queries: List[tuple] = []

    async def execute(self, stmt, params=None):
        self.executed_queries.append((stmt, params or {}))
        candidates = [
            dict(pt) for pt in self.dataset 
            if pt.get("functional_status") == "functional"
        ]
        candidates.sort(key=lambda x: x["distance_meters"])
        return MockQueryResult(candidates)


@pytest.fixture
def mock_coastal_points():
    """Sample dataset featuring near unsafe points, mid-distance safe points, and distant points."""
    return [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "external_code": "WP-UNSAFE-NEAR-200M",
            "source_type": "deep_tube_well",
            "functional_status": "functional",
            "salinity_ppt": 2.8,
            "sodium_mg_l": 380.0,  # > 300 mg/L -> Maternal UNSAFE
            "chloride_mg_l": 720.0,
            "tds_mg_l": 1400.0,
            "is_maternal_safe": False,
            "potable": True,
            "queue_time_mins": 10,
            "elevation_m": 2.1,
            "lon": 91.7850,
            "lat": 22.3580,
            "distance_meters": 200.0
        },
        {
            "id": "22222222-2222-2222-2222-222222222222",
            "external_code": "WP-SAFE-MID-800M",
            "source_type": "psf",
            "functional_status": "functional",
            "salinity_ppt": 0.4,
            "sodium_mg_l": 150.0,  # <= 300 mg/L -> Maternal SAFE
            "chloride_mg_l": 250.0,
            "tds_mg_l": 480.0,
            "is_maternal_safe": True,
            "potable": True,
            "queue_time_mins": 25,
            "elevation_m": 3.4,
            "lon": 91.7900,
            "lat": 22.3620,
            "distance_meters": 800.0
        }
    ]


@pytest.fixture
def mock_distant_points():
    """Sample dataset where all water points exceed 5.0 km."""
    return [
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "external_code": "WP-SAFE-DISTANT-6200M",
            "source_type": "ro_plant",
            "functional_status": "functional",
            "salinity_ppt": 0.2,
            "sodium_mg_l": 95.0,
            "chloride_mg_l": 180.0,
            "tds_mg_l": 320.0,
            "is_maternal_safe": True,
            "potable": True,
            "queue_time_mins": 15,
            "elevation_m": 4.5,
            "lon": 91.8400,
            "lat": 22.4000,
            "distance_meters": 6200.0  # 6.2 km
        }
    ]


class TestRoutingEngine:
    @pytest.mark.asyncio
    async def test_maternal_safe_mode_bypasses_near_unsafe_point(self, mock_coastal_points):
        """
        In 'maternal_safe' mode:
        An unsafe point (direct sodium > 300 mg/L) located 200m away MUST be bypassed
        in favor of a safe point (sodium <= 300 mg/L) located 800m away.
        """
        session = MockAsyncSession(mock_coastal_points)
        response: RouteResponse = await GeospatialRoutingEngine.calculate_nearest_water_point(
            db_session=session,
            user_lat=22.3569,
            user_lon=91.7832,
            mode="maternal_safe",
            max_radius_km=5.0
        )

        # Selected destination must be the 800m safe water point
        assert response.destination_water_point.properties["external_code"] == "WP-SAFE-MID-800M"
        assert response.destination_water_point.properties["is_maternal_safe"] is True
        assert response.destination_water_point.properties["sodium_mg_l"] in (150.0, 210.0)
        assert response.straight_line_distance_meters == 800.0
        assert response.exceeds_safe_walking_radius is False

        # Walking time from OSRM or embankment math
        assert response.est_walk_time_minutes > 0.0
        # Distance <= 2500m -> No fatigue warning
        assert response.fatigue_warning is False

    @pytest.mark.asyncio
    async def test_standard_mode_selects_absolute_nearest(self, mock_coastal_points):
        """
        In 'standard' mode:
        The nearest point (200m) is selected regardless of sodium concentration.
        """
        session = MockAsyncSession(mock_coastal_points)
        response: RouteResponse = await GeospatialRoutingEngine.calculate_nearest_water_point(
            db_session=session,
            user_lat=22.3569,
            user_lon=91.7832,
            mode="standard",
            max_radius_km=5.0
        )

        # Selected destination must be the nearest 200m point
        assert response.destination_water_point.properties["external_code"] == "WP-UNSAFE-NEAR-200M"
        assert response.destination_water_point.properties["sodium_mg_l"] == 380.0
        assert response.straight_line_distance_meters == 200.0
        assert response.exceeds_safe_walking_radius is False

        # Walking time from OSRM or embankment math
        assert response.est_walk_time_minutes > 0.0
        assert response.fatigue_warning is False

    @pytest.mark.asyncio
    async def test_all_points_exceed_five_km_fallback(self, mock_distant_points):
        """
        When all points exceed 5.0 km:
        - The bounded search returns nothing.
        - The unbounded search returns the 6.2 km point.
        - 'exceeds_safe_walking_radius' is set to True.
        - 'fatigue_warning' is set to True (> 2.5 km one-way).
        """
        session = MockAsyncSession(mock_distant_points)
        response: RouteResponse = await GeospatialRoutingEngine.calculate_nearest_water_point(
            db_session=session,
            user_lat=22.3569,
            user_lon=91.7832,
            mode="maternal_safe",
            max_radius_km=5.0
        )

        assert response.destination_water_point.properties["external_code"] == "WP-SAFE-DISTANT-6200M"
        assert response.straight_line_distance_meters == 6200.0
        # Search had to fall back outside 5.0 km
        assert response.exceeds_safe_walking_radius is True
        # One-way distance 6.2 km > 2.5 km -> Fatigue warning triggered
        assert response.fatigue_warning is True
        assert response.est_walk_time_minutes > 0.0

    def test_walking_metrics_and_fatigue_thresholds(self):
        """Verify mathematical precision of walking speed and fatigue boundaries."""
        # 1 km: ~23.1 mins with 1.35x embankment tortuosity, no fatigue warning
        t1, f1 = GeospatialRoutingEngine.calculate_walking_metrics(1000.0)
        assert t1 == 23.1
        assert f1 is False

        # Exactly 2.5 km: 57.9 mins, boundary test (not > 2500m)
        t2, f2 = GeospatialRoutingEngine.calculate_walking_metrics(2500.0)
        assert t2 == 57.9
        assert f2 is False

        # 2501m: > 2.5 km -> triggers fatigue warning
        t3, f3 = GeospatialRoutingEngine.calculate_walking_metrics(2501.0)
        assert t3 == 57.9
        assert f3 is True

    @pytest.mark.asyncio
    async def test_empty_database_raises_value_error(self):
        """Empty database raises ValueError indicating no points found."""
        session = MockAsyncSession([])
        with pytest.raises(ValueError, match="No accessible water points found"):
            await GeospatialRoutingEngine.calculate_nearest_water_point(
                db_session=session,
                user_lat=22.3569,
                user_lon=91.7832,
                mode="maternal_safe",
                max_radius_km=5.0
            )
