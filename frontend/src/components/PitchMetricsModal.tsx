"use client";

import React, { useEffect } from "react";
import {
  X,
  Users,
  ShieldCheck,
  Clock,
  Database,
  TrendingUp,
  Sparkles,
  Waves,
  HeartPulse,
  Compass,
  ArrowRight,
  Droplets,
  Layers
} from "lucide-react";

interface PitchMetricsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PitchMetricsModal({ isOpen, onClose }: PitchMetricsModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Slide-over Drawer Panel */}
      <div className="relative h-full w-full max-w-xl bg-white/95 backdrop-blur-xl border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-slate-100 border border-slate-200 text-sky-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider font-sans">
                  JalDurbin Impact Architecture
                </h2>
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm border border-emerald-300 shadow-sm font-mono">
                  DECK
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Coastal Climate Resilience &amp; Maternal-Safe GIS Engine
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 active:scale-95 transition-all duration-200 ease-in-out"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-slate-700">
          {/* Executive Value Proposition Banner */}
          <div className="rounded-sm bg-slate-50 p-3.5 border border-slate-200 shadow-sm space-y-1">
            <div className="uppercase text-[10px] tracking-widest text-sky-700 font-bold font-mono flex items-center gap-1.5">
              <Waves className="h-3.5 w-3.5" /> PROBLEM STATEMENT &amp; ARCHITECTURE
            </div>
            <p className="text-xs text-slate-700 leading-relaxed font-sans">
              In Southwest Bangladesh, severe saline intrusion forces pregnant and postpartum women to walk hours along broken dykes, drinking water with sodium exceeding 1,200 mg/L. JalDurbin couples stoichiometric chemical filtering with rural embankment network routing to eliminate maternal hypertension risk.
            </p>
          </div>

          {/* Key Metric 1: Target Population */}
          <div className="rounded-sm bg-white/90 backdrop-blur-md p-3.5 border border-slate-200 hover:border-sky-300 transition-all duration-200 ease-in-out space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-sky-600" /> TARGET POPULATION
              </div>
              <span className="text-[10px] font-mono font-bold bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-sm border border-sky-300 uppercase">
                KHULNA &amp; SATKHIRA
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 tracking-tight">
                66,234
              </span>
              <span className="text-[11px] text-slate-500 font-mono uppercase">coastal rural households</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-sans">
              Serving highly vulnerable unions across Paikgachha, Shyamnagar, Dacope, Assasuni, and Koyra surrounded by saline tidal estuaries (Shibsa, Pasur, and Kholpetua rivers).
            </p>
          </div>

          {/* Key Metric 2: Maternal Health Safeguard */}
          <div className="rounded-sm bg-white/90 backdrop-blur-md p-3.5 border border-emerald-300 hover:border-emerald-400 transition-all duration-200 ease-in-out space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="uppercase text-[10px] tracking-widest text-emerald-700 font-bold font-mono flex items-center gap-1.5">
                <HeartPulse className="h-3.5 w-3.5 text-emerald-600" /> MATERNAL HEALTH SAFEGUARD
              </div>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-sm border border-emerald-300 font-mono font-bold shadow-sm">
                ≤ 300 MG/L NA+
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 tracking-tight">
                3.3x – 5.5x
              </span>
              <span className="text-[11px] text-emerald-700 font-mono uppercase font-bold">reduction in gestational hypertension risk</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-sans">
              Clinical cohorts in coastal Bangladesh demonstrate that maternal drinking sodium &gt; 300 mg/L directly drives preeclampsia and preterm births. JalDurbin strictly reroutes pregnant women to verified sweet aquifer and solar RO sources.
            </p>
          </div>

          {/* Key Metric 3: Time Poverty Reduction */}
          <div className="rounded-sm bg-white/90 backdrop-blur-md p-3.5 border border-slate-200 hover:border-amber-300 transition-all duration-200 ease-in-out space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-amber-600" /> TIME POVERTY ALLEVIATION
              </div>
              <span className="text-[10px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-sm border border-amber-300 font-mono font-bold uppercase">
                1.35x TORTUOSITY
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono tabular-nums text-amber-800 tracking-tight">
                1.5 – 6.0 HRS
              </span>
              <span className="text-[11px] text-slate-500 font-mono uppercase">daily water collection mitigated</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-sans">
              Traditional routing calculates impossible straight lines across tidal rivers. JalDurbin’s embankment snapping respects polder dykes, culverts, and canal bridges while warning against hazardous carrying fatigue (&gt; 2.5 km one-way).
            </p>
          </div>

          {/* Key Metric 4: Ingestion Pipeline & Data Authority */}
          <div className="rounded-sm bg-white/90 backdrop-blur-md p-3.5 border border-slate-200 space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="uppercase text-[10px] tracking-widest text-slate-500 font-bold font-mono flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-sky-600" /> OPEN GEOSPATIAL PIPELINE
              </div>
              <span className="text-[10px] font-mono font-bold bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-sm border border-sky-300 uppercase">
                INGESTION
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-0.5 text-center font-mono text-xs">
              <div className="p-2 rounded-sm bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900 text-sm tabular-nums">18,873</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">WPDX NODES</div>
              </div>
              <div className="p-2 rounded-sm bg-slate-50 border border-slate-200">
                <div className="font-bold text-emerald-700 text-sm">DPHE-BGS</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">LAB COHORTS</div>
              </div>
              <div className="p-2 rounded-sm bg-slate-50 border border-slate-200">
                <div className="font-bold text-sky-700 text-sm tabular-nums">4.6–7.1 MO</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">DRY PEAK</div>
              </div>
            </div>
          </div>

          {/* Interactive Live Demo Guide */}
          <div className="rounded-sm bg-slate-50 p-3.5 border border-slate-200 shadow-sm space-y-2">
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-widest font-mono">
              <Compass className="h-3.5 w-3.5 text-sky-600" /> LIVE DEMO PROTOCOL FOR JUDGES
            </div>
            <div className="space-y-1.5 text-[11px] text-slate-700 font-mono">
              <div className="flex items-start gap-2">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-none bg-sky-600 text-white font-mono text-[9px] font-bold mt-0.5">1</span>
                <span><strong>Switch to Peak Dry Season:</strong> Watch seasonal salinity spikes flip vulnerable unlined ponds from safe green to warning amber.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-none bg-sky-600 text-white font-mono text-[9px] font-bold mt-0.5">2</span>
                <span><strong>Toggle Maternal-Safe Mode:</strong> Dual route comparison renders a dashed warning bypass line to the close saline well and a solid green line to the safe RO plant.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-none bg-sky-600 text-white font-mono text-[9px] font-bold mt-0.5">3</span>
                <span><strong>Inspect Delta Walk Metric:</strong> The card shows the exact walk delta (+3.9 to +12 mins) to completely protect maternal health.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-3.5 border-t border-slate-200 bg-white/90 backdrop-blur-md flex items-center justify-between">
          <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider font-bold">
            JalDurbin · Tactical Coastal GIS Engine
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-sm bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-700 text-xs font-mono uppercase font-bold shadow-sm transition-all duration-200 ease-in-out active:scale-95"
          >
            Return to GIS Console
          </button>
        </div>
      </div>
    </div>
  );
}
