"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Waves,
  Compass,
  Sparkles,
  Sun,
  CloudRain,
  Presentation,
  MapPin
} from "lucide-react";
import {
  Coordinates,
  WaterPointGeoJSONFeature,
  FindNearestResponse,
  DetectedGpsInfo
} from "@/types/routing";
import {
  BASELINE_SOUTHWEST_WATER_POINTS,
  applySeasonalAquiferShift,
  evaluateNearestWaterPoint
} from "@/lib/water-points-data";
import {
  fetchCurrentWeather,
  applyWeatherPenaltyToRoute,
  LiveWeatherCondition,
  DRY_WEATHER_CONDITION
} from "@/services/routing";
import PitchMetricsModal from "@/components/PitchMetricsModal";
import Dashboard, { WeatherOverrideMode, LiveWeatherState } from "@/components/Dashboard";
import {
  ProposedSitingMetrics,
  evaluateCatchmentHydraulics,
  calculateProposedRoute,
  fetchCatchmentPopulation
} from "@/lib/siting";

// Dynamic SSR-safe import for Leaflet map component with custom loading skeleton
const MapComponent = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="relative flex h-screen w-full items-center justify-center bg-slate-950 text-slate-100">
      <div className="flex flex-col items-center space-y-4 rounded-2xl glass-panel p-8 text-center border border-white/10 shadow-2xl">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0B4F6C]/20 text-[#0ea5e9] border border-[#0ea5e9]/30">
          <Compass className="h-8 w-8 animate-spin" />
          <div className="absolute inset-0 rounded-2xl animate-ping opacity-25 bg-sky-500" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white">Initializing Leaflet GIS Canvas</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            Loading Southwest Bangladesh coastal vector layer and maternal safety matrix...
          </p>
        </div>
      </div>
    </div>
  )
});

