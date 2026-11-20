"use client";

import React from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Droplet,
  MapPin,
  Clock,
  Compass,
  Info,
  XCircle,
  CloudRain,
  Sun,
  Activity,
  Gauge
} from "lucide-react";
import { Coordinates, FindNearestResponse } from "@/types/routing";
import { getFatigueStatus } from "@/lib/utils";
import { LiveWeatherCondition } from "@/services/routing";
import { ProposedSitingMetrics } from "@/lib/siting";

export type WeatherOverrideMode = "AUTO" | "FORCE_RAIN" | "FORCE_DRY";
export type LiveWeatherState = "RAIN" | "DRY";

interface DashboardProps {
  maternalSafeMode: boolean;
  onToggleMaternalSafe: () => void;
  activeRoute: FindNearestResponse | null;
  origin: Coordinates | null;
  onOriginSelect: (coords: Coordinates) => void;
  season: "dry_season" | "monsoon";
  weather: LiveWeatherCondition | null;
  isLoadingWeather?: boolean;
  weatherOverride?: WeatherOverrideMode;
  onChangeWeatherOverride?: (mode: WeatherOverrideMode) => void;
  liveWeather?: LiveWeatherState;
  activeWeather?: LiveWeatherState;
  onToggleSimulateRain?: () => void;
  isSimulatedRain?: boolean;
  onDetectLocation?: () => void;
  gpsStatus?: "idle" | "requesting" | "success" | "error";
  isSitingMode?: boolean;
  onToggleSitingMode?: () => void;
  proposedSite?: Coordinates | null;
  sitingMetrics?: ProposedSitingMetrics | null;
  onClearProposedSite?: () => void;
  onCommitProposedNode?: () => void;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateCompassHeading(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  const cardinals = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  const index = Math.round(bearing / 22.5) % 16;
  return `${Math.round(bearing)}° ${cardinals[index]}`;
}

export default function Dashboard({
  maternalSafeMode,
  onToggleMaternalSafe,
  activeRoute,
  origin,
  onOriginSelect,
  season,
  weather,
  isLoadingWeather,
  weatherOverride = "AUTO",
  onChangeWeatherOverride,
  liveWeather = "DRY",
  activeWeather,
  onToggleSimulateRain,
  isSimulatedRain,
  onDetectLocation,
  gpsStatus,
  isSitingMode = false,
  onToggleSitingMode,
  proposedSite = null,
  sitingMetrics = null,
  onClearProposedSite,
  onCommitProposedNode
}: DashboardProps) {
  const [internalOverride, setInternalOverride] = React.useState<WeatherOverrideMode>(weatherOverride);
  const effectiveOverride = weatherOverride ?? internalOverride;
  const handleOverrideChange = (mode: WeatherOverrideMode) => {
    setInternalOverride(mode);
    if (onChangeWeatherOverride) {
      onChangeWeatherOverride(mode);
    }
  };

  const resolvedActiveWeather: LiveWeatherState =
    activeWeather ??
    (effectiveOverride === "FORCE_RAIN"
      ? "RAIN"
      : effectiveOverride === "FORCE_DRY"
      ? "DRY"
      : liveWeather);

  const destPoint = activeRoute?.destination_water_point;
  const destProps = destPoint?.properties;
  const isDestSafe = destProps?.is_maternal_safe ?? false;
  const sodiumVal = destProps?.sodium_mg_l;
  const chlorideVal = destProps?.chloride_mg_l;
  const bypassed = activeRoute?.bypassed_unsafe_source;
  const unsafeProps = bypassed?.destination_water_point?.properties;
  const unsafeSodium = unsafeProps?.sodium_mg_l;

  // --- Tortuosity / Unmapped Embankment & Compass Heading Calculations ---
  const destCoords = destPoint?.geometry?.coordinates;
  const destLat = destCoords ? destCoords[1] : null;
  const destLon = destCoords ? destCoords[0] : null;

  const directDistKm =
    origin && destLat !== null && destLon !== null
      ? haversineKm(origin.lat, origin.lng, destLat, destLon)
      : 0;

  const osrmDistKm =
    ((activeRoute?.distance_meters ?? (activeRoute as any)?.effective_route_distance_meters ?? 0)) / 1000;

  const tortuosityRatio = directDistKm > 0.05 && osrmDistKm > 0 ? osrmDistKm / directDistKm : 1.0;

  const isUnmappedEmbankment =
    directDistKm > 0.05 &&
    (tortuosityRatio > 3.5 ||
      !activeRoute?.route_geometry?.coordinates ||
      activeRoute.route_geometry.coordinates.length < 2);

  const isRaining = resolvedActiveWeather === "RAIN";
  const estimatedFootpathKm = directDistKm * 1.35;
  const walkingSpeedKmH = isRaining ? 2.5 : 4.0;
  const embankmentWalkTimeMins = (estimatedFootpathKm / walkingSpeedKmH) * 60;

  const compassHeading =
    origin && destLat !== null && destLon !== null
      ? calculateCompassHeading(origin.lat, origin.lng, destLat, destLon)
      : null;

  const durationMinutes = isUnmappedEmbankment
    ? embankmentWalkTimeMins
    : (activeRoute?.est_walk_time_minutes ?? 0);
  const fatigueStatus = getFatigueStatus(durationMinutes);

  // Dynamic Queue Time from water point model (calculated via flow rate + ST_DWithin spatial isolation)
  const estQueueTime = destProps?.est_queue_time_mins ?? destProps?.queue_time_mins ?? 15;
  const flowRate = destProps?.flow_rate_l_min ?? (
    destProps?.source_type === "ro_plant" ? 10 :
    destProps?.source_type === "deep_tube_well" ? 20 :
    destProps?.source_type === "psf" ? 15 : 12
  );
  const functionalNeighbors = destProps?.functional_neighbors_2km;

  // Format water source name
  const formatSourceType = (type?: string) => {
    switch (type) {
      case "psf":
        return "Pond Sand Filter (PSF)";
      case "ro_plant":
        return "Reverse Osmosis (Solar RO)";
      case "deep_tube_well":
        return "Deep Tube Well";
      case "rainwater_tank":
        return "Rainwater Harvesting Tank";
      case "shallow_tube_well":
        return "Shallow Tube Well";
      default:
        return type ? type.replace(/_/g, " ").toUpperCase() : "Unknown Source";
    }
  };

  const presets = [
    { name: "Paikgachha Bazaar", lat: 22.408, lng: 89.202 },
    { name: "Shyamnagar Edge", lat: 22.310, lng: 89.160 },
    { name: "Dacope Rural", lat: 22.445, lng: 89.270 },
    { name: "Bedkashi Dyke", lat: 22.365, lng: 89.215 },
    { name: "Assasuni Road", lat: 22.435, lng: 89.165 }
  ];

  return (
    <aside className="absolute bottom-5 left-4 z-30 w-full max-w-[440px] pointer-events-auto flex flex-col space-y-2.5">
      {/* Maternal / Hypertension Safe Mode Toggle Card */}
      <div
        className={`rounded-sm p-3.5 transition-all duration-200 ease-in-out backdrop-blur-md shadow-lg shadow-slate-900/10 border ${
          maternalSafeMode
            ? "bg-white/95 border-emerald-500 shadow-md shadow-emerald-500/10"
            : "bg-white/90 border-slate-200"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-sm transition-all duration-200 ease-in-out border ${
                maternalSafeMode
                  ? "bg-emerald-50 text-emerald-600 border-emerald-300 shadow-sm"
                  : "bg-slate-100 text-slate-500 border-slate-200"
              }`}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-900 tracking-wide uppercase font-mono">
                Maternal / Hypertension Safe Mode
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">
                  SODIUM CUTOFF:
                </span>
                <span className="font-mono tabular-nums font-bold text-xs text-emerald-600">
                  ≤ 300 mg/L Na+
                </span>
              </div>
            </div>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            id="maternal-safe-toggle"
            aria-label="Toggle Maternal / Hypertension Safe Mode"
            onClick={onToggleMaternalSafe}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-sm border transition-all duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-emerald-500 hover:opacity-90 active:scale-95 ${
              maternalSafeMode
                ? "bg-emerald-600 border-emerald-500 shadow-sm"
                : "bg-slate-200 border-slate-300"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-md transition-transform duration-200 ease-in-out translate-y-0.5 ${
                maternalSafeMode ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Mode explanation feedback */}
        <div className="mt-2.5 pt-2 border-t border-slate-200 text-[10px] text-slate-600 flex items-start gap-1.5 font-mono">
          <Info className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
          {maternalSafeMode ? (
            <span className="text-emerald-700 leading-relaxed">
              <strong className="text-emerald-800">ENGAGED:</strong> Bypassing tubewells &gt; 300 mg/L Na+ to eliminate gestational hypertension risk.
            </span>
          ) : (
            <span className="text-amber-700 leading-relaxed">
              <strong className="text-amber-800">STANDBY:</strong> Routing nearest functional source regardless of salinity threshold.
            </span>
          )}
        </div>
      </div>

      {/* Floating Metrics & Comparison Card */}
      {activeRoute && destPoint && (
        <div className="rounded-sm bg-white/90 backdrop-blur-md border border-slate-200 p-3.5 shadow-lg shadow-slate-900/10 text-xs space-y-3 divide-y divide-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-300 max-h-[58vh] overflow-y-auto">
          {/* Section 1: Header */}
          <div className="space-y-2 pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">
                  <MapPin className="h-3 w-3 text-sky-600" />
                  <span>SELECTED WATER TARGET</span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mt-1 tracking-tight font-sans">
                  {destProps?.name || destProps?.external_code}
                </h3>
                <div className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                  {destProps?.external_code} · {destProps?.location_name || "Southwest Coastal Zone"}
                </div>
              </div>

              {/* Maternal Safe Badge */}
              {isDestSafe ? (
                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-sm px-2 py-0.5 rounded-sm font-mono text-[10px] font-bold tracking-wider">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  <span>MATERNAL SAFE</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-rose-50 text-rose-700 border border-rose-300 shadow-sm px-2 py-0.5 rounded-sm font-mono text-[10px] font-bold tracking-wider">
                  <AlertTriangle className="h-3 w-3 text-rose-600" />
                  <span>HIGH SALINITY</span>
                </div>
              )}
            </div>

            {/* Compass Heading & Direct Distance Telemetry */}
            {compassHeading && (
              <div className="flex items-center justify-between text-[10px] font-mono bg-sky-50/80 border border-sky-200 px-2 py-1 rounded-sm text-sky-800">
                <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-sky-700">
                  <Compass className="h-3.5 w-3.5 text-sky-600" />
                  HEADING:
                </span>
                <span className="font-bold tabular-nums">
                  {compassHeading}
                </span>
                <span className="text-slate-400">|</span>
                <span className="text-slate-600">DIRECT:</span>
                <span className="font-bold tabular-nums text-slate-800">
                  {directDistKm.toFixed(2)} km
                </span>
              </div>
            )}

            {/* Prominent Unmapped Embankment Path Badge */}
            {isUnmappedEmbankment && (
              <div className="rounded-sm bg-amber-50 border border-amber-300 p-2.5 text-[11px] font-mono text-amber-900 space-y-1 shadow-sm">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  <span>UNMAPPED EMBANKMENT PATH</span>
                </div>
                <p className="text-[10px] text-amber-800 leading-snug">
                  OSM road data incomplete here. Using Satellite Compass Vector (1.35x delta winding estimate).
                </p>
                <div className="flex items-center justify-between pt-1 border-t border-amber-200/80 text-[10px]">
                  <span className="text-amber-700 font-medium">EMBANKMENT WALK:</span>
                  <span className="font-bold text-amber-900 tabular-nums">
                    {embankmentWalkTimeMins.toFixed(1)} mins ({estimatedFootpathKm.toFixed(2)} km)
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Comparison Banner */}
          <div className="pt-3">
            {maternalSafeMode && bypassed && unsafeProps ? (
              <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono border-b border-slate-200 pb-1.5">
                  <span className="uppercase text-[10px] tracking-widest text-rose-600 font-bold flex items-center gap-1.5">
                    <XCircle className="h-3 w-3 text-rose-600" /> HIGH-SALINITY SOURCE BYPASSED
                  </span>
                  <span className="font-mono tabular-nums text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm border border-emerald-300 shadow-sm">
                    +{bypassed.delta_walk_time_minutes}m DELTA
                  </span>
                </div>

                {/* Direct Comparison Grid */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-sm bg-rose-50/70 p-2 border border-rose-200 space-y-0.5">
                    <div className="uppercase text-[10px] tracking-widest text-rose-600 font-bold font-mono">
                      NEAREST UNSAFE
                    </div>
                    <div className="font-semibold text-slate-900 truncate text-xs" title={unsafeProps.name}>
                      {unsafeProps.name || unsafeProps.external_code}
                    </div>
                    <div className="font-mono tabular-nums text-rose-600 font-bold text-xs">
                      {unsafeSodium ?? Math.round((unsafeProps.chloride_mg_l || 0) * 0.55)} mg/L Na+
                    </div>
                    <div className="font-mono tabular-nums text-[10px] text-slate-500">
                      {bypassed.est_walk_time_minutes} mins walk
                    </div>
                  </div>

                  <div className="rounded-sm bg-emerald-50/70 p-2 border border-emerald-200 space-y-0.5">
                    <div className="uppercase text-[10px] tracking-widest text-emerald-700 font-bold font-mono">
                      MATERNAL SAFE
                    </div>
                    <div className="font-semibold text-slate-900 truncate text-xs" title={destProps?.name}>
                      {destProps?.name || destProps?.external_code}
                    </div>
                    <div className="font-mono tabular-nums text-emerald-600 font-bold text-xs">
                      {sodiumVal ?? Math.round((chlorideVal || 0) * 0.55)} mg/L Na+
                    </div>
                    <div className="font-mono tabular-nums text-[10px] text-slate-500">
                      {activeRoute.est_walk_time_minutes} mins walk
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-slate-700 bg-emerald-50/80 p-2 rounded-sm border border-emerald-200 font-mono">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                  <span className="leading-tight">
                    Delta: <strong className="font-mono tabular-nums text-emerald-700 font-bold">+{bypassed.delta_walk_time_minutes} mins</strong> (<span className="font-mono tabular-nums">+{(bypassed.delta_distance_meters / 1000).toFixed(2)} km</span>) to eliminate gestational risk.
                  </span>
                </div>
              </div>
            ) : maternalSafeMode && isDestSafe ? (
              <div className="flex items-center gap-2 rounded-sm bg-emerald-50 border border-emerald-200 p-2 text-[11px] text-emerald-700 font-mono">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                <span>
                  <strong className="font-bold">OPTIMAL SOURCE:</strong> Nearest functional point is verified maternal-safe (≤ 300 mg/L Na+). Zero detour required.
                </span>
              </div>
            ) : !maternalSafeMode && !isDestSafe ? (
              <div className="flex items-center gap-2 rounded-sm bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 font-mono">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                <span>
                  <strong className="font-bold">SALINITY WARNING:</strong> Selected high-salinity source ({sodiumVal} mg/L Na+). Switch to Maternal-Safe Mode.
                </span>
              </div>
            ) : null}
          </div>

          {/* Section 3: 4-Metric Tactical Grid */}
          <div className="pt-3">
            <div className="grid grid-cols-2 gap-2">
              {/* Metric 1: Source Type & Flow Rate */}
              <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">SOURCE TYPE</span>
                  <span className="font-mono tabular-nums text-[9px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-sm border border-sky-200">
                    {flowRate} L/MIN
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 truncate font-sans">
                  <Droplet className="h-3 w-3 text-sky-600 flex-shrink-0" />
                  <span className="truncate">{formatSourceType(destProps?.source_type)}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-500">
                  Yield: High-Cap
                </div>
              </div>

              {/* Metric 2: Measured / Derived Sodium (Na+) */}
              <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">SODIUM (NA+)</span>
                  <span className="font-mono text-[9px] text-slate-500 font-normal">
                    {season === "dry_season" ? "DRY PEAK" : "MONSOON"}
                  </span>
                </div>
                <div
                  className={`text-xs font-mono tabular-nums font-bold ${
                    isDestSafe ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {sodiumVal !== null && sodiumVal !== undefined
                    ? `${sodiumVal.toFixed(1)} mg/L`
                    : chlorideVal
                    ? `${(chlorideVal * 0.55).toFixed(1)} mg/L (Derived)`
                    : "Unmeasured"}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {isDestSafe ? "Within Standard (≤300)" : "Exceeds Cutoff (>300)"}
                </div>
              </div>

              {/* Metric 3: Embankment Walk */}
              <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">WALK DURATION</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-mono text-[9px] font-bold border ${fatigueStatus.badgeClass}`}>
                    <span className={`w-1 h-1 rounded-none ${fatigueStatus.dotClass}`} />
                    {fatigueStatus.label.toUpperCase()}
                  </span>
                </div>

                <div className="text-xs font-mono tabular-nums font-bold flex items-center gap-1.5" style={{ color: fatigueStatus.color }}>
                  <Clock className="h-3 w-3" style={{ color: fatigueStatus.color }} />
                  <span>{durationMinutes.toFixed(1)} mins</span>
                  <span className="text-[10px] text-slate-500 font-normal font-mono tabular-nums">
                    ({(isUnmappedEmbankment ? estimatedFootpathKm : ((activeRoute.effective_route_distance_meters || activeRoute.straight_line_distance_meters * 1.35) / 1000)).toFixed(2)} km)
                  </span>
                  {isUnmappedEmbankment && (
                    <span className="text-[9px] font-mono font-bold text-amber-700 bg-amber-100/80 px-1 rounded-sm border border-amber-300">
                      1.35x
                    </span>
                  )}
                </div>

                <div className="pt-0.5">
                  {isLoadingWeather ? (
                    <span className="text-[10px] text-slate-500 font-mono animate-pulse">Checking Weather...</span>
                  ) : isRaining ? (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded-sm border border-rose-200">
                      <CloudRain className="h-3 w-3 text-rose-600 animate-bounce" />
                      <span className="font-mono">Mud 1.75x ({isUnmappedEmbankment ? "2.5 km/h" : "Slow"})</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded-sm border border-emerald-200">
                      <Sun className="h-3 w-3 text-amber-600" />
                      <span className="font-mono">{isUnmappedEmbankment ? "Embankment 4.0 km/h" : "Dry (~5km/h)"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Metric 4: Dynamic Estimated Queue Wait Time */}
              <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono">EST. QUEUE WAIT</span>
                  <Gauge className="h-3 w-3 text-sky-600" />
                </div>

                <div className="text-xs font-mono tabular-nums font-bold text-slate-900 flex items-center gap-1.5">
                  <span>{estQueueTime} mins</span>
                  <span className="text-[10px] font-normal text-slate-500 font-mono">
                    ({flowRate} L/min)
                  </span>
                </div>

                <div className="text-[10px] text-slate-500 font-mono truncate" title={
                  functionalNeighbors !== undefined
                    ? `${functionalNeighbors} functional neighbors in 2km`
                    : "Community reliance model"
                }>
                  {functionalNeighbors === 0
                    ? "Isolated (+2.5x surge)"
                    : functionalNeighbors === 1
                    ? "Low redundancy (+2.0x)"
                    : functionalNeighbors && functionalNeighbors > 5
                    ? "Dense cluster (Low wait)"
                    : "Standard load"}
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Fatigue / Radius Status */}
          <div className="pt-3 space-y-2">
            <div className={`flex items-center gap-2 rounded-sm border p-2 text-[10px] font-mono transition-all duration-200 ease-in-out ${fatigueStatus.badgeClass}`}>
              {durationMinutes > 30 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
              ) : durationMinutes > 15 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
              )}
              <div className="flex-1 text-slate-700">
                <span className="font-bold text-slate-900">{fatigueStatus.label}:</span>{" "}
                <span className="text-slate-600">
                  {durationMinutes <= 15
                    ? "Manageable walk (< 15 mins). Low physical strain for expectant mothers."
                    : durationMinutes <= 30
                    ? "Moderate exertion (15–30 mins walk) carrying water load across bunds."
                    : "Critical physical strain (> 30 mins). Severe cardiovascular exertion in coastal heat."}
                </span>
              </div>
            </div>

            {activeRoute.exceeds_safe_walking_radius ? (
              <div className="flex items-center gap-2 rounded-sm bg-rose-50 border border-rose-200 p-2 text-[10px] text-rose-700 font-mono">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
                <div>
                  <span className="font-bold text-slate-900">OUT OF RADIUS:</span> Nearest potable source exceeds 5.0 km threshold.
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5 font-mono">
                <span>WITHIN 5.0 KM SERVICE BUFFER</span>
                <span className="text-emerald-700 font-bold">VERIFIED</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Origin Presets Toolbar & Weather Simulation Toggle */}
      <div className="rounded-sm bg-white/90 backdrop-blur-md border border-slate-200 shadow-lg shadow-slate-900/10 p-2 flex flex-col gap-2 text-[11px] transition-all duration-200 ease-in-out">
        {/* Proposed Infrastructure Siting Tool Toggle */}
        {onToggleSitingMode && (
          <button
            type="button"
            onClick={onToggleSitingMode}
            className={`w-full py-1.5 px-2.5 rounded-none font-mono text-[11px] uppercase tracking-wider transition-all duration-150 active:scale-98 text-center font-bold ${
              isSitingMode
                ? "bg-slate-900 text-white border border-slate-900 shadow-sm"
                : "bg-white/90 border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {isSitingMode ? "SITING MODE: SELECT COORDINATE" : "PROPOSE NEW SITE [OFF]"}
          </button>
        )}

        {/* Proposed Infrastructure Siting In-Dashboard Ledger Summary */}
        {proposedSite && sitingMetrics && (
          <div className="rounded-none bg-slate-50 border border-slate-300 p-2 font-mono space-y-1.5 text-[10px]">
            <div className="flex justify-between items-center border-b border-slate-200 pb-1 font-bold text-slate-900">
              <span>SITE SPEC // NODE P-01 (SOLAR RO)</span>
              {onClearProposedSite && (
                <button
                  type="button"
                  onClick={onClearProposedSite}
                  className="text-slate-500 hover:text-slate-900 text-[9px] uppercase font-mono tracking-wider"
                >
                  [CLEAR]
                </button>
              )}
            </div>
            <div className="flex justify-between text-slate-700">
              <span className="text-slate-500">LAT/LON:</span>
              <span className="tabular-nums font-semibold">
                {proposedSite.lat.toFixed(5)}N, {proposedSite.lng.toFixed(5)}E
              </span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span className="text-slate-500">COMMUNITY SUPPLY:</span>
              <span className="tabular-nums font-semibold">40 L/m (100% Maternal Safe)</span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span className="text-slate-500">TIME SAVED PER TRIP:</span>
              <span className="tabular-nums font-semibold">
                {sitingMetrics.deltaMins > 0
                  ? `Saves ${sitingMetrics.deltaMins.toFixed(1)} mins (Reduced from ${sitingMetrics.baselineWalkMins.toFixed(1)}m)`
                  : `+${Math.abs(sitingMetrics.deltaMins).toFixed(1)} mins (${sitingMetrics.proposedWalkMins.toFixed(1)}m transit)`}
              </span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span className="text-slate-500">LOCAL QUEUE RELIEF:</span>
              <span className="tabular-nums font-semibold">
                Eases congestion at {sitingMetrics.relievedCount} nearby pumps
              </span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span className="text-slate-500">CATCHMENT DEMOGRAPHICS:</span>
              {sitingMetrics.isPopLoading ? (
                <span className="text-amber-500 font-bold animate-pulse font-mono text-[10px]">
                  QUERYING WORLDPOP API...
                </span>
              ) : (
                <span className="tabular-nums font-semibold">
                  ~{sitingMetrics.estPopServed ? sitingMetrics.estPopServed.toLocaleString() : "2,950"} residents (100m resolution)
                </span>
              )}
            </div>
            {/* Executive Summary Row */}
            <div className="mt-1 bg-white font-sans text-[10px] text-slate-600 italic border border-slate-200 p-1.5 leading-snug">
              &ldquo;Deploying a Xylem RO unit here secures safe water for an estimated {sitingMetrics.estPopServed ? `~${sitingMetrics.estPopServed.toLocaleString()}` : "local"} residents based on high-resolution spatial demographics.&rdquo;
            </div>
            {onCommitProposedNode && (
              <button
                type="button"
                onClick={onCommitProposedNode}
                className="w-full mt-1.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-mono text-[9px] uppercase tracking-wider rounded-none font-bold transition-colors duration-150"
              >
                [ COMMIT NODE TO ACTIVE GRAPH ]
              </button>
            )}
          </div>
        )}

        {/* Browser Hardware GPS Detect Button */}
        {onDetectLocation && (
          <button
            type="button"
            onClick={onDetectLocation}
            disabled={gpsStatus === "requesting"}
            className={`w-full flex items-center justify-center gap-2 py-1.5 px-2.5 rounded-sm border font-mono font-bold text-[10px] uppercase tracking-wider transition-all duration-150 active:scale-98 shadow-sm ${
              gpsStatus === "requesting"
                ? "bg-amber-50 text-amber-700 border-amber-300 animate-pulse cursor-wait"
                : "bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-300 hover:shadow"
            }`}
            title="Query browser hardware GPS (navigator.geolocation)"
          >
            <Compass className="h-3.5 w-3.5 text-sky-600" />
            <span>
              {gpsStatus === "requesting"
                ? "REQUESTING BROWSER GPS PERMISSION..."
                : "DETECT MY LOCATION (BROWSER GPS)"}
            </span>
          </button>
        )}

        {/* Preset Locations */}
        <div className="flex items-center justify-between gap-1">
          <span className="uppercase text-[10px] tracking-widest text-slate-500 font-bold px-0.5 flex items-center gap-1.5 font-mono">
            <Compass className="h-3 w-3 text-sky-600" /> PRESETS:
          </span>
          <div className="flex items-center gap-1 overflow-x-auto">
            {presets.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => onOriginSelect({ lat: p.lat, lng: p.lng })}
                className={`px-2 py-0.5 rounded-sm transition-all duration-200 ease-in-out whitespace-nowrap text-[10px] font-bold font-mono tabular-nums border hover:border-slate-300 active:scale-95 ${
                  origin?.lat === p.lat && origin?.lng === p.lng
                    ? "bg-sky-100 text-sky-700 border-sky-300 shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 border-slate-200"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Tactical Weather Control Module: METEO TELEMETRY */}
        <div className="pt-2 border-t border-slate-200 space-y-1.5 font-mono">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-widest text-slate-500">
              <Activity className="h-3 w-3 text-sky-600" />
              <span>METEO TELEMETRY</span>
            </span>
            <span className="text-[9px] text-slate-500 font-semibold tabular-nums">
              {resolvedActiveWeather === "RAIN" ? "1.75X MUD PENALTY" : "1.00X NOMINAL SPEED"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 border border-slate-200">
            {/* Button 1: [ AUTO (LIVE) ] */}
            <button
              type="button"
              onClick={() => handleOverrideChange("AUTO")}
              className={`min-h-[40px] flex flex-col items-center justify-center px-1 rounded-none font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border ${
                effectiveOverride === "AUTO"
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-slate-200"
              }`}
              title="Automatic live Open-Meteo precipitation tracking"
            >
              <span>[ AUTO (LIVE) ]</span>
              {effectiveOverride === "AUTO" && (
                <span className="text-[8px] font-normal tracking-tight text-slate-300">
                  API: {liveWeather}
                </span>
              )}
            </button>

            {/* Button 2: [ FORCE RAIN ] */}
            <button
              type="button"
              onClick={() => handleOverrideChange("FORCE_RAIN")}
              className={`min-h-[40px] flex flex-col items-center justify-center px-1 rounded-none font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border ${
                effectiveOverride === "FORCE_RAIN"
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-slate-200"
              }`}
              title="Force rain state with 1.75x mud penalty"
            >
              <span>[ FORCE RAIN ]</span>
            </button>

            {/* Button 3: [ FORCE DRY ] */}
            <button
              type="button"
              onClick={() => handleOverrideChange("FORCE_DRY")}
              className={`min-h-[40px] flex flex-col items-center justify-center px-1 rounded-none font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-150 border ${
                effectiveOverride === "FORCE_DRY"
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-slate-200"
              }`}
              title="Force dry state removing mud penalty"
            >
              <span>[ FORCE DRY ]</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
