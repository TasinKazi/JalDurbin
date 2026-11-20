"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";

export interface RegionalStationConfig {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
}

export interface RegionalStationData extends RegionalStationConfig {
  precipitation: number;
  time?: string;
  loaded: boolean;
}

/**
 * Parses Open-Meteo current.time UTC/ISO string and formats as a precise local time (e.g., "11:37 AM")
 */
export function formatObservationTime(timeString?: string): string {
  if (!timeString) {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  }
  try {
    const isoString = timeString.endsWith("Z") ? timeString : `${timeString}Z`;
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      const fallbackDate = new Date(timeString);
      if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
      }
      return timeString;
    }
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return timeString;
  }
}

// Regional weather nodes across Southwest Bangladesh
export const REGIONAL_STATIONS: RegionalStationConfig[] = [
  {
    id: "khulna",
    name: "Khulna City",
    shortName: "KHULNA",
    lat: 22.8456,
    lon: 89.5403
  },
  {
    id: "satkhira",
    name: "Satkhira",
    shortName: "SATKHIRA",
    lat: 22.7185,
    lon: 89.0705
  },
  {
    id: "koyra",
    name: "Koyra (Coastal)",
    shortName: "KOYRA",
    lat: 22.3423,
    lon: 89.3082
  },
  {
    id: "shyamnagar",
    name: "Shyamnagar",
    shortName: "SHYAMNAGAR",
    lat: 22.3308,
    lon: 89.1026
  }
];

// SVG Strings matching Lucide Sun & CloudRain with precision stroke & styling
const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;

const RAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>`;

/**
 * Creates an enterprise-grade L.divIcon for a regional weather station node
 */
function createStationDivIcon(shortName: string, precipitation: number): L.DivIcon {
  const isRain = precipitation > 0;
  const iconSvg = isRain ? RAIN_SVG : SUN_SVG;

  return L.divIcon({
    className: "weather-station-div-icon",
    html: `
      <div class="relative w-8 h-8 flex flex-col items-center justify-center group pointer-events-auto cursor-pointer">
        <div class="bg-white/90 backdrop-blur-md border border-slate-200 shadow-sm rounded-sm p-1.5 flex items-center justify-center transition-all duration-200 hover:scale-110">
          ${iconSvg}
        </div>
        <span class="absolute top-full left-1/2 -translate-x-1/2 text-[8px] font-mono uppercase tracking-widest text-slate-500 mt-0.5 whitespace-nowrap bg-white/80 px-1 py-0.5 rounded-sm border border-slate-200/60 shadow-xs pointer-events-none select-none font-bold">
          ${shortName}
        </span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
}

interface WeatherStationsProps {
  isSimulatedRain?: boolean;
}

export default function WeatherStations({ isSimulatedRain }: WeatherStationsProps) {
  const [stations, setStations] = useState<RegionalStationData[]>(() =>
    REGIONAL_STATIONS.map((st) => ({
      ...st,
      precipitation: 0,
      loaded: false
    }))
  );

  useEffect(() => {
    let isCancelled = false;

    // Fetch live precipitation & timestamp from Open-Meteo across all nodes in parallel
    Promise.all(
      REGIONAL_STATIONS.map(async (st) => {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&current=precipitation`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const precipitation = Number(data?.current?.precipitation ?? 0);
          const time = data?.current?.time as string | undefined;
          return {
            ...st,
            precipitation,
            time,
            loaded: true
          };
        } catch (err) {
          console.warn(`[WeatherStations] Live fetch failed for ${st.name}:`, err);
          return {
            ...st,
            precipitation: 0,
            time: undefined,
            loaded: true
          };
        }
      })
    ).then((results) => {
      if (!isCancelled) {
        setStations(results);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Pre-generate divIcons for performance
  const stationIcons = useMemo(() => {
    const iconMap: Record<string, L.DivIcon> = {};
    for (const st of stations) {
      const activePrecip = isSimulatedRain ? Math.max(st.precipitation, 12.5) : st.precipitation;
      iconMap[st.id] = createStationDivIcon(st.shortName, activePrecip);
    }
    return iconMap;
  }, [stations, isSimulatedRain]);

  return (
    <>
      {stations.map((st) => {
        const icon = stationIcons[st.id];
        const activePrecip = isSimulatedRain ? Math.max(st.precipitation, 12.5) : st.precipitation;
        const isRain = activePrecip > 0;
        const formattedTime = formatObservationTime(st.time);

        return (
          <Marker
            key={`weather-station-${st.id}`}
            position={[st.lat, st.lon]}
            icon={icon}
            zIndexOffset={-100} // Keeps weather nodes below water point cluster markers so infrastructure remains primary
          >
            <Popup>
              <div className="p-1 font-mono text-xs space-y-1.5 min-w-[190px]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                  <span className="font-bold text-slate-900">{st.name}</span>
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-slate-200 bg-slate-50 text-slate-600 font-bold">
                    STATION
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Coordinates: {st.lat.toFixed(4)}°N, {st.lon.toFixed(4)}°E
                </div>
                <div className="flex items-center justify-between text-[11px] pt-0.5">
                  <span className="text-slate-600 font-medium">Precipitation:</span>
                  <span className={`font-bold tabular-nums ${isRain ? "text-blue-600" : "text-amber-600"}`}>
                    {activePrecip.toFixed(1)} mm/h
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] pt-0.5 border-t border-slate-100">
                  <span className="text-slate-600 font-medium">Last Updated:</span>
                  <span className="font-mono font-bold text-slate-800 tabular-nums">
                    {formattedTime}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 font-medium pt-0.5">
                  {isRain ? "🌧️ Active precipitation observed" : "☀️ Clear / Dry conditions"}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
