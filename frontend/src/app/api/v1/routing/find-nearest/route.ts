import { NextRequest, NextResponse } from "next/server";
import { evaluateNearestWaterPoint } from "@/lib/water-points-data";
import { FindNearestRequest } from "@/types/routing";

export async function POST(req: NextRequest) {
  try {
    const body: FindNearestRequest = await req.json();
    const { user_lat, user_lon, mode = "maternal_safe", max_radius_km = 5.0, season = "dry_season" } = body;

    if (typeof user_lat !== "number" || typeof user_lon !== "number") {
      return NextResponse.json(
        { detail: "Invalid coordinates: user_lat and user_lon are required numbers." },
        { status: 400 }
      );
    }

    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.BACKEND_API_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://jaldurbin.onrender.com"
        : "http://localhost:8000");

    // Attempt to query FastAPI backend if active
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const backendResponse = await fetch(`${backendUrl}/api/v1/routing/find-nearest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_lat,
          user_lon,
          mode,
          max_radius_km,
          season
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (backendResponse.ok) {
        const data = await backendResponse.json();
        // Ensure route_geometry exists for frontend polyline rendering
        if (!data.route_geometry && data.destination_water_point?.geometry?.coordinates) {
          data.route_geometry = {
            type: "LineString",
            coordinates: [
              [user_lon, user_lat],
              data.destination_water_point.geometry.coordinates
            ]
          };
        }
        if (
          data.bypassed_unsafe_source &&
          !data.bypassed_unsafe_source.route_geometry &&
          data.bypassed_unsafe_source.destination_water_point?.geometry?.coordinates
        ) {
          data.bypassed_unsafe_source.route_geometry = {
            type: "LineString",
            coordinates: [
              [user_lon, user_lat],
              data.bypassed_unsafe_source.destination_water_point.geometry.coordinates
            ]
          };
        }
        return NextResponse.json(data);
      }
    } catch {
      // Backend not running or unreachable, seamlessly fall back to local spatial math engine
    }

    // High-precision local fallback engine matching backend logic
    const evaluated = evaluateNearestWaterPoint(user_lat, user_lon, mode, max_radius_km, undefined, season);

    // Query Public OSRM Foot Routing API for realistic topological footpath
    try {
      const [destLon, destLat] = evaluated.destination_water_point.geometry.coordinates;
      const osrmUrl = `http://router.project-osrm.org/route/v1/foot/${user_lon},${user_lat};${destLon},${destLat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(4000) });
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.code === "Ok" && osrmData.routes && osrmData.routes.length > 0) {
          const route = osrmData.routes[0];
          evaluated.route_geometry = route.geometry;
          evaluated.effective_route_distance_meters = Math.round(route.distance * 10) / 10;
          evaluated.est_walk_time_minutes = Math.round((route.duration / 60) * 10) / 10;
          evaluated.fatigue_warning = route.distance > 2500;
        }
      }

      if (evaluated.bypassed_unsafe_source) {
        const [unsafeLon, unsafeLat] =
          evaluated.bypassed_unsafe_source.destination_water_point.geometry.coordinates;
        const unsafeOsrmUrl = `http://router.project-osrm.org/route/v1/foot/${user_lon},${user_lat};${unsafeLon},${unsafeLat}?overview=full&geometries=geojson`;
        const unsafeOsrmRes = await fetch(unsafeOsrmUrl, { signal: AbortSignal.timeout(4000) });
        if (unsafeOsrmRes.ok) {
          const unsafeOsrmData = await unsafeOsrmRes.json();
          if (unsafeOsrmData.code === "Ok" && unsafeOsrmData.routes && unsafeOsrmData.routes.length > 0) {
            const unsafeRoute = unsafeOsrmData.routes[0];
            evaluated.bypassed_unsafe_source.route_geometry = unsafeRoute.geometry;
            evaluated.bypassed_unsafe_source.effective_route_distance_meters =
              Math.round(unsafeRoute.distance * 10) / 10;
            evaluated.bypassed_unsafe_source.est_walk_time_minutes =
              Math.round((unsafeRoute.duration / 60) * 10) / 10;
            evaluated.bypassed_unsafe_source.delta_walk_time_minutes = Math.round(
              Math.max(
                0,
                evaluated.est_walk_time_minutes -
                  evaluated.bypassed_unsafe_source.est_walk_time_minutes
              ) * 10
            ) / 10;
            const effDist = evaluated.effective_route_distance_meters ?? evaluated.straight_line_distance_meters;
            const unsafeEffDist = evaluated.bypassed_unsafe_source.effective_route_distance_meters ?? evaluated.bypassed_unsafe_source.straight_line_distance_meters;
            evaluated.bypassed_unsafe_source.delta_distance_meters = Math.round(
              Math.max(0, effDist - unsafeEffDist) * 10
            ) / 10;
          }
        }
      }
    } catch {
      // OSRM network timeout or offline - seamlessly retain realistic embankment geometry
    }

    return NextResponse.json(evaluated);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Error evaluating nearest water point";
    return NextResponse.json(
      { detail: errorMessage },
      { status: 500 }
    );
  }
}
