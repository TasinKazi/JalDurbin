"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Circle,
  useMapEvents,
  useMap
} from "react-leaflet";
import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css";

import {
  WaterPointGeoJSONFeature,
  Coordinates,
  FindNearestResponse,
  DetectedGpsInfo
} from "@/types/routing";
import {
  ShieldCheck,
  AlertTriangle,
  Droplet,
  Clock,
  Navigation,
  Map as MapIcon,
  Satellite,
  XCircle,
  X,
  Compass,
  CheckCircle2,
  AlertOctagon,
  Plus,
  Minus,
  Crosshair,
  Play,
  Pause,
  Target,
  CloudRain
} from "lucide-react";

import { LiveWeatherCondition } from "@/services/routing";
import { ProposedSitingMetrics } from "@/lib/siting";
import RainOverlay from "./RainOverlay";
import WeatherStations from "./WeatherStations";
import SitingLedger from "./SitingLedger";

interface MapProps {
  waterPoints?: WaterPointGeoJSONFeature[];
  origin: Coordinates | null;
  onOriginSelect: (coords: Coordinates) => void;
  activeRoute: FindNearestResponse | null;
  maternalSafeMode: boolean;
  season?: "monsoon" | "dry_season";
  weather?: LiveWeatherCondition | null;
  gpsStatus?: "idle" | "requesting" | "success" | "error";
  gpsErrorMessage?: string | null;
  onClearGpsError?: () => void;
  detectedGps?: DetectedGpsInfo | null;
  onClearDetectedGps?: () => void;
  isAbroadMode?: boolean;
  onTriggerBrowserGps?: () => void;
  flyTarget?: { lat: number; lng: number; zoom?: number; timestamp: number } | null;
  onFlyToRealLocation?: () => void;
  onSimulateKhulnaGps?: () => void;
  isSitingMode?: boolean;
  proposedSite?: Coordinates | null;
  onProposedSiteSelect?: (coords: Coordinates) => void;
  onClearProposedSite?: () => void;
  onCommitProposedNode?: () => void;
  sitingMetrics?: ProposedSitingMetrics | null;
}

// Bangladesh gentle camera boundary (coastal delta focused)
export const BANGLADESH_MAX_BOUNDS: [[number, number], [number, number]] = [
  [20.5, 87.8], // Southwest bound (Bay of Bengal / Sundarbans)
  [26.7, 92.8]  // Northeast bound (Sylhet / Meghalaya border)
];

/**
 * Safely converts any coordinate pair to Leaflet [latitude, longitude].
 * GeoJSON and PostGIS output [longitude, latitude] (e.g., [89.2, 22.4]).
 * Leaflet strictly requires [latitude, longitude] (e.g., [22.4, 89.2]).
 */
export function toLeafletLatLng(coord: [number, number] | number[]): [number, number] {
  if (!coord || coord.length < 2) {
    return [22.408, 89.202]; // Default Paikgachha center
  }
  const [c0, c1] = coord;
  // If first element is longitude (> 50) and second is latitude (< 50), flip to [lat, lon]
  if (c0 > 50 && c1 < 50) {
    return [c1, c0];
  }
  // If already [lat, lon] (c0 < 50 and c1 > 50)
  if (c0 < 50 && c1 > 50) {
    return [c0, c1];
  }
  return [c0, c1];
}

/**
 * Route Fatigue Color Logic:
 * <= 15 mins: #10b981 (Emerald Green - Low Strain)
 * 15-30 mins: #f59e0b (Amber / Yellow - Moderate Fatigue)
 * > 30 mins:  #ef4444 (Rose / Red - Severe Fatigue / Critical Detour)
 */
export const getRouteColor = (durationMinutes: number): string => {
  if (durationMinutes <= 15) return "#10b981"; // Emerald Green (< 15 mins - Low Strain)
  if (durationMinutes <= 30) return "#f59e0b"; // Amber / Yellow (15-30 mins - Moderate Fatigue)
  return "#ef4444"; // Rose / Red (> 30 mins - Severe Fatigue / Critical Detour)
};

export interface FatigueStatus {
  label: "Manageable Walk" | "Moderate Strain" | "High Physical Strain";
  color: string;
  badgeClass: string;
  dotClass: string;
}

export const getFatigueStatus = (durationMinutes: number): FatigueStatus => {
  if (durationMinutes <= 15) {
    return {
      label: "Manageable Walk",
      color: "#10b981",
      badgeClass: "bg-emerald-950/80 text-emerald-300 border-emerald-700/60",
      dotClass: "bg-emerald-400"
    };
  }
  if (durationMinutes <= 30) {
    return {
      label: "Moderate Strain",
      color: "#f59e0b",
      badgeClass: "bg-amber-950/80 text-amber-300 border-amber-700/60",
      dotClass: "bg-amber-400"
    };
  }
  return {
    label: "High Physical Strain",
    color: "#ef4444",
    badgeClass: "bg-rose-950/80 text-rose-300 border-rose-700/60",
    dotClass: "bg-rose-400"
  };
};

// Click listener inside React-Leaflet context
function MapClickHandler({
  onMapClick,
  onProposedSiteClick,
  isSitingMode
}: {
  onMapClick: (coords: Coordinates) => void;
  onProposedSiteClick?: (coords: Coordinates) => void;
  isSitingMode?: boolean;
}) {
  useMapEvents({
    click(e) {
      const coords = {
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6))
      };
      if (isSitingMode && onProposedSiteClick) {
        onProposedSiteClick(coords);
      } else {
        onMapClick(coords);
      }
    }
  });
  return null;
}

// --- High-Precision Spatial Math & Palantir Route Playback Interpolation ---

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

interface PathInterpolation {
  lat: number;
  lon: number;
  bearing: number;
  totalDist: number;
}

function interpolatePath(points: [number, number][], progress: number): PathInterpolation | null {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return { lat: points[0][0], lon: points[0][1], bearing: 0, totalDist: 0 };

  const dists: number[] = [];
  const cumDists: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineMeters(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    dists.push(d);
    cumDists.push(cumDists[i] + d);
  }
  const totalDist = cumDists[cumDists.length - 1];
  if (totalDist === 0) return { lat: points[0][0], lon: points[0][1], bearing: 0, totalDist: 0 };

  const targetDist = Math.max(0, Math.min(1, progress)) * totalDist;
  let segIndex = 0;
  for (let i = 0; i < dists.length; i++) {
    if (targetDist <= cumDists[i + 1] || i === dists.length - 1) {
      segIndex = i;
      break;
    }
  }

  const segDist = dists[segIndex];
  const t = segDist > 0 ? (targetDist - cumDists[segIndex]) / segDist : 0;
  const lat = points[segIndex][0] + t * (points[segIndex + 1][0] - points[segIndex][0]);
  const lon = points[segIndex][1] + t * (points[segIndex + 1][1] - points[segIndex][1]);
  const bearing = calculateBearing(
    points[segIndex][0],
    points[segIndex][1],
    points[segIndex + 1][0],
    points[segIndex + 1][1]
  );

  return { lat, lon, bearing, totalDist };
}

/**
 * Creates the Palantir Convoy Directional Chevron Icon
 * Exactly matches andrewjiang/palantir-for-family-trips CommandMap convoy marker
 */