export default function Home() {
  // Maternal / Hypertension Safe Mode toggle state (default true for maternal health focus)
  const [maternalSafeMode, setMaternalSafeMode] = useState<boolean>(true);

  // Seasonal hydrological state: "dry_season" (4.6-7.1 mo peak scarcity) vs "monsoon"
  const [season, setSeason] = useState<"dry_season" | "monsoon">("dry_season");

  // Pitch Deck Presentation Drawer state
  const [isPitchModalOpen, setIsPitchModalOpen] = useState<boolean>(false);

  // User selected origin point (lat, lng) - default set near Paikgachha
  const [origin, setOrigin] = useState<Coordinates | null>({
    lat: 22.408,
    lng: 89.202
  });

  // Water points collection state initialized with active season shift
  const [waterPoints, setWaterPoints] = useState<WaterPointGeoJSONFeature[]>(() =>
    applySeasonalAquiferShift(BASELINE_SOUTHWEST_WATER_POINTS, "dry_season")
  );

  // Active calculated route response (with live weather mud penalty applied)
  const [activeRoute, setActiveRoute] = useState<FindNearestResponse | null>(null);

  // Dual-Mode Weather System State: AUTO, FORCE_RAIN, or FORCE_DRY
  const [weatherOverride, setWeatherOverride] = useState<WeatherOverrideMode>("AUTO");
  const [liveWeather, setLiveWeather] = useState<LiveWeatherState>("DRY");
  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);

  // Async function to query real-time Open-Meteo precipitation
  const fetchLiveWeather = useCallback(async (lat: number, lon: number) => {
    setIsLoadingWeather(true);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=precipitation`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const precip = Number(data?.current?.precipitation ?? 0);
        setLiveWeather(precip > 0 ? "RAIN" : "DRY");
      } else {
        setLiveWeather("DRY");
      }
    } catch (err) {
      console.warn("Failed to query Open-Meteo live precipitation", err);
      setLiveWeather("DRY");
    } finally {
      setIsLoadingWeather(false);
    }
  }, []);

  // Trigger live weather fetch on mount or when user origin changes
  useEffect(() => {
    if (origin) {
      fetchLiveWeather(origin.lat, origin.lng);
    }
  }, [origin?.lat, origin?.lng, fetchLiveWeather]);

  // Derived variable activeWeather based on dual-mode resolution
  const activeWeather: LiveWeatherState =
    weatherOverride === "FORCE_RAIN"
      ? "RAIN"
      : weatherOverride === "FORCE_DRY"
      ? "DRY"
      : liveWeather;

  // Synthesize LiveWeatherCondition matching activeWeather
  const weather: LiveWeatherCondition = useMemo(() => {
    const isRaining = activeWeather === "RAIN";
    return {
      precipitation: isRaining ? 16.5 : 0.0,
      weatherCode: isRaining ? 65 : 0,
      isRaining,
      penaltyMultiplier: isRaining ? 1.75 : 1.0,
      label: isRaining
        ? "Rain State: Saturated mud dykes reduce speed to ~2.8 km/h (1.75x penalty)"
        : "Dry Conditions: Standard walking speed (~3.5–5.0 km/h)",
      shortLabel: isRaining ? "Rain: Mud Penalty (1.75x)" : "Dry Conditions",
      conditionDescription: isRaining ? "Monsoon Downpour" : "Clear / Dry Trails",
      speedKmh: isRaining ? 2.8 : 5.0,
      lastUpdated: new Date().toISOString()
    };
  }, [activeWeather]);

  // Loading & error state
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hardware GPS Geolocation State & Abroad/Bangladesh Mode
  const [gpsStatus, setGpsStatus] = useState<"idle" | "requesting" | "success" | "error">("idle");
  const [gpsErrorMessage, setGpsErrorMessage] = useState<string | null>(null);
  const [detectedGps, setDetectedGps] = useState<DetectedGpsInfo | null>(null);
  const [isAbroadMode, setIsAbroadMode] = useState<boolean>(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number; timestamp: number } | null>(null);

  // Proposed Infrastructure Siting Mode State
  const [isSitingMode, setIsSitingMode] = useState<boolean>(false);
  const [proposedSite, setProposedSite] = useState<Coordinates | null>(null);
  const [sitingMetrics, setSitingMetrics] = useState<ProposedSitingMetrics | null>(null);

  // Calculate route with live weather condition and 1.75x mud penalty
  const calculateRoute = useCallback(
    async (
      coords: Coordinates,
      isSafeMode: boolean,
      activeSeason: "dry_season" | "monsoon",
      activeWeatherState: LiveWeatherState
    ) => {
      setIsLoadingRoute(true);
      setErrorMessage(null);

      try {
        const isWet = activeWeatherState === "RAIN";
        const currentCondition: LiveWeatherCondition = {
          precipitation: isWet ? 16.5 : 0.0,
          weatherCode: isWet ? 65 : 0,
          isRaining: isWet,
          penaltyMultiplier: isWet ? 1.75 : 1.0,
          label: isWet
            ? "Rain State: Saturated mud dykes reduce speed to ~2.8 km/h (1.75x penalty)"
            : "Dry Conditions: Standard walking speed (~3.5–5.0 km/h)",
          shortLabel: isWet ? "Rain: Mud Penalty (1.75x)" : "Dry Conditions",
          conditionDescription: isWet ? "Monsoon Downpour" : "Clear / Dry Trails",
          speedKmh: isWet ? 2.8 : 5.0,
          lastUpdated: new Date().toISOString()
        };

        // 2. Fetch base route from API or local fallback
        const payload = {
          user_lat: coords.lat,
          user_lon: coords.lng,
          mode: isSafeMode ? "maternal_safe" : "standard",
          max_radius_km: 5.0,
          season: activeSeason
        };

        let rawRoute: FindNearestResponse;
        const res = await fetch("/api/v1/routing/find-nearest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          rawRoute = await res.json();
        } else {
          rawRoute = evaluateNearestWaterPoint(
            coords.lat,
            coords.lng,
            isSafeMode ? "maternal_safe" : "standard",
            5.0,
            BASELINE_SOUTHWEST_WATER_POINTS,
            activeSeason
          );
        }

        // 3. Apply live weather mud penalty (1.75x) to route duration and polyline status
        const penalizedRoute = applyWeatherPenaltyToRoute(rawRoute, currentCondition);
        setActiveRoute(penalizedRoute);
      } catch {
        // High-precision local fallback
        try {
          const fallback = evaluateNearestWaterPoint(
            coords.lat,
            coords.lng,
            isSafeMode ? "maternal_safe" : "standard",
            5.0,
            BASELINE_SOUTHWEST_WATER_POINTS,
            activeSeason
          );
          const isWet = activeWeatherState === "RAIN";
          const fallbackCondition: LiveWeatherCondition = {
            precipitation: isWet ? 16.5 : 0.0,
            weatherCode: isWet ? 65 : 0,
            isRaining: isWet,
            penaltyMultiplier: isWet ? 1.75 : 1.0,
            label: isWet
              ? "Rain State (1.75x mud penalty)"
              : "Dry Conditions",
            shortLabel: isWet ? "Rain (1.75x Mud)" : "Dry Conditions",
            conditionDescription: isWet ? "Monsoon Downpour" : "Clear / Dry Trails",
            speedKmh: isWet ? 2.8 : 5.0
          };
          const penalizedFallback = applyWeatherPenaltyToRoute(fallback, fallbackCondition);
          setActiveRoute(penalizedFallback);
        } catch (evalErr) {
          setErrorMessage(
            evalErr instanceof Error
              ? evalErr.message
              : "Unable to find eligible water point."
          );
        }
      } finally {
        setIsLoadingRoute(false);
      }
    },
    []
  );

  // Trigger routing calculation when origin, mode, season, or activeWeather changes
  // Suppress delta route if coordinates are abroad (e.g. user inspecting USA building)
  useEffect(() => {
    if (origin) {
      const isInside =
        origin.lat >= 20.5 && origin.lat <= 26.7 && origin.lng >= 88.0 && origin.lng <= 92.7;
      if (!isInside) {
        setActiveRoute(null);
        return;
      }
      calculateRoute(origin, maternalSafeMode, season, activeWeather);
    }
  }, [origin, maternalSafeMode, season, activeWeather, calculateRoute]);

  // Dynamic Siting Evaluation Effect: Evaluates OSRM routing, rain penalty, and 3km hydraulic load shedding
  useEffect(() => {
    if (!proposedSite) {
      setSitingMetrics(null);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    const hydraulics = evaluateCatchmentHydraulics(proposedSite, waterPoints, 3000, 40.0);
    const baselineWalkMins = activeRoute?.est_walk_time_minutes ?? 25.0;
    const penaltyMultiplier = activeWeather === "RAIN" ? 1.75 : 1.0;

    // Immediately reflect demographic calculation loading state
    setSitingMetrics((prev) => ({
      proposedSite,
      straightDistMeters: prev?.straightDistMeters ?? 0,
      effectiveDistMeters: prev?.effectiveDistMeters ?? 0,
      proposedWalkMins: prev?.proposedWalkMins ?? 0,
      baselineWalkMins,
      deltaMins: prev?.deltaMins ?? 0,
      isFaster: prev?.isFaster ?? false,
      routeGeometry: prev?.routeGeometry ?? [],
      relievedWells: hydraulics.relievedWells,
      relievedCount: hydraulics.relievedCount,
      avgQueueDropMins: hydraulics.avgQueueDropMins,
      estPopServed: null,
      isPopLoading: true
    }));

    async function evaluateSiting() {
      if (!proposedSite) return;

      // 1. Calculate routing
      let routeCalc = {
        straightDistMeters: 0,
        effectiveDistMeters: 0,
        proposedWalkMins: 0,
        baselineWalkMins,
        deltaMins: 0,
        isFaster: false,
        routeGeometry: [] as [number, number][]
      };

      if (origin) {
        routeCalc = await calculateProposedRoute(
          origin,
          proposedSite,
          baselineWalkMins,
          penaltyMultiplier,
          controller.signal
        );
      }

      // 2. Query WorldPop Global Project API / High-Resolution Demographic Hash
      const population = await fetchCatchmentPopulation(
        proposedSite.lat,
        proposedSite.lng,
        3.0,
        controller.signal
      );

      if (!isCancelled) {
        setSitingMetrics({
          proposedSite,
          straightDistMeters: routeCalc.straightDistMeters,
          effectiveDistMeters: routeCalc.effectiveDistMeters,
          proposedWalkMins: routeCalc.proposedWalkMins,
          baselineWalkMins: routeCalc.baselineWalkMins,
          deltaMins: routeCalc.deltaMins,
          isFaster: routeCalc.isFaster,
          routeGeometry: routeCalc.routeGeometry,
          relievedWells: hydraulics.relievedWells,
          relievedCount: hydraulics.relievedCount,
          avgQueueDropMins: hydraulics.avgQueueDropMins,
          estPopServed: population,
          isPopLoading: false
        });
      }
    }

    evaluateSiting();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [proposedSite, origin, waterPoints, activeWeather, activeRoute]);

  // Commits P-01 permanently into the active water points state array and exits siting mode
  const handleCommitProposedNode = useCallback(() => {
    if (!proposedSite) return;

    const newNode: WaterPointGeoJSONFeature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [proposedSite.lng, proposedSite.lat]
      },
      properties: {
        id: `node-p01-${Date.now()}`,
        name: "NODE P-01 (SOLAR RO)",
        external_code: "P-01 (SOLAR RO)",
        source_type: "solar_ro",
        functional_status: "functional",
        is_maternal_safe: true,
        potable: true,
        sodium_mg_l: 18.0,
        chloride_mg_l: 32.0,
        salinity_ppt: 0.05,
        elevation_m: 2.8,
        flow_rate_l_min: 40.0,
        est_queue_time_mins: 5,
        queue_time_mins: 5
      }
    };

    // Update relieved queue times for catchment wells
    const relievedMap = new Map(
      (sitingMetrics?.relievedWells || []).map((w) => [w.id, w.relievedQueueMins])
    );

    setWaterPoints((prev) => {
      const updated = prev.map((pt) => {
        const id = pt.properties.id || pt.properties.external_code;
        if (relievedMap.has(id)) {
          const relievedTime = relievedMap.get(id)!;
          return {
            ...pt,
            properties: {
              ...pt.properties,
              est_queue_time_mins: relievedTime,
              queue_time_mins: relievedTime
            }
          };
        }
        return pt;
      });
      return [newNode, ...updated];
    });

    setProposedSite(null);
    setIsSitingMode(false);
  }, [proposedSite, sitingMetrics]);

  // Unconditional Hardware Geolocation Trigger (Browser GPS)
  const triggerBrowserGps = useCallback(() => {
    if (typeof window === "undefined" || !navigator || !navigator.geolocation) {
      setGpsStatus("error");
      setGpsErrorMessage("GPS ERROR: Geolocation is not supported by your browser - Check browser address bar permissions");
      return;
    }

    setGpsStatus("requesting");
    setGpsErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        const accuracy = Math.round(pos.coords.accuracy || 15);

        // Check if inside Bangladesh (lat 20.5–26.7, lon 88.0–92.7)
        const isInsideBangladesh =
          lat >= 20.5 && lat <= 26.7 && lon >= 88.0 && lon <= 92.7;

        let locationName = isInsideBangladesh ? "Coastal Bangladesh" : "Detected Location";
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
            {
              signal: controller.signal,
              headers: { Accept: "application/json" }
            }
          );
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const city = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.county;
            const state = addr.state;
            const country = addr.country;
            const parts = [city, state, country].filter(Boolean);
            if (parts.length > 0) {
              locationName = parts.join(", ");
            } else if (data.display_name) {
              locationName = data.display_name.split(",").slice(0, 3).join(",");
            }
          }
        } catch {
          // Fallback location name remains
        }

        const detected: DetectedGpsInfo = {
          lat,
          lng: lon,
          accuracy,
          locationName,
          isInsideBangladesh,
          timestamp: Date.now()
        };

        setDetectedGps(detected);
        setGpsStatus("success");

        if (isInsideBangladesh) {
          setIsAbroadMode(false);
          setOrigin({ lat, lng: lon });
          setFlyTarget({ lat, lng: lon, zoom: 15, timestamp: Date.now() });
        }
      },
      (err) => {
        setGpsStatus("error");
        setGpsErrorMessage(`GPS ERROR: ${err.message} - Check browser address bar permissions`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const handleFlyToRealLocation = useCallback(() => {
    if (!detectedGps) return;
    setIsAbroadMode(true);
    setOrigin({ lat: detectedGps.lat, lng: detectedGps.lng });
    setFlyTarget({ lat: detectedGps.lat, lng: detectedGps.lng, zoom: 17, timestamp: Date.now() });
  }, [detectedGps]);

  const handleSimulateKhulnaGps = useCallback(() => {
    setIsAbroadMode(false);
    const khulnaCoords = { lat: 22.588, lng: 89.332 };
    setOrigin(khulnaCoords);
    setFlyTarget({ lat: khulnaCoords.lat, lng: khulnaCoords.lng, zoom: 14, timestamp: Date.now() });
    setDetectedGps((prev) =>
      prev
        ? {
            ...prev,
            lat: khulnaCoords.lat,
            lng: khulnaCoords.lng,
            locationName: "Khulna, Coastal Bangladesh",
            isInsideBangladesh: true
          }
        : null
    );
  }, []);

  // Handle map click
  const handleOriginSelect = (coords: Coordinates) => {
    setOrigin(coords);
  };

  // Toggle maternal safe mode
  const handleToggleMaternalSafe = () => {
    setMaternalSafeMode((prev) => !prev);
  };

  // Toggle season state
  const handleToggleSeason = () => {
    const nextSeason: "dry_season" | "monsoon" =
      season === "dry_season" ? "monsoon" : "dry_season";
    setSeason(nextSeason);
    const updatedPoints = applySeasonalAquiferShift(BASELINE_SOUTHWEST_WATER_POINTS, nextSeason);
    setWaterPoints(updatedPoints);
  };


  return (
    <main className="relative flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900">
      {/* Top Header Floating Controls Bar */}
      <header className="absolute top-4 left-4 z-30 pointer-events-none flex flex-wrap items-center gap-2">
        {/* Brand Badge */}
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-sm bg-white/90 backdrop-blur-md px-3 py-2 shadow-lg shadow-slate-900/10 border border-slate-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-slate-100 border border-slate-200 text-sky-600">
            <Waves className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 uppercase font-sans">JalDurbin</h1>
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm border border-emerald-300 shadow-sm font-mono">
                TACTICAL GIS
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
              Coastal Salinity &amp; Maternal Path Optimization
            </p>
          </div>
        </div>

        {/* Live Weather Status Indicator Badge */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-sm bg-white/90 backdrop-blur-md px-3 py-2 text-xs font-semibold shadow-lg shadow-slate-900/10 border border-slate-200 font-mono">
          {isLoadingWeather ? (
            <div className="flex items-center gap-1.5 text-slate-500">
              <Compass className="h-3.5 w-3.5 animate-spin text-sky-600" />
              <span className="font-mono text-[10px]">SYNCING WEATHER...</span>
            </div>
          ) : weather?.isRaining ? (
            <div className="flex items-center gap-2 text-rose-700">
              <CloudRain className="h-3.5 w-3.5 text-rose-600 animate-bounce" />
              <span className="uppercase text-[10px] tracking-wider font-bold">{weather.shortLabel}</span>
              <span className="text-[9px] font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-sm border border-rose-300 tabular-nums font-bold">
                MUD: ~2.8 KM/H
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-700">
              <Sun className="h-3.5 w-3.5 text-amber-600" />
              <span className="uppercase text-[10px] tracking-wider font-bold">{weather?.shortLabel || "DRY CONDITIONS"}</span>
              <span className="text-[9px] font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-sm border border-emerald-300 tabular-nums font-bold">
                VELOCITY: ~5.0 KM/H
              </span>
            </div>
          )}
        </div>

        {/* Season Hydrology Toggle Button */}
        <button
          type="button"
          onClick={handleToggleSeason}
          className={`pointer-events-auto flex items-center gap-2 rounded-sm bg-white/90 backdrop-blur-md px-3 py-2 text-xs font-semibold shadow-lg shadow-slate-900/10 border transition-all duration-200 ease-in-out hover:scale-102 active:scale-95 font-mono ${
            season === "dry_season"
              ? "border-amber-300 text-amber-800 hover:bg-amber-50/50 shadow-sm"
              : "border-sky-300 text-sky-800 hover:bg-sky-50/50 shadow-sm"
          }`}
          title="Toggle between dry-season salinity surge and monsoon recharge"
        >
          {season === "dry_season" ? (
            <>
              <Sun className="h-3.5 w-3.5 text-amber-600 animate-spin-slow" />
              <span className="uppercase text-[10px] tracking-wider font-bold">PEAK DRY SEASON (4.6–7.1 MO)</span>
              <span className="text-[9px] font-mono tabular-nums bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-sm border border-amber-300 font-bold">
                +40% NA+
              </span>
            </>
          ) : (
            <>
              <CloudRain className="h-3.5 w-3.5 text-sky-600" />
              <span className="uppercase text-[10px] tracking-wider font-bold">MONSOON RECHARGE</span>
              <span className="text-[9px] font-mono tabular-nums bg-sky-50 text-sky-800 px-1.5 py-0.5 rounded-sm border border-sky-300 font-bold">
                FRESHWATER
              </span>
            </>
          )}
        </button>

        {/* Pitch Deck Presentation Mode Button */}
        <button
          type="button"
          onClick={() => setIsPitchModalOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-sm bg-white/90 backdrop-blur-md hover:bg-slate-50 text-slate-800 px-3 py-2 text-xs font-bold font-mono uppercase tracking-wider shadow-lg shadow-slate-900/10 border border-slate-200 transition-all duration-200 ease-in-out hover:scale-102 active:scale-95"
        >
          <Presentation className="h-3.5 w-3.5 text-emerald-600" />
          <span>PITCH DECK</span>
          <Sparkles className="h-3 w-3 text-emerald-600" />
        </button>

        {/* Proposed Infrastructure Siting Tool Toggle Button */}
        <button
          type="button"
          onClick={() => setIsSitingMode((prev) => !prev)}
          className={`pointer-events-auto rounded-none transition-all duration-150 select-none shadow-lg shadow-slate-900/10 ${
            isSitingMode
              ? "bg-slate-900 text-white border border-slate-900 font-mono text-[11px] uppercase tracking-wider px-2.5 py-1"
              : "bg-white/90 border border-slate-300 text-slate-700 hover:bg-slate-50 font-mono text-[11px] uppercase tracking-wider px-2.5 py-1"
          }`}
          title="Toggle civil-engineering siting tool to evaluate prospective Reverse Osmosis (RO) placement"
        >
          {isSitingMode ? "SITING MODE: SELECT COORDINATE" : "PROPOSE NEW SITE [OFF]"}
        </button>

        {/* Legend pills */}
        <div className="pointer-events-auto hidden 2xl:flex items-center gap-2 rounded-sm bg-white/90 backdrop-blur-md px-2.5 py-1.5 text-[10px] font-mono border border-slate-200 shadow-lg shadow-slate-900/10">
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold">
            <span className="h-2 w-2 rounded-none bg-emerald-600" />
            <span>SAFE (≤ 300 NA+)</span>
          </div>
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm bg-rose-50 border border-rose-200 text-rose-700 font-bold">
            <span className="h-2 w-2 rounded-none bg-rose-600" />
            <span>SALINE (&gt; 300 NA+)</span>
          </div>
        </div>
      </header>

      {/* Main Full-Bleed Map Viewport */}
      <div className="relative h-screen w-full overflow-hidden">
        <MapComponent
          waterPoints={waterPoints}
          origin={origin}
          onOriginSelect={handleOriginSelect}
          activeRoute={activeRoute}
          maternalSafeMode={maternalSafeMode}
          season={season}
          weather={weather}
          gpsStatus={gpsStatus}
          gpsErrorMessage={gpsErrorMessage}
          onClearGpsError={() => setGpsErrorMessage(null)}
          detectedGps={detectedGps}
          onClearDetectedGps={() => setDetectedGps(null)}
          isAbroadMode={isAbroadMode}
          onTriggerBrowserGps={triggerBrowserGps}
          flyTarget={flyTarget}
          onFlyToRealLocation={handleFlyToRealLocation}
          onSimulateKhulnaGps={handleSimulateKhulnaGps}
          isSitingMode={isSitingMode}
          proposedSite={proposedSite}
          onProposedSiteSelect={(coords) => setProposedSite(coords)}
          onClearProposedSite={() => setProposedSite(null)}
          onCommitProposedNode={handleCommitProposedNode}
          sitingMetrics={sitingMetrics}
        />
      </div>

      {/* Sticky Floating Dashboard (Bottom-Left / Left Panel) */}
      <Dashboard
        maternalSafeMode={maternalSafeMode}
        onToggleMaternalSafe={handleToggleMaternalSafe}
        activeRoute={activeRoute}
        origin={origin}
        onOriginSelect={handleOriginSelect}
        season={season}
        weather={weather}
        isLoadingWeather={isLoadingWeather}
        weatherOverride={weatherOverride}
        onChangeWeatherOverride={setWeatherOverride}
        liveWeather={liveWeather}
        activeWeather={activeWeather}
        onDetectLocation={triggerBrowserGps}
        gpsStatus={gpsStatus}
        isSitingMode={isSitingMode}
        onToggleSitingMode={() => setIsSitingMode((prev) => !prev)}
        proposedSite={proposedSite}
        sitingMetrics={sitingMetrics}
        onClearProposedSite={() => setProposedSite(null)}
        onCommitProposedNode={handleCommitProposedNode}
      />

      {/* Floating Instructions Tooltip (Top Right) */}
      <div className="absolute top-4 right-52 z-20 pointer-events-none hidden xl:block">
        <div className="pointer-events-auto rounded-sm bg-white/90 backdrop-blur-md px-3 py-1.5 border border-slate-200 text-[10px] font-mono text-slate-600 shadow-lg shadow-slate-900/10 flex items-center gap-2 uppercase tracking-wider font-bold">
          <MapPin className="h-3.5 w-3.5 text-sky-600 animate-bounce" />
          <span>
            {isSitingMode
              ? "Click map canvas to benchmark prospective RO installation node (P-01)"
              : "Click map canvas to recalibrate tactical route"}
          </span>
        </div>
      </div>

      {/* Pitch Deck Slide-Over Modal */}
      <PitchMetricsModal
        isOpen={isPitchModalOpen}
        onClose={() => setIsPitchModalOpen(false)}
      />
    </main>
  );
}
