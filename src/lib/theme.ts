"use client";

import { useEffect, useState } from "react";

export const THEMES = [
  { id: "night", label: "night", bg: "#000000", fg: "#ececec" },
  { id: "paper", label: "paper", bg: "#f5eedb", fg: "#2a2318" },
  { id: "sepia", label: "sepia", bg: "#eadcb6", fg: "#2b2214" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "lockin-theme";
const listeners = new Set<(t: ThemeId) => void>();

export function readTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? (t as ThemeId) : "night";
  } catch {
    return "night";
  }
}

export function setTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode etc.: the theme still applies for this visit.
  }
  apply(id);
  listeners.forEach((l) => l(id));
}

function apply(id: ThemeId) {
  const root = document.documentElement;
  if (id === "night") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  const bg = THEMES.find((t) => t.id === id)!.bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function useTheme() {
  const [theme, set] = useState<ThemeId>("night");
  useEffect(() => {
    set(readTheme());
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return theme;
}

/** Text weight: every font weight in the app shifts up a step per level (see globals.css). */
export const WEIGHTS = [
  { id: "regular", label: "regular", sample: 400 },
  { id: "medium", label: "medium", sample: 500 },
  { id: "bold", label: "bold", sample: 600 },
] as const;
export type WeightId = (typeof WEIGHTS)[number]["id"];

const WEIGHT_KEY = "lockin-weight";
const weightListeners = new Set<(w: WeightId) => void>();

export function readWeight(): WeightId {
  try {
    const w = localStorage.getItem(WEIGHT_KEY);
    return WEIGHTS.some((x) => x.id === w) ? (w as WeightId) : "regular";
  } catch {
    return "regular";
  }
}

export function setWeight(id: WeightId) {
  try {
    localStorage.setItem(WEIGHT_KEY, id);
  } catch {
    // Private mode etc.: the weight still applies for this visit.
  }
  const root = document.documentElement;
  if (id === "regular") root.removeAttribute("data-weight");
  else root.setAttribute("data-weight", id);
  weightListeners.forEach((l) => l(id));
}

export function useWeight() {
  const [weight, set] = useState<WeightId>("regular");
  useEffect(() => {
    set(readWeight());
    weightListeners.add(set);
    return () => void weightListeners.delete(set);
  }, []);
  return weight;
}

/** Inline script for <head>: applies the saved theme and text weight before first paint (no flash). */
export const THEME_BOOT = `try{var d=document.documentElement,t=localStorage.getItem("${KEY}");if(t==="paper"||t==="sepia"){d.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="paper"?"#f5eedb":"#eadcb6")}var w=localStorage.getItem("${WEIGHT_KEY}");if(w==="medium"||w==="bold")d.setAttribute("data-weight",w)}catch(e){}`;