function createChevronIcon(bearing: number): L.DivIcon {
  return L.divIcon({
    className: "leaflet-marker-convoy-chevron",
    html: `
      <div style="
        position: relative;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${bearing}deg);
        transform-origin: center center;
        transition: transform 0.08s linear;
      ">
        <div style="
          position: absolute;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(14, 165, 233, 0.4);
          filter: blur(4px);
        "></div>
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));"
        >
          <polygon
            points="12,2 22,21 12,16 2,21"
            fill="#0284c7"
            stroke="#ffffff"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <circle cx="12" cy="11" r="2" fill="#ffffff" />
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
}

/**
 * Calculates the cardinal compass heading (e.g. "242° WSW") from origin to target
 */
export function getCompassHeading(lat1: number, lon1: number, lat2: number, lon2: number): {
  bearing: number;
  cardinal: string;
  formatted: string;
} {
  const bearing = calculateBearing(lat1, lon1, lat2, lon2);
  const cardinals = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  const index = Math.round(bearing / 22.5) % 16;
  return {
    bearing: Math.round(bearing),
    cardinal: cardinals[index],
    formatted: `${Math.round(bearing)}° ${cardinals[index]}`
  };
}

/**
 * Directional tactical waypoint marker along the unmapped embankment vector
 */
function createVectorWaypointIcon(bearing: number): L.DivIcon {
  return L.divIcon({
    className: "leaflet-marker-compass-waypoint",
    html: `
      <div style="
        transform: rotate(${bearing}deg);
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L20 21L12 16L4 21L12 2Z" fill="#f59e0b" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
        </svg>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

// Auto-bounds controller with smooth camera framing accounting for left dashboard
function MapBoundsController({
  origin,
  activeRoute,
  isAbroadMode = false
}: {
  origin: Coordinates | null;
  activeRoute: FindNearestResponse | null;
  isAbroadMode?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (isAbroadMode) return;
    if (!origin || !activeRoute || !activeRoute.destination_water_point?.geometry?.coordinates) return;

    const points: [number, number][] = [
      toLeafletLatLng([origin.lat, origin.lng]),
      toLeafletLatLng(activeRoute.destination_water_point.geometry.coordinates)
    ];

    if (activeRoute.bypassed_unsafe_source?.destination_water_point?.geometry?.coordinates) {
      points.push(
        toLeafletLatLng(
          activeRoute.bypassed_unsafe_source.destination_water_point.geometry.coordinates
        )
      );
    }

    if (activeRoute.route_geometry?.coordinates) {
      for (const pt of activeRoute.route_geometry.coordinates) {
        points.push(toLeafletLatLng(pt));
      }
    }

    const validPoints = points.filter(
      ([lat, lon]) => lat >= 20.5 && lat <= 26.7 && lon >= 87.8 && lon <= 92.8
    );

    if (validPoints.length >= 2) {
      const bounds = L.latLngBounds(validPoints);
      if (bounds.isValid()) {
        map.flyToBounds(bounds, {
          paddingTopLeft: [380, 80],
          paddingBottomRight: [60, 60],
          maxZoom: 14,
          duration: 1.2
        });
      }
    }
  }, [origin, activeRoute, isAbroadMode, map]);

  return null;
}

// Flies the camera smoothly whenever flyTarget is dispatched
function MapFlyController({
  flyTarget
}: {
  flyTarget: { lat: number; lng: number; zoom?: number; timestamp: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!flyTarget) return;
    map.flyTo([flyTarget.lat, flyTarget.lng], flyTarget.zoom ?? 15, {
      duration: 1.5
    });
  }, [flyTarget, map]);
  return null;
}

// Dynamically unlocks map maxBounds when inspecting real abroad coordinates (e.g. USA)
function MapBoundsUpdater({ isAbroadMode }: { isAbroadMode: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (isAbroadMode) {
      map.setMaxBounds(null as any);
      map.setMinZoom(2);
    } else {
      map.setMaxBounds(BANGLADESH_MAX_BOUNDS);
      map.setMinZoom(7);
    }
  }, [isAbroadMode, map]);
  return null;
}

// Custom Glassmorphism Map Controls: Zoom In, Zoom Out, and Locate Me
function CustomMapControls({
  origin,
  onLocateUser,
  onAccuracyChange,
  onTriggerBrowserGps,
  gpsStatus
}: {
  origin: Coordinates | null;
  onLocateUser: (coords: Coordinates) => void;
  onAccuracyChange?: (accuracy: number) => void;
  onTriggerBrowserGps?: () => void;
  gpsStatus?: "idle" | "requesting" | "success" | "error";
}) {
  const map = useMap();
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (controlsRef.current) {
      L.DomEvent.disableClickPropagation(controlsRef.current);
      L.DomEvent.disableScrollPropagation(controlsRef.current);
    }
  }, []);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    map.zoomIn();
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    map.zoomOut();
  };

  const handleLocateMe = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Unconditionally calls browser hardware GPS query every single time (no short-circuiting to origin)
    if (onTriggerBrowserGps) {
      onTriggerBrowserGps();
    } else if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          if (pos.coords.accuracy && onAccuracyChange) {
            onAccuracyChange(Math.round(pos.coords.accuracy));
          }
          onLocateUser({ lat, lng });
          map.flyTo([lat, lng], 15, { duration: 1.0 });
        },
        () => {
          map.flyTo([22.408, 89.202], 13, { duration: 1.0 });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      map.flyTo([22.408, 89.202], 13, { duration: 1.0 });
    }
  };

  return (
    <div
      ref={controlsRef}
      className="absolute bottom-6 right-6 z-[400] flex flex-col items-center gap-1.5 pointer-events-auto select-none"
    >
      {/* Zoom In & Out Controls */}
      <div className="flex flex-col rounded-sm bg-white/90 backdrop-blur-md border border-slate-200 shadow-lg shadow-slate-900/10 overflow-hidden p-0.5 gap-0.5">
        <button
          type="button"
          onClick={handleZoomIn}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 items-center justify-center rounded-none text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all duration-200 ease-in-out focus:outline-none"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="h-[1px] w-full bg-slate-200" />
        <button
          type="button"
          onClick={handleZoomOut}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-8 w-8 items-center justify-center rounded-none text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all duration-200 ease-in-out focus:outline-none"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Locate Me / Re-Center Control */}
      <button
        type="button"
        onClick={handleLocateMe}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`flex h-8 w-8 items-center justify-center rounded-sm bg-white/90 backdrop-blur-md border shadow-lg shadow-slate-900/10 active:scale-95 transition-all duration-200 ease-in-out focus:outline-none group ${
          gpsStatus === "requesting"
            ? "border-amber-400 text-amber-600 animate-pulse bg-amber-50/80"
            : "border-slate-200 text-sky-600 hover:text-sky-700 hover:bg-slate-50"
        }`}
        title="Detect My Location (Browser Hardware GPS)"
        aria-label="Locate me"
      >
        <Crosshair className={`h-3.5 w-3.5 transition-transform duration-200 ease-in-out ${
          gpsStatus === "requesting" ? "animate-spin" : "group-hover:rotate-45"
        }`} />
      </button>
    </div>
  );
}

/**
 * Viewport Bounding Box Water Point Fetcher:
 * Uses Leaflet's moveend event to get map.getBounds(),
 * then makes an HTTP GET request to /api/v1/water-points with min_lat, max_lat, min_lon, max_lon.
 */
