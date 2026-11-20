import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Route Fatigue Color Logic (Daylight High-Legibility Palette):
 * <= 15 mins: #059669 (Emerald 600 - Low Strain / Safe)
 * 15-30 mins: #d97706 (Amber 600 - Moderate Strain / Warning)
 * > 30 mins:  #e11d48 (Rose 600 - Critical Strain / Danger)
 */
export const getRouteColor = (durationMinutes: number): string => {
  if (durationMinutes <= 15) return "#059669";
  if (durationMinutes <= 30) return "#d97706";
  return "#e11d48";
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
      color: "#059669",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-300 rounded-sm shadow-sm",
      dotClass: "bg-emerald-600"
    };
  }
  if (durationMinutes <= 30) {
    return {
      label: "Moderate Strain",
      color: "#d97706",
      badgeClass: "bg-amber-50 text-amber-700 border-amber-300 rounded-sm shadow-sm",
      dotClass: "bg-amber-600"
    };
  }
  return {
    label: "High Physical Strain",
    color: "#e11d48",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-300 rounded-sm shadow-sm",
    dotClass: "bg-rose-600"
  };
};
