import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "lockin. — JEE tracker",
    short_name: "lockin.",
    description: "Track every chapter, topic and mock for JEE Main + Advanced 2027.",
    // The proxy routes "/" to each account's home: /admin for admins, /today for students (signed out: the landing page).
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["education", "productivity"],
    icons: [
      { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
      { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home-screen icon (Android) to jump straight in.
    shortcuts: [
      { name: "Start focus", short_name: "Focus", url: "/focus", icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }] },
      { name: "Today", url: "/today", icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }] },
    ],
  };
}