function WaterPointFetcher({
  onPointsFetched,
  maternalSafeMode,
  season = "dry_season"
}: {
  onPointsFetched: (points: WaterPointGeoJSONFeature[]) => void;
  maternalSafeMode: boolean;
  season?: string;
}) {
  const map = useMap();
  const latestRequestIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPointsInViewport = useCallback(() => {
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds.isValid()) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      const currentBounds = map.getBounds();
      if (!currentBounds.isValid()) return;

      const sw = currentBounds.getSouthWest();
      const ne = currentBounds.getNorthEast();

      const minLat = Number(sw.lat.toFixed(5));
      const maxLat = Number(ne.lat.toFixed(5));
      const minLon = Number(sw.lng.toFixed(5));
      const maxLon = Number(ne.lng.toFixed(5));

      const params = new URLSearchParams({
        min_lat: minLat.toString(),
        max_lat: maxLat.toString(),
        min_lon: minLon.toString(),
        max_lon: maxLon.toString(),
        maternal_safe_only: maternalSafeMode ? "true" : "false",
        season
      });

      const currentRequestId = ++latestRequestIdRef.current;

      try {
        const res = await fetch(`/api/v1/water-points?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          // Ensure we only update state if this is still the freshest request
          if (
            currentRequestId === latestRequestIdRef.current &&
            data &&
            Array.isArray(data.features)
          ) {
            onPointsFetched(data.features);
          }
        }
      } catch {
        // Silently ignore network interruptions or rapid pans
      }
    }, 250);
  }, [map, maternalSafeMode, season, onPointsFetched]);

  useMapEvents({
    moveend() {
      fetchPointsInViewport();
    }
  });

  // Initial fetch upon mount or constraint change
  useEffect(() => {
    fetchPointsInViewport();
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fetchPointsInViewport]);

  return null;
}

export default function Map({
  waterPoints: initialWaterPoints,
  origin,
  onOriginSelect,
  activeRoute,
  maternalSafeMode,
  season = "dry_season",
  weather,
  gpsStatus = "idle",
  gpsErrorMessage = null,
  onClearGpsError,
  detectedGps = null,
  onClearDetectedGps,
  isAbroadMode = false,
  onTriggerBrowserGps,
  flyTarget = null,
  onFlyToRealLocation,
  onSimulateKhulnaGps,
  isSitingMode = false,
  proposedSite = null,
  onProposedSiteSelect,
  onClearProposedSite,
  onCommitProposedNode,
  sitingMetrics = null
}: MapProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportPoints, setViewportPoints] = useState<WaterPointGeoJSONFeature[]>(
    initialWaterPoints || []
  );

  useEffect(() => {
    setMounted(true);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const isAbort =
        (event.reason as { name?: string })?.name === "AbortError" ||
        (event.reason as { code?: number })?.code === 20 ||
        String(event.reason?.message || event.reason || "").toLowerCase().includes("abort");

      if (isAbort) {
        event.preventDefault(); // Cleanly swallow expected abort cancellations
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const handlePointsFetched = useCallback((points: WaterPointGeoJSONFeature[]) => {
    setViewportPoints(points);
  }, []);

  // Center of coastal Bangladesh (covers Khulna to Cox's Bazar)
  const initialCenter: [number, number] = [21.8, 90.5];
  const initialZoom = 9;

  // Base map style toggle: Esri World Imagery (high-resolution satellite) default
  const [tileProvider, setTileProvider] = useState<"satellite" | "voyager" | "osm">("satellite");

  // Selected water point ID for highlight
  const selectedDestId = activeRoute?.destination_water_point?.properties?.id;
  const bypassedUnsafeId =
    activeRoute?.bypassed_unsafe_source?.destination_water_point?.properties?.id;

  // --- Distinct Icon Generators for Functional vs Non-Functional (Infrastructure Decay) ---

  // 1. Functional - Maternal Safe (<= 300 mg/L Na+): Vibrant Emerald Green #059669
  const functionalSafeIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          width: 22px;
          height: 22px;
          background: #059669;
          border: 2px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 10px rgba(5, 150, 105, 0.6), 0 2px 4px rgba(0,0,0,0.4);
          cursor: pointer;
        ">
          <div style="width: 7px; height: 7px; background: white; border-radius: 50%;"></div>
        </div>
      `,
        className: "leaflet-marker-safe",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      }),
    []
  );

  // 2. Functional - High Sodium / Unsafe (> 300 mg/L Na+): Terracotta Amber #C2410C
  const functionalUnsafeIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          width: 22px;
          height: 22px;
          background: #C2410C;
          border: 2px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 10px rgba(194, 65, 12, 0.6), 0 2px 4px rgba(0,0,0,0.4);
          cursor: pointer;
        ">
          <div style="width: 7px; height: 7px; background: white; border-radius: 50%;"></div>
        </div>
      `,
        className: "leaflet-marker-unsafe",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      }),
    []
  );

  // Surveyor Benchmark Icon for Proposed RO Siting (Node P-01) - High-Visibility Palantir Style
  const proposedBenchmarkIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div class="w-6 h-6 bg-white text-slate-950 border border-white font-mono text-[9px] font-bold flex items-center justify-center shadow-[0_0_12px_rgba(255,255,255,0.6)]" style="width: 24px; height: 24px;">P-01</div>
      `,
        className: "leaflet-proposed-site-marker",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14]
      }),
    []
  );

  // 3. Non-Functional (Infrastructure Decay / Broken Handpumps): Slate Grey with Red Cross
  const nonFunctionalIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          width: 20px;
          height: 20px;
          background: #334155;
          border: 1.5px solid #94a3b8;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 4px rgba(0,0,0,0.6);
          cursor: pointer;
          opacity: 0.85;
        ">
          <span style="color: #ef4444; font-size: 11px; font-weight: 900; line-height: 1;">✕</span>
        </div>
      `,
        className: "leaflet-marker-non-functional",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -12]
      }),
    []
  );

  // 4. Selected Destination Icon (Active Safe Route Target)
  const safeSelectedIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          width: 34px;
          height: 34px;
          background: #059669;
          border: 3px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(5, 150, 105, 0.95), 0 4px 10px rgba(0,0,0,0.6);
          cursor: pointer;
          transform: scale(1.1);
        ">
          <div style="width: 12px; height: 12px; background: #ecfdf5; border-radius: 50%; border: 1.5px solid white;"></div>
        </div>
      `,
        className: "leaflet-marker-safe-selected",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -18]
      }),
    []
  );

  // 5. Selected Unsafe Icon (Standard Mode Target)
  const unsafeSelectedIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          width: 34px;
          height: 34px;
          background: #C2410C;
          border: 3px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(194, 65, 12, 0.95), 0 4px 10px rgba(0,0,0,0.6);
          cursor: pointer;
          transform: scale(1.1);
        ">
          <div style="width: 12px; height: 12px; background: #fff7ed; border-radius: 50%; border: 1.5px solid white;"></div>
        </div>
      `,
        className: "leaflet-marker-unsafe-selected",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -18]
      }),
    []
  );

  // 6. Bypassed Unsafe Marker Icon (Pulsing Orange with Cross)
  const bypassedUnsafeMarkerIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          position: relative;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            position: absolute;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px dashed #C2410C;
            background: rgba(194, 65, 12, 0.2);
            animation: spin 6s linear infinite;
          "></div>
          <div style="
            width: 22px;
            height: 22px;
            background: #C2410C;
            border: 2px solid #ffffff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 14px rgba(194, 65, 12, 0.8);
          ">
            <span style="color: white; font-size: 11px; font-weight: bold; line-height: 1;">✕</span>
          </div>
        </div>
      `,
        className: "leaflet-marker-bypassed",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
      }),
    []
  );

  // 7. Origin Marker Icon (Electric Blue Beacon, Exactly Centered)
  const originIcon = useMemo(
    () =>
      L.divIcon({
        html: `
        <div style="
          position: relative;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(14, 165, 233, 0.4);
            animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <div style="
            position: relative;
            width: 24px;
            height: 24px;
            background: #0284c7;
            border: 2.5px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 0 16px rgba(2, 132, 199, 0.85), 0 2px 6px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="width: 7px; height: 7px; background: white; border-radius: 50%;"></div>
          </div>
        </div>
      `,
        className: "leaflet-marker-origin",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
      }),
    []
  );

  // 8. Tactical Target Reticle Icon for Destination Water Point (Pulsing ring and center dot)
  const targetReticleIcon = useMemo(() => {
    const isSafe = activeRoute?.destination_water_point?.properties?.is_maternal_safe ?? true;
    const color = isSafe ? "#059669" : "#C2410C";
    const bgGlow = isSafe ? "rgba(5, 150, 105, 0.3)" : "rgba(194, 65, 12, 0.3)";
    return L.divIcon({
      html: `
        <div style="
          position: relative;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <!-- Outer Pulsing Radar Ring -->
          <div style="
            position: absolute;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            border: 2px solid ${color};
            background: ${bgGlow};
            animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <!-- Tactical Reticle Core -->
          <div style="
            position: relative;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #ffffff;
            border: 2.5px solid ${color};
            box-shadow: 0 0 16px ${color}, 0 2px 6px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="width: 8px; height: 8px; background: ${color}; border-radius: 50%;"></div>
          </div>
        </div>
      `,
      className: "leaflet-marker-target-reticle",
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });
  }, [activeRoute]);

  // Primary route polyline points (strictly [latitude, longitude])
  const routePolylinePoints: [number, number][] | null = useMemo(() => {
    if (!origin || !activeRoute) return null;

    if (
      activeRoute.route_geometry?.coordinates &&
      activeRoute.route_geometry.coordinates.length > 0
    ) {
      return activeRoute.route_geometry.coordinates.map((pt) => toLeafletLatLng(pt));
    }

    if (activeRoute.destination_water_point?.geometry?.coordinates) {
      return [
        toLeafletLatLng([origin.lat, origin.lng]),
        toLeafletLatLng(activeRoute.destination_water_point.geometry.coordinates)
      ];
    }

    return null;
  }, [origin, activeRoute]);

  // GPS Accuracy Halo state (default 15m; weak coastal GPS simulation 180m)
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number>(15);

  // Sync with live detected hardware GPS accuracy
  useEffect(() => {
    if (detectedGps?.accuracy) {
      setGpsAccuracyMeters(Math.round(detectedGps.accuracy));
    }
  }, [detectedGps]);

  // Manual toggle for Unmapped Embankment Mode simulation (for testing/demo)
  const [forceEmbankmentMode, setForceEmbankmentMode] = useState<boolean>(false);

  // Exact coordinates for User Origin & Target Water Tank
  const userOriginLatLng = useMemo<[number, number] | null>(() => {
    if (!origin) return null;
    return toLeafletLatLng([origin.lat, origin.lng]);
  }, [origin]);

  const targetLatLng = useMemo<[number, number] | null>(() => {
    if (!activeRoute?.destination_water_point?.geometry?.coordinates) return null;
    return toLeafletLatLng(activeRoute.destination_water_point.geometry.coordinates);
  }, [activeRoute]);

  // --- Tortuosity & Unmapped Embankment Detector ---
  const directDistMeters = useMemo(() => {
    if (!userOriginLatLng || !targetLatLng) return 0;
    return haversineMeters(userOriginLatLng[0], userOriginLatLng[1], targetLatLng[0], targetLatLng[1]);
  }, [userOriginLatLng, targetLatLng]);

  const directDistKm = directDistMeters / 1000;

  const osrmDistanceKm = useMemo(() => {
    if (!activeRoute) return 0;
    const m =
      activeRoute.distance_meters ??
      (activeRoute as any)?.effective_route_distance_meters ??
      0;
    return m / 1000;
  }, [activeRoute]);

  const tortuosityRatio = useMemo(() => {
    if (directDistKm < 0.05 || osrmDistanceKm === 0) return 1.0;
    return osrmDistanceKm / directDistKm;
  }, [directDistKm, osrmDistanceKm]);

  // Trigger Condition:
  // osrmDistanceKm / directDistKm > 3.5 OR missing/failed OSRM route OR manual simulation toggle
  const isUnmappedEmbankment = useMemo(() => {
    if (!activeRoute || directDistKm < 0.05) return false;
    if (forceEmbankmentMode) return true;
    const hasValidGeometry =
      activeRoute.route_geometry?.coordinates &&
      activeRoute.route_geometry.coordinates.length >= 2;
    return tortuosityRatio > 3.5 || !hasValidGeometry;
  }, [activeRoute, directDistKm, forceEmbankmentMode, tortuosityRatio]);

  // Realistic coastal footpath distance: directDistKm * 1.35 (1.35x delta winding estimate)
  const estimatedFootpathKm = directDistKm * 1.35;

  // Walk duration using estimatedFootpathKm at 4.0 km/h (or 2.5 km/h if raining)
  const isRainingCondition = Boolean(
    (weather && weather.precipitation > 0) || weather?.isRaining
  );
  const walkingSpeedKmH = isRainingCondition ? 2.5 : 4.0;
  const embankmentWalkDurationMinutes = (estimatedFootpathKm / walkingSpeedKmH) * 60;

  // Active walk duration for HUD & scrubber
  const activeDurationMinutes = isUnmappedEmbankment
    ? embankmentWalkDurationMinutes
    : (activeRoute?.est_walk_time_minutes ?? (activeRoute as any)?.durationMinutes ?? 0);

  const activeDistanceKm = isUnmappedEmbankment
    ? estimatedFootpathKm
    : (osrmDistanceKm > 0 ? osrmDistanceKm : estimatedFootpathKm);

  // Compass Heading Telemetry (e.g. 242° WSW)
  const compassHeading = useMemo(() => {
    if (!userOriginLatLng || !targetLatLng) return null;
    return getCompassHeading(userOriginLatLng[0], userOriginLatLng[1], targetLatLng[0], targetLatLng[1]);
  }, [userOriginLatLng, targetLatLng]);

  // Directional bearing waypoints along the direct satellite compass vector (33% and 66%)
  const compassVectorWaypoints = useMemo(() => {
    if (!userOriginLatLng || !targetLatLng || !compassHeading) return [];
    return [0.33, 0.66].map((pct) => ({
      lat: userOriginLatLng[0] + pct * (targetLatLng[0] - userOriginLatLng[0]),
      lon: userOriginLatLng[1] + pct * (targetLatLng[1] - userOriginLatLng[1]),
      bearing: compassHeading.bearing
    }));
  }, [userOriginLatLng, targetLatLng, compassHeading]);

  // Precision Start/End Tethers (Off-Road Snapping)
  const originTether = useMemo<[number, number][] | null>(() => {
    if (isUnmappedEmbankment) return null;
    if (!userOriginLatLng || !routePolylinePoints || routePolylinePoints.length === 0) return null;
    const roadStart = routePolylinePoints[0];
    const dist = haversineMeters(userOriginLatLng[0], userOriginLatLng[1], roadStart[0], roadStart[1]);
    if (dist > 1.5) {
      return [userOriginLatLng, roadStart];
    }
    return null;
  }, [isUnmappedEmbankment, userOriginLatLng, routePolylinePoints]);

  const targetTether = useMemo<[number, number][] | null>(() => {
    if (isUnmappedEmbankment) return null;
    if (!targetLatLng || !routePolylinePoints || routePolylinePoints.length === 0) return null;
    const roadEnd = routePolylinePoints[routePolylinePoints.length - 1];
    const dist = haversineMeters(targetLatLng[0], targetLatLng[1], roadEnd[0], roadEnd[1]);
    if (dist > 1.5) {
      return [roadEnd, targetLatLng];
    }
    return null;
  }, [isUnmappedEmbankment, targetLatLng, routePolylinePoints]);

  // Combined Route Geometry [origin, ...osrmCoordinates, targetWaterTank]
  // In UNMAPPED EMBANKMENT MODE, the path follows the direct satellite compass vector with intermediate waypoints!
  const combinedRoutePoints: [number, number][] = useMemo(() => {
    if (!userOriginLatLng || !activeRoute) return [];
    if (!targetLatLng) return [userOriginLatLng];

    if (isUnmappedEmbankment) {
      return [
        userOriginLatLng,
        [
          userOriginLatLng[0] + 0.33 * (targetLatLng[0] - userOriginLatLng[0]),
          userOriginLatLng[1] + 0.33 * (targetLatLng[1] - userOriginLatLng[1])
        ],
        [
          userOriginLatLng[0] + 0.66 * (targetLatLng[0] - userOriginLatLng[0]),
          userOriginLatLng[1] + 0.66 * (targetLatLng[1] - userOriginLatLng[1])
        ],
        targetLatLng
      ];
    }

    const pts: [number, number][] = [userOriginLatLng];

    if (routePolylinePoints && routePolylinePoints.length > 0) {
      for (const pt of routePolylinePoints) {
        const last = pts[pts.length - 1];
        if (Math.abs(last[0] - pt[0]) > 0.000001 || Math.abs(last[1] - pt[1]) > 0.000001) {
          pts.push(pt);
        }
      }
    }

    const last = pts[pts.length - 1];
    if (Math.abs(last[0] - targetLatLng[0]) > 0.000001 || Math.abs(last[1] - targetLatLng[1]) > 0.000001) {
      pts.push(targetLatLng);
    }

    return pts;
  }, [userOriginLatLng, activeRoute, isUnmappedEmbankment, targetLatLng, routePolylinePoints]);

  // Palantir-Style Animated Route Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const lastTimeRef = useRef<number | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const prevRouteKeyRef = useRef<string | null>(null);

  // Automatically trigger a smooth walk simulation whenever a new route is calculated
  useEffect(() => {
    if (!activeRoute) {
      setIsPlaying(false);
      setPlaybackProgress(0);
      prevRouteKeyRef.current = null;
      return;
    }

    const routeKey = `${activeRoute.destination_water_point?.properties?.id || ""}-${activeRoute.distance_meters || 0}-${activeRoute.est_walk_time_minutes || 0}`;
    if (prevRouteKeyRef.current !== routeKey) {
      prevRouteKeyRef.current = routeKey;
      setPlaybackProgress(0);
      setIsPlaying(true);
    }
  }, [activeRoute]);

  // RequestAnimationFrame smooth interpolation loop
  useEffect(() => {
    if (!isPlaying || combinedRoutePoints.length < 2) {
      lastTimeRef.current = null;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    const BASE_DURATION_MS = 14000; // 14 seconds for full walk preview at 1x

    const stepAnimation = (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const deltaMs = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      setPlaybackProgress((prev) => {
        const step = (deltaMs / BASE_DURATION_MS) * playbackSpeed;
        const next = prev + step;
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });

      animFrameIdRef.current = requestAnimationFrame(stepAnimation);
    };

    animFrameIdRef.current = requestAnimationFrame(stepAnimation);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [isPlaying, combinedRoutePoints.length, playbackSpeed]);

  const currentPlaybackState = useMemo(() => {
    if (combinedRoutePoints.length < 2) return null;
    return interpolatePath(combinedRoutePoints, playbackProgress);
  }, [combinedRoutePoints, playbackProgress]);

  // Ghosted orange route to bypassed unsafe point
  const bypassedPolylinePoints: [number, number][] | null = useMemo(() => {
    if (!origin || !maternalSafeMode || !activeRoute?.bypassed_unsafe_source) {
      return null;
    }

    const bypassed = activeRoute.bypassed_unsafe_source;
    if (
      bypassed.route_geometry?.coordinates &&
      bypassed.route_geometry.coordinates.length > 0
    ) {
      return bypassed.route_geometry.coordinates.map((pt) => toLeafletLatLng(pt));
    }

    if (bypassed.destination_water_point?.geometry?.coordinates) {
      return [
        toLeafletLatLng([origin.lat, origin.lng]),
        toLeafletLatLng(bypassed.destination_water_point.geometry.coordinates)
      ];
    }

    return null;
  }, [origin, maternalSafeMode, activeRoute]);

  const durationMinutes =
    activeRoute?.est_walk_time_minutes ??
    (activeRoute as any)?.durationMinutes ??
    0;
  const routeColor = getRouteColor(durationMinutes);
  const fatigueStatus = getFatigueStatus(durationMinutes);

  const formatSourceType = (type: string) => {
    switch (type) {
      case "solar_ro":
        return "Solar Reverse Osmosis (RO)";
      case "psf":
        return "Pond Sand Filter (PSF)";
      case "ro_plant":
        return "Reverse Osmosis (RO Plant)";
      case "deep_tube_well":
        return "Deep Tube Well";
      case "shallow_tube_well":
        return "Protected Shallow Handpump";
      case "rainwater_tank":
        return "Rainwater Harvesting Tank";
      case "piped_water":
        return "Piped Water Tapstand";
      default:
        return type.replace(/_/g, " ").toUpperCase();
    }
  };

  // Active points to render in clusters
  const pointsToRender = viewportPoints.length > 0 ? viewportPoints : (initialWaterPoints || []);

  if (!mounted) {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4 rounded-2xl glass-panel p-8 text-center border border-white/10 shadow-2xl">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0B4F6C]/20 text-[#0ea5e9] border border-[#0ea5e9]/30">
            <Compass className="h-8 w-8 animate-spin" />
            <div className="absolute inset-0 rounded-2xl animate-ping opacity-25 bg-sky-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Initializing Leaflet GIS Canvas</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Connecting to PostGIS viewport clustering engine...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isRaining = Boolean(
    (weather && weather.precipitation > 0) || weather?.isRaining
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-100">
      {/* Immersive Apple Weather-Style Dynamic Rain Effect Overlay */}
      {isRaining && (
        <RainOverlay
          precipitation={weather?.precipitation ?? 12}
          intensity={weather && weather.precipitation > 10 ? "heavy" : "moderate"}
        />
      )}

      {/* Geolocation Requesting Permission Banner */}
      {gpsStatus === "requesting" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto rounded-sm bg-sky-50/95 backdrop-blur-md px-4 py-2 border border-sky-300 text-xs shadow-xl shadow-slate-900/10 font-mono text-sky-900 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 select-none max-w-lg">
          <Compass className="h-4 w-4 text-sky-600 animate-spin flex-shrink-0" />
          <span className="font-bold text-[11px] leading-tight">
            REQUESTING BROWSER GPS PERMISSION... Please allow location access in your browser prompt.
          </span>
        </div>
      )}

      {/* Geolocation Error Banner */}
      {gpsErrorMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto rounded-sm bg-rose-50/95 backdrop-blur-md px-4 py-2 border border-rose-300 text-xs shadow-xl shadow-slate-900/10 font-mono text-rose-900 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 select-none max-w-xl">
          <AlertOctagon className="h-4 w-4 text-rose-600 flex-shrink-0 animate-bounce" />
          <span className="font-bold text-[11px] leading-tight">
            {gpsErrorMessage}
          </span>
          {onClearGpsError && (
            <button
              type="button"
              onClick={onClearGpsError}
              className="ml-auto text-rose-500 hover:text-rose-800 p-0.5 rounded-sm hover:bg-rose-100 transition-colors"
              title="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Live GPS Hardware Telemetry Card */}
      {detectedGps && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[450] pointer-events-auto w-[92vw] max-w-md rounded-sm bg-white/95 backdrop-blur-md border border-slate-300 shadow-2xl shadow-slate-900/20 p-3.5 font-mono text-slate-900 space-y-2.5 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-none bg-sky-500 animate-pulse shadow-sm" />
              <Navigation className="h-3.5 w-3.5 text-sky-600" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-800">
                LIVE GPS HARDWARE TELEMETRY
              </span>
            </div>
            {onClearDetectedGps && (
              <button
                type="button"
                onClick={onClearDetectedGps}
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded-sm hover:bg-slate-100 transition-colors"
                title="Close telemetry card"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                DETECTED HARDWARE COORDS:
              </span>
              <span className="font-bold text-slate-900 tabular-nums text-[11px]">
                {detectedGps.lat.toFixed(5)}°, {detectedGps.lng.toFixed(5)}° (±{Math.round(detectedGps.accuracy)}m)
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                DETECTED LOCATION:
              </span>
              <span className="font-semibold text-sky-700 sm:text-right max-w-[260px] truncate" title={detectedGps.locationName}>
                {detectedGps.locationName}
              </span>
            </div>
          </div>

          {detectedGps.isInsideBangladesh ? (
            <div className="flex items-center gap-2 rounded-sm bg-emerald-50 border border-emerald-300 p-2 text-[11px] text-emerald-800 font-bold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <span>INSIDE BANGLADESH DELTA — Recalibrated to live position.</span>
            </div>
          ) : (
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-start gap-2 rounded-sm bg-amber-50 border border-amber-300 p-2 text-[11px] text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">HARDWARE DETECTED OUTSIDE BANGLADESH:</span>
                  <p className="text-[10px] text-amber-800 leading-tight">
                    You are testing from outside the coastal delta zone. Select verification mode:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onFlyToRealLocation}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-sm bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-sm"
                >
                  <Compass className="h-3 w-3 text-sky-600" />
                  <span>FLY MAP TO MY REAL USA LOCATION</span>
                </button>

                <button
                  type="button"
                  onClick={onSimulateKhulnaGps}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-sm"
                >
                  <Crosshair className="h-3 w-3 text-emerald-600" />
                  <span>SIMULATE GPS LOCK IN KHULNA</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Low GPS Precision Drift Calibration Alert Banner */}
      {gpsAccuracyMeters > 50 && !detectedGps && !gpsErrorMessage && gpsStatus !== "requesting" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-auto rounded-sm bg-amber-50/95 backdrop-blur-md px-3.5 py-1.5 border border-amber-300 text-xs shadow-xl shadow-slate-900/10 font-mono text-amber-900 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 select-none">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 animate-pulse" />
          <span className="font-bold text-[11px]">
            LOW GPS PRECISION (±{gpsAccuracyMeters}m) — Drag reticle onto visible satellite embankment to calibrate.
          </span>
        </div>
      )}

      {/* Tactical Playback Scrubber Bar (Palantir CommandMap Route Playback) or Viewport Nodes Indicator */}
      {activeRoute ? (
        <div className="absolute bottom-6 left-[440px] z-30 pointer-events-auto flex flex-col md:flex-row items-center gap-2.5 rounded-sm bg-white/95 backdrop-blur-md px-3.5 py-2 border border-slate-200 text-xs shadow-xl shadow-slate-900/10 font-mono animate-in fade-in slide-in-from-bottom-2 duration-200 select-none">
          {/* START Node Label */}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold">START:</span>
            <span className="text-[11px] font-bold text-slate-800">USER ORIGIN</span>
          </div>

          {/* Scrubber Controls */}
          <div className="flex items-center gap-2 px-2 border-y md:border-y-0 md:border-x border-slate-200 py-1 md:py-0 w-full md:w-auto">
            <button
              type="button"
              onClick={() => {
                if (playbackProgress >= 1) {
                  setPlaybackProgress(0);
                }
                setIsPlaying((prev) => !prev);
              }}
              className="flex items-center justify-center h-6 w-6 rounded-sm bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 transition-all duration-150 active:scale-95"
              title={isPlaying ? "Pause simulation" : "Play route ops"}
            >
              {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>

            {/* Range Slider */}
            <div className="flex items-center gap-1.5 w-24 sm:w-32">
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={Math.round(playbackProgress * 100)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) / 100;
                  setPlaybackProgress(val);
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
              />
              <span className="text-[10px] text-slate-500 tabular-nums w-7 text-right font-bold">
                {Math.round(playbackProgress * 100)}%
              </span>
            </div>

            {/* Speed Toggle: 1x | 5x */}
            <button
              type="button"
              onClick={() => setPlaybackSpeed((s) => (s === 1 ? 5 : 1))}
              className={`px-1.5 py-0.5 rounded-sm border text-[10px] font-bold transition-colors ${
                playbackSpeed === 5
                  ? "bg-sky-100 text-sky-700 border-sky-300"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300"
              }`}
              title="Toggle playback speed (1x / 5x)"
            >
              {playbackSpeed}x
            </button>
          </div>

          {/* END Node Label */}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <Target className="h-3.5 w-3.5 text-emerald-600" />
            <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold">END:</span>
            <span
              className="text-[11px] font-bold text-slate-800 max-w-[120px] truncate"
              title={activeRoute.destination_water_point?.properties?.name || "TARGET TANK"}
            >
              {activeRoute.destination_water_point?.properties?.name || "TARGET TANK"}
            </span>
          </div>

          {/* Telemetry Divider */}
          <div className="hidden md:block h-4 w-[1px] bg-slate-200" />

          {/* Compass Heading & Direct Distance Telemetry */}
          {compassHeading && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono whitespace-nowrap text-sky-800 bg-sky-50 px-2 py-0.5 rounded-sm border border-sky-200">
              <Compass className="h-3 w-3 text-sky-600" />
              <span className="font-bold">HEADING: {compassHeading.formatted}</span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-600">DIRECT: {directDistKm.toFixed(2)} km</span>
            </div>
          )}

          {/* Telemetry Divider */}
          <div className="hidden md:block h-4 w-[1px] bg-slate-200" />

          {/* Live Interpolated Telemetry */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
            <span className="whitespace-nowrap">
              <span className="uppercase tracking-wider text-slate-400 font-bold">DIST:</span>{" "}
              <span className="font-bold text-slate-900 tabular-nums">
                {(activeDistanceKm * playbackProgress).toFixed(2)} km
              </span>
            </span>
            <span className="whitespace-nowrap">
              <span className="uppercase tracking-wider text-slate-400 font-bold">ELAPSED:</span>{" "}
              <span className="font-bold text-slate-900 tabular-nums">
                {(activeDurationMinutes * playbackProgress).toFixed(1)} mins
              </span>
            </span>
          </div>

          {/* Demo Toggles: GPS Drift Simulation & Embankment Fallback */}
          <div className="hidden xl:flex items-center gap-1 pl-1 border-l border-slate-200">
            <button
              type="button"
              onClick={() => setGpsAccuracyMeters((prev) => (prev > 50 ? 15 : 180))}
              className={`px-1.5 py-0.5 rounded-sm border text-[9px] font-bold font-mono transition-all duration-150 ${
                gpsAccuracyMeters > 50
                  ? "bg-amber-100 text-amber-800 border-amber-300 shadow-sm"
                  : "bg-slate-50 text-slate-600 hover:text-slate-900 border-slate-200"
              }`}
              title="Toggle between normal GPS (±15m) and weak coastal GPS (±180m)"
            >
              {gpsAccuracyMeters > 50 ? "GPS WEAK (±180m)" : "GPS NORMAL (±15m)"}
            </button>
            <button
              type="button"
              onClick={() => setForceEmbankmentMode((prev) => !prev)}
              className={`px-1.5 py-0.5 rounded-sm border text-[9px] font-bold font-mono transition-all duration-150 ${
                isUnmappedEmbankment
                  ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                  : "bg-slate-50 text-slate-600 hover:text-slate-900 border-slate-200"
              }`}
              title="Toggle Unmapped Embankment Mode Fallback"
            >
              {isUnmappedEmbankment ? "EMBANKMENT ON" : "FORCE EMBANKMENT"}
            </button>
          </div>
        </div>
      ) : (
        /* Viewport Cluster Status Indicator (When No Route Active) */
        <div className="hidden xl:flex absolute bottom-6 left-[460px] z-20 pointer-events-auto items-center gap-2.5 rounded-sm bg-white/90 backdrop-blur-md px-3 py-1.5 border border-slate-200 text-xs shadow-lg shadow-slate-900/10 transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-none bg-emerald-600 animate-pulse shadow-sm" />
            <span className="font-semibold text-slate-800 flex items-center gap-1.5 font-mono">
              <span className="tabular-nums text-emerald-600">{pointsToRender.length.toLocaleString()}</span>
              <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold">NODES IN VIEW</span>
            </span>
          </div>
          <div className="h-3 w-[1px] bg-slate-200" />
          <div className="flex items-center gap-2.5 text-[10px] text-slate-600 font-mono">
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <span className="inline-block w-2 h-2 rounded-none bg-emerald-600" /> Safe
            </span>
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <span className="inline-block w-2 h-2 rounded-none bg-amber-600" /> Saline
            </span>
            <span className="flex items-center gap-1 text-rose-600 font-medium">
              <span className="inline-block w-2 h-2 rounded-none bg-rose-600 text-[8px] text-white font-bold text-center leading-[8px]">✕</span> Broken
            </span>
          </div>
        </div>
      )}

      {/* Base Map Selector */}
      <div className="absolute top-4 right-4 z-20 pointer-events-auto flex items-center gap-0.5 rounded-sm bg-white/90 backdrop-blur-md p-0.5 border border-slate-200 text-[10px] font-mono shadow-lg shadow-slate-900/10 transition-all duration-200 ease-in-out">
        <button
          type="button"
          onClick={() => setTileProvider("satellite")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-sm font-semibold transition-all duration-200 ease-in-out uppercase text-[10px] tracking-wider ${
            tileProvider === "satellite"
              ? "bg-sky-100 text-sky-700 border border-sky-300 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent"
          }`}
        >
          <Satellite className="h-3 w-3" />
          <span>Esri Sat</span>
        </button>
        <button
          type="button"
          onClick={() => setTileProvider("voyager")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-sm font-semibold transition-all duration-200 ease-in-out uppercase text-[10px] tracking-wider ${
            tileProvider === "voyager"
              ? "bg-sky-100 text-sky-700 border border-sky-300 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent"
          }`}
        >
          <MapIcon className="h-3 w-3" />
          <span>Voyager</span>
        </button>
        <button
          type="button"
          onClick={() => setTileProvider("osm")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-sm font-semibold transition-all duration-200 ease-in-out uppercase text-[10px] tracking-wider ${
            tileProvider === "osm"
              ? "bg-sky-100 text-sky-700 border border-sky-300 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent"
          }`}
        >
          <span>OSM</span>
        </button>
      </div>

      {/* Floating Route Fatigue Indicator */}
      {activeRoute && (
        <div className="absolute top-14 right-4 z-20 pointer-events-auto flex items-center gap-2 rounded-sm bg-white/90 backdrop-blur-md px-3 py-1.5 border border-slate-200 text-xs shadow-lg shadow-slate-900/10 font-mono animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" style={{ color: routeColor }} />
            <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold">WALK TIME:</span>
            <span className="font-mono tabular-nums font-bold text-sm" style={{ color: routeColor }}>
              {activeDurationMinutes.toFixed(1)}m
            </span>
          </div>
          <div className="h-3 w-[1px] bg-slate-200" />
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-bold border ${fatigueStatus.badgeClass}`}>
            <span className={`w-1 h-1 rounded-none ${fatigueStatus.dotClass}`} />
            {fatigueStatus.label.toUpperCase()}
          </span>
          {weather?.isRaining && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-bold bg-rose-50 text-rose-700 border border-rose-300 shadow-sm">
              <CloudRain className="h-3 w-3 text-rose-600" />
              MUD 1.75x
            </span>
          )}
          {isUnmappedEmbankment && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-bold bg-amber-50 text-amber-800 border border-amber-300 shadow-sm">
              <AlertTriangle className="h-3 w-3 text-amber-600" />
              EMBANKMENT (1.35x)
            </span>
          )}
          <div className="h-3 w-[1px] bg-slate-200" />
          <button
            type="button"
            onClick={() => {
              if (playbackProgress >= 1) setPlaybackProgress(0);
              setIsPlaying((prev) => !prev);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 font-mono font-bold text-[10px] uppercase tracking-wider transition-all duration-200 active:scale-95"
            title="Simulate route walk"
          >
            {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            <span>{isPlaying ? "PAUSE" : "SIMULATE WALK"}</span>
          </button>
        </div>
      )}

      {/* Prominent Unmapped Embankment Path Banner */}
      {isUnmappedEmbankment && (
        <div className="absolute top-26 right-4 z-20 pointer-events-auto max-w-sm rounded-sm bg-amber-50/95 backdrop-blur-md px-3 py-2 border border-amber-300 text-xs shadow-lg shadow-slate-900/10 font-mono text-amber-900 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px]">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
            <span>UNMAPPED EMBANKMENT PATH</span>
          </div>
          <p className="text-[10px] text-amber-800 mt-1 leading-snug">
            ⚠️ OSM road data incomplete here. Using Satellite Compass Vector (1.35x delta winding estimate).
          </p>
        </div>
      )}

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        zoomControl={false}
        minZoom={isAbroadMode ? 2 : 7}
        maxBounds={isAbroadMode ? undefined : BANGLADESH_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={true}
        style={{ height: "100%", minHeight: "100vh", width: "100%" }}
        className="h-full w-full"
      >
        {/* Base Map Layers */}
        {tileProvider === "satellite" ? (
          <>
            <TileLayer
              key="esri-satellite"
              attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
              zIndex={1}
            />
            <TileLayer
              key="esri-transportation"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
              zIndex={2}
            />
            <TileLayer
              key="esri-boundaries-places"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
              zIndex={3}
            />
          </>
        ) : tileProvider === "voyager" ? (
          <TileLayer
            key="voyager"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="osm"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        )}

        <MapBoundsUpdater isAbroadMode={isAbroadMode} />
        <MapFlyController flyTarget={flyTarget} />
        <MapClickHandler
          onMapClick={onOriginSelect}
          onProposedSiteClick={onProposedSiteSelect}
          isSitingMode={isSitingMode}
        />
        <MapBoundsController origin={origin} activeRoute={activeRoute} isAbroadMode={isAbroadMode} />
        <WaterPointFetcher
          onPointsFetched={handlePointsFetched}
          maternalSafeMode={maternalSafeMode}
          season={season}
        />

        {/* Origin Marker & GPS Accuracy Halo */}
        {origin && userOriginLatLng && (
          <>
            {/* GPS Accuracy Halo with tactical dashed border */}
            <Circle
              center={userOriginLatLng}
              radius={gpsAccuracyMeters}
              pathOptions={{
                color: gpsAccuracyMeters > 50 ? "#f59e0b" : "#38bdf8",
                fillColor: gpsAccuracyMeters > 50 ? "#f59e0b" : "#38bdf8",
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: "4, 4"
              }}
            />
            <Marker
              position={userOriginLatLng}
              icon={originIcon}
              draggable={true}
              zIndexOffset={1000}
              eventHandlers={{
                dragend(e) {
                  const marker = e.target;
                  const pos = marker.getLatLng();
                  onOriginSelect({
                    lat: Number(pos.lat.toFixed(6)),
                    lng: Number(pos.lng.toFixed(6))
                  });
                }
              }}
            >
              <Popup>
                <div className="text-xs space-y-1 font-mono">
                  <div className="flex items-center gap-1.5 font-bold text-sky-600">
                    <Navigation className="h-3.5 w-3.5" /> Selected Origin
                  </div>
                  <div className="text-slate-700">
                    Lat: {origin.lat.toFixed(4)}, Lon: {origin.lng.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    GPS Accuracy: ±{gpsAccuracyMeters}m{" "}
                    {gpsAccuracyMeters > 50 ? "(Degraded Coastal Fix)" : "(Calibrated)"}
                  </div>
                  {gpsAccuracyMeters > 50 && (
                    <div className="text-[10px] text-amber-700 bg-amber-50 p-1 rounded-sm border border-amber-300 font-bold flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-600 flex-shrink-0" />
                      <span>Low precision. Drag reticle onto satellite embankment to calibrate.</span>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {/* Tactical Compass Vector (Unmapped Embankment Mode) */}
        {isUnmappedEmbankment && userOriginLatLng && targetLatLng && (
          <>
            {/* Outer ambient glow vector */}
            <Polyline
              positions={[userOriginLatLng, targetLatLng]}
              pathOptions={{
                color: "#f59e0b",
                weight: 6,
                opacity: 0.35,
                dashArray: "8, 6",
                lineCap: "round"
              }}
            />
            {/* Core precision vector */}
            <Polyline
              positions={[userOriginLatLng, targetLatLng]}
              pathOptions={{
                color: "#0284c7",
                weight: 2.5,
                opacity: 0.95,
                dashArray: "8, 6",
                lineCap: "round"
              }}
            />
            {/* Directional Waypoint Markers along direct vector */}
            {compassVectorWaypoints.map((wp, idx) => (
              <Marker
                key={`vector-wp-${idx}`}
                position={[wp.lat, wp.lon]}
                icon={createVectorWaypointIcon(wp.bearing)}
                interactive={false}
                zIndexOffset={400}
              />
            ))}
          </>
        )}

        {/* Origin Precision Off-Road Tether (Dashed Line from User Pin to Road Snapping Start) */}
        {originTether && (
          <Polyline
            positions={originTether}
            pathOptions={{
              color: "#0284c7",
              weight: 2,
              opacity: 0.75,
              dashArray: "4, 6",
              lineCap: "round"
            }}
          />
        )}

        {/* Target Water Tank Precision Off-Road Tether (Dashed Line from Road Snapping End to Water Point Pin) */}
        {targetTether && (
          <Polyline
            positions={targetTether}
            pathOptions={{
              color: routeColor,
              weight: 2,
              opacity: 0.75,
              dashArray: "4, 6",
              lineCap: "round"
            }}
          />
        )}

        {/* Bypassed Route Polyline */}
        {bypassedPolylinePoints && (
          <>
            <Polyline
              positions={bypassedPolylinePoints}
              pathOptions={{
                color: "#f97316",
                weight: 8,
                opacity: 0.35,
                lineCap: "round",
                lineJoin: "round"
              }}
            />
            <Polyline
              positions={bypassedPolylinePoints}
              pathOptions={{
                color: "#f97316",
                weight: 4,
                opacity: 0.95,
                dashArray: "8, 8",
                lineCap: "round",
                lineJoin: "round"
              }}
            />
          </>
        )}

        {/* Primary Safe/Standard Route Polyline (Dynamically Colored or Muted in Embankment Mode) */}
        {routePolylinePoints && (
          <>
            {!isUnmappedEmbankment && (
              <Polyline
                positions={routePolylinePoints}
                pathOptions={{
                  color: routeColor,
                  weight: 10,
                  opacity: 0.35,
                  lineCap: "round",
                  lineJoin: "round"
                }}
              />
            )}
            <Polyline
              positions={routePolylinePoints}
              pathOptions={{
                color: isUnmappedEmbankment ? "#94a3b8" : routeColor,
                weight: isUnmappedEmbankment ? 3 : 6,
                opacity: isUnmappedEmbankment ? 0.35 : 0.9,
                dashArray: isUnmappedEmbankment ? "4, 6" : maternalSafeMode ? undefined : "6, 6",
                lineCap: "round",
                lineJoin: "round"
              }}
            />
          </>
        )}

        {/* Proposed Infrastructure Siting CAD/Surveyor Layer */}
        {proposedSite && (
          <>
            {/* 3.0 km Catchment Boundary (High-Visibility Illuminated White Tactical Perimeter) */}
            <Circle
              center={[proposedSite.lat, proposedSite.lng]}
              radius={3000}
              pathOptions={{
                color: "#ffffff",
                weight: 1.5,
                dashArray: "4, 6",
                fillColor: "#ffffff",
                fillOpacity: 0.12
              }}
            />

            {/* High-Contrast Allocation Tethers connecting P-01 to each affected well in 3km catchment */}
            {sitingMetrics?.relievedWells.map((well) => (
              <Polyline
                key={`siting-alloc-${well.id}`}
                positions={[
                  [proposedSite.lat, proposedSite.lng],
                  [well.lat, well.lon]
                ]}
                pathOptions={{
                  color: "#ffffff",
                  weight: 1,
                  dashArray: "2, 5",
                  opacity: 0.7
                }}
              />
            ))}

            {/* Solid route polyline from userOrigin to P-01 when proposed is faster */}
            {userOriginLatLng && sitingMetrics && sitingMetrics.routeGeometry.length > 0 && (
              <Polyline
                positions={sitingMetrics.routeGeometry}
                pathOptions={{
                  color: sitingMetrics.isFaster ? "#059669" : "#475569",
                  weight: sitingMetrics.isFaster ? 4 : 2,
                  opacity: sitingMetrics.isFaster ? 0.95 : 0.6,
                  dashArray: sitingMetrics.isFaster ? undefined : "4, 4",
                  lineCap: "round",
                  lineJoin: "round"
                }}
              />
            )}

            {/* Surveyor Benchmark Marker (Node P-01) */}
            <Marker
              position={[proposedSite.lat, proposedSite.lng]}
              icon={proposedBenchmarkIcon}
              zIndexOffset={1200}
            >
              <Popup>
                <div className="text-xs space-y-1 font-mono p-1 min-w-[180px]">
                  <div className="font-bold text-slate-900 border-b border-slate-200 pb-1">
                    PROPOSED RO NODE: P-01
                  </div>
                  <div className="text-[11px] text-slate-700">
                    LAT/LON: {proposedSite.lat.toFixed(5)}N, {proposedSite.lng.toFixed(5)}E
                  </div>
                  <div className="text-[10px] text-slate-500">
                    SUPPLY: 40 L/m (100% Maternal Safe)
                  </div>
                  {sitingMetrics && (
                    <div className="text-[10px] text-emerald-700 font-semibold pt-0.5">
                      {sitingMetrics.deltaMins > 0
                        ? `Time Saved: ${sitingMetrics.deltaMins.toFixed(1)} mins (from ${sitingMetrics.baselineWalkMins.toFixed(1)}m)`
                        : `Transit Time: ${sitingMetrics.proposedWalkMins.toFixed(1)} mins`}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {/* Target Water Point Reticle Marker (Unmistakable Tactical End Pin) */}
        {targetLatLng && (
          <Marker
            position={targetLatLng}
            icon={targetReticleIcon}
            zIndexOffset={1000}
          >
            <Popup>
              <div className="text-xs space-y-1.5 p-1 min-w-[200px] font-mono">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                  <span className="font-bold text-slate-900 truncate max-w-[140px]">
                    {activeRoute?.destination_water_point?.properties?.name || "TARGET WATER TANK"}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-emerald-300 bg-emerald-50 text-emerald-700 font-bold">
                    TARGET
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Coordinates: {targetLatLng[0].toFixed(5)}°N, {targetLatLng[1].toFixed(5)}°E
                </div>
                <div className="text-[11px] text-slate-700">
                  Est. Queue: {activeRoute?.destination_water_point?.properties?.est_queue_time_mins ?? 15} mins
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Palantir Moving Directional Convoy Chevron Marker */}
        {currentPlaybackState && (
          <Marker
            position={[currentPlaybackState.lat, currentPlaybackState.lon]}
            icon={createChevronIcon(currentPlaybackState.bearing)}
            zIndexOffset={1500}
          />
        )}

        {/* Regional Live Micro-Climate Weather Observation Network */}
        <WeatherStations isSimulatedRain={weather?.isRaining} />

        {/* Clustered Water Point Markers */}
        <MarkerClusterGroup chunkedLoading>
          {pointsToRender.map((point) => {
            const [lat, lon] = toLeafletLatLng(point.geometry.coordinates);
            const isFunctional = point.properties.functional_status === "functional";
            const isSafe = point.properties.is_maternal_safe;
            const isSelected = point.properties.id === selectedDestId;
            const isBypassed = point.properties.id === bypassedUnsafeId;

            let icon: L.DivIcon;
            if (!isFunctional) {
              icon = nonFunctionalIcon;
            } else if (isSafe) {
              icon = isSelected ? safeSelectedIcon : functionalSafeIcon;
            } else {
              icon = isSelected
                ? unsafeSelectedIcon
                : isBypassed
                ? bypassedUnsafeMarkerIcon
                : functionalUnsafeIcon;
            }

            const sodium = point.properties.sodium_mg_l;
            const chloride = point.properties.chloride_mg_l;

            return (
              <Marker
                key={point.properties.id || point.properties.external_code}
                position={[lat, lon]}
                icon={icon}
              >
                <Popup>
                  <div className="text-xs space-y-2 p-1 min-w-[220px]">
                    {/* Title and Safe Badge */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
                      <div>
                        <div className="font-bold text-slate-900 leading-tight">
                          {point.properties.name || point.properties.external_code}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {point.properties.external_code}
                        </div>
                      </div>

                      {!isFunctional ? (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-sm border border-rose-300">
                          <XCircle className="h-3 w-3 text-rose-600" /> NON-FUNCTIONAL
                        </span>
                      ) : isBypassed ? (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-sm border border-amber-300">
                          <AlertTriangle className="h-3 w-3 text-amber-600" /> BYPASSED
                        </span>
                      ) : isSafe ? (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm border border-emerald-300 shadow-sm">
                          <ShieldCheck className="h-3 w-3 text-emerald-600" /> SAFE
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-sm border border-rose-300">
                          <AlertTriangle className="h-3 w-3 text-rose-600" /> &gt;300 Na+
                        </span>
                      )}
                    </div>

                    {/* Hydrochemical & Operational Details */}
                    <div className="space-y-1 text-[11px] text-slate-700">
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-mono text-[10px] uppercase font-bold">TYPE:</span>
                        <span className="font-medium text-slate-800">
                          {formatSourceType(point.properties.source_type)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 font-mono text-[10px] uppercase font-bold">SODIUM (NA+):</span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            !isFunctional
                              ? "text-slate-500"
                              : isSafe
                              ? "text-emerald-700"
                              : "text-rose-600"
                          }`}
                        >
                          {sodium !== null && sodium !== undefined
                            ? `${sodium} mg/L`
                            : chloride
                            ? `${Math.round(chloride * 0.55)} mg/L (Derived)`
                            : "Unknown"}
                        </span>
                      </div>

                      {point.properties.salinity_ppt !== undefined &&
                        point.properties.salinity_ppt !== null && (
                          <div className="flex justify-between">
                            <span className="text-slate-500 font-mono text-[10px] uppercase font-bold">SALINITY:</span>
                            <span className="font-mono text-slate-800 tabular-nums">
                              {point.properties.salinity_ppt} ppt
                            </span>
                          </div>
                        )}

                      <div className="flex justify-between">
                        <span className="text-slate-500 font-mono text-[10px] uppercase font-bold">STATUS:</span>
                        <span
                          className={`font-mono text-[10px] uppercase font-bold ${
                            isFunctional ? "text-emerald-700" : "text-rose-600"
                          }`}
                        >
                          {point.properties.functional_status.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-slate-500 font-mono text-[10px] uppercase font-bold">EST. QUEUE:</span>
                        <span className="flex items-center gap-1 text-slate-800 font-mono font-semibold tabular-nums">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {point.properties.est_queue_time_mins ?? point.properties.queue_time_mins ?? 15} mins
                          {point.properties.flow_rate_l_min ? ` (${point.properties.flow_rate_l_min}L/m)` : ""}
                        </span>
                      </div>
                    </div>

                    {/* Action button inside popup */}
                    <div className="pt-1.5 border-t border-slate-200">
                      <button
                        onClick={() => onOriginSelect({ lat, lng: lon })}
                        className="w-full text-center text-[10px] font-mono uppercase font-bold bg-sky-50 hover:bg-sky-100 text-sky-700 py-1 px-2 rounded-sm border border-sky-300 transition-all duration-200 ease-in-out active:scale-95"
                      >
                        Set Origin at this Location
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>

        {/* Custom Glassmorphism Map Controls: Zoom In / Zoom Out and Locate Me */}
        <CustomMapControls
          origin={origin}
          onLocateUser={onOriginSelect}
          onAccuracyChange={setGpsAccuracyMeters}
          onTriggerBrowserGps={onTriggerBrowserGps}
          gpsStatus={gpsStatus}
        />
      </MapContainer>

      {/* Siting Mode Crosshair Canvas Enforcement */}
      {isSitingMode && (
        <style>{`
          .leaflet-container,
          .leaflet-pane,
          .leaflet-interactive,
          .leaflet-grab {
            cursor: crosshair !important;
          }
        `}</style>
      )}

      {/* Engineering Siting Ledger Overlay */}
      {proposedSite && (
        <div className="absolute bottom-24 right-6 z-[450] pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-150">
          <SitingLedger
            proposedSite={proposedSite}
            metrics={sitingMetrics || null}
            onClear={onClearProposedSite || (() => {})}
            onCommit={onCommitProposedNode || (() => {})}
          />
        </div>
      )}
    </div>
  );
}
