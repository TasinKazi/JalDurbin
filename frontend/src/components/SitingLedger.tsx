"use client";

import React from "react";
import { Coordinates } from "@/types/routing";
import { ProposedSitingMetrics } from "@/lib/siting";

interface SitingLedgerProps {
  proposedSite: Coordinates;
  metrics: ProposedSitingMetrics | null;
  onClear: () => void;
  onCommit: () => void;
  className?: string;
}

export default function SitingLedger({
  proposedSite,
  metrics,
  onClear,
  onCommit,
  className = ""
}: SitingLedgerProps) {
  const lat = proposedSite.lat;
  const lon = proposedSite.lng;

  const baselineWalkMins = metrics?.baselineWalkMins ?? 0;
  const proposedWalkMins = metrics?.proposedWalkMins ?? 0;
  const deltaMins = metrics?.deltaMins ?? 0;
  const relievedCount = metrics?.relievedCount ?? 0;
  const avgQueueDropMins = metrics?.avgQueueDropMins ?? 0;
  const estPopServed = metrics?.estPopServed ?? 2954;

  const deltaSign = deltaMins > 0 ? "-" : "+";
  const absDeltaFormatted = Math.abs(deltaMins).toFixed(1);

  return (
    <div
      className={`w-80 bg-white/95 backdrop-blur-md border border-slate-300 shadow-md rounded-none p-3 font-mono text-slate-900 select-none ${className}`}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between pb-2">
        <span className="font-bold text-[11px] text-slate-900 tracking-wider">
          SITE SPEC // NODE P-01 (SOLAR RO)
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-slate-500 hover:text-slate-900 uppercase font-mono tracking-wider transition-colors duration-150"
        >
          [CLEAR]
        </button>
      </div>

      {/* Executive Impact Metric Rows */}
      <div className="divide-y divide-slate-200 border-t border-b border-slate-200 text-xs">
        {/* Row 1: Grid Ref */}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-[11px]">LAT/LON</span>
          <span className="font-semibold text-slate-900 tabular-nums text-[11px]">
            {lat.toFixed(5)}N, {lon.toFixed(5)}E
          </span>
        </div>

        {/* Row 2: Community Supply */}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-[11px]">COMMUNITY SUPPLY</span>
          <span className="font-semibold text-slate-900 tabular-nums text-[11px]">
            40 L/m (100% Maternal Safe)
          </span>
        </div>

        {/* Row 3: Time Saved */}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-[11px]">TIME SAVED PER TRIP</span>
          <span className="font-semibold text-slate-900 tabular-nums text-[11px]">
            {deltaMins > 0
              ? `Saves ${deltaMins.toFixed(1)} mins (Reduced from ${baselineWalkMins.toFixed(1)}m)`
              : `+${Math.abs(deltaMins).toFixed(1)} mins (${proposedWalkMins.toFixed(1)}m transit)`}
          </span>
        </div>

        {/* Row 4: Local Queue Relief */}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-[11px]">LOCAL QUEUE RELIEF</span>
          <span className="font-semibold text-slate-900 tabular-nums text-[11px]">
            Eases congestion at {relievedCount} nearby pumps
          </span>
        </div>

        {/* Row 5: Catchment Demographics */}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-[11px]">CATCHMENT DEMOGRAPHICS</span>
          {metrics?.isPopLoading ? (
            <span className="text-amber-500 font-bold animate-pulse font-mono text-[10px]">
              QUERYING WORLDPOP API...
            </span>
          ) : (
            <span className="font-semibold text-slate-900 tabular-nums text-[11px]">
              ~{estPopServed ? estPopServed.toLocaleString() : "2,950"} residents (100m resolution)
            </span>
          )}
        </div>
      </div>

      {/* Executive Summary Row */}
      <div className="mt-2 bg-slate-50 font-sans text-xs text-slate-600 italic border border-slate-200 p-2 leading-relaxed">
        &ldquo;Deploying a Xylem RO unit here secures safe water for an estimated {estPopServed ? `~${estPopServed.toLocaleString()}` : "local"} residents based on high-resolution spatial demographics.&rdquo;
      </div>

      {/* Commit Action Button */}
      <button
        type="button"
        onClick={onCommit}
        className="w-full mt-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[10px] uppercase tracking-wider font-mono font-bold transition-colors duration-150 rounded-none cursor-pointer"
      >
        [ COMMIT NODE TO ACTIVE GRAPH ]
      </button>
    </div>
  );
}
