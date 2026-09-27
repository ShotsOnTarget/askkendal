import { THEME_LABELS, URGENCY_LABELS, type Theme } from "@askkendal/ai/civic";

export { THEME_LABELS, URGENCY_LABELS };
export type { Theme };

/**
 * Theme colours, used for chips and for the beacon heads on the map. Saturated enough to read
 * against grey roofs and green fields; amber is kept for "selected".
 */
export const THEME_COLORS: Record<Theme, string> = {
  planning: "#b4532a",
  transport: "#2f5d8a",
  environment: "#1f8a5b",
  economy: "#c99a06",
  community: "#b3265e",
  care: "#7a4fb0",
  children: "#e0701b",
  governance: "#4b5563",
  other: "#8a8f98",
};

export function themeLabel(theme: string | null | undefined): string {
  return THEME_LABELS[(theme ?? "other") as Theme] ?? "Other";
}

export function themeColor(theme: string | null | undefined): string {
  return THEME_COLORS[(theme ?? "other") as Theme] ?? THEME_COLORS.other;
}

export const THEME_KEYS = Object.keys(THEME_LABELS) as Theme[];

export const SOURCE_NAMES: Record<string, string> = {
  "council-news": "Westmorland and Furness Council",
  "town-council": "Kendal Town Council",
  moderngov: "Committee papers",
  "forward-plan": "Forward Plan",
  planning: "Planning",
};
