import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { BASELINE_SOUTHWEST_WATER_POINTS, applySeasonalAquiferShift } from "@/lib/water-points-data";
import { WaterPointGeoJSONCollection, WaterPointGeoJSONFeature } from "@/types/routing";

// In-memory cache for real coastal WPDX GeoJSON dataset
let cachedWpdxPoints: WaterPointGeoJSONFeature[] | null = null;

function getCoastalWaterPoints(): WaterPointGeoJSONFeature[] {
  if (cachedWpdxPoints && cachedWpdxPoints.length > 0) {
    return cachedWpdxPoints;
  }

  // Look for cleaned WPDX datasets in data/
  const candidatePaths = [
    path.resolve(process.cwd(), "..", "data", "wpdx_coastal_cleaned.geojson"),
    path.resolve(process.cwd(), "data", "wpdx_coastal_cleaned.geojson"),
    path.resolve(process.cwd(), "..", "data", "wpdx_southwest_cleaned.geojson")
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.features) && parsed.features.length > 0) {
          cachedWpdxPoints = parsed.features;
          return cachedWpdxPoints!;
        }
      } catch (err) {
        console.error("Failed reading candidate WPDX GeoJSON:", candidate, err);
      }
    }
  }

  return BASELINE_SOUTHWEST_WATER_POINTS;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_API_URL || "http://localhost:8000";

    // 1. Attempt to query FastAPI backend if active
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const backendResponse = await fetch(`${backendUrl}/api/v1/water-points?${searchParams.toString()}`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (backendResponse.ok) {
        const data: WaterPointGeoJSONCollection = await backendResponse.json();
        if (data && data.features && data.features.length > 0) {
          return NextResponse.json(data);
        }
      }
    } catch {
      // Backend not running or unreachable, seamlessly serve from real dataset
    }

    // 2. Viewport Bounding Box & Query Filters
    const minLat = searchParams.get("min_lat") ? parseFloat(searchParams.get("min_lat")!) : null;
    const maxLat = searchParams.get("max_lat") ? parseFloat(searchParams.get("max_lat")!) : null;
    const minLon = (searchParams.get("min_lon") || searchParams.get("min_lng"))
      ? parseFloat((searchParams.get("min_lon") || searchParams.get("min_lng"))!)
      : null;
    const maxLon = (searchParams.get("max_lon") || searchParams.get("max_lng"))
      ? parseFloat((searchParams.get("max_lon") || searchParams.get("max_lng"))!)
      : null;

    const maternalSafeOnly = searchParams.get("maternal_safe_only") === "true";
    const season = (searchParams.get("season") as "monsoon" | "dry_season") || "dry_season";

    const allPoints = getCoastalWaterPoints();
    let filtered = applySeasonalAquiferShift(allPoints, season);

    // Apply strict Viewport Bounding Box filter
    if (minLat !== null && maxLat !== null && minLon !== null && maxLon !== null) {
      filtered = filtered.filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
      });
    }

    // Apply Maternal Safe Mode filter
    if (maternalSafeOnly) {
      filtered = filtered.filter((f) => f.properties.is_maternal_safe);
    }

    // Cap at 3,500 points per viewport request to preserve client frame rate
    const finalFeatures = filtered.slice(0, 3500);

    return NextResponse.json({
      type: "FeatureCollection",
      features: finalFeatures
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error listing water points";
    return NextResponse.json({ detail: msg }, { status: 500 });
  }
}
