// lockin. service worker: makes the app open and work offline after the first visit.
// Bump CACHE whenever the caching rules change: activating a new version deletes the old cache.
const CACHE = "lockin-v3";
const SHELL = ["/", "/today", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}) // a page in SHELL failing (e.g. redirect when signed out) shouldn't block install
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only same-origin GETs; Supabase, auth and API calls always go to the network.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/admin")) return;

  // Build assets: cache-first, but only files the server marks immutable (content-hashed production builds).
  // Dev-server files are "no-cache" and change constantly, so they are never stored.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res, isImmutable(res)))));
    return;
  }

  // Pages and their RSC data: network-first so updates win, but on a slow connection the cached copy is used
  // after 3 s (the network response still refreshes the cache), and offline it's used straight away.
  if (req.mode === "navigate" || url.searchParams.has("_rsc") || req.headers.get("RSC") === "1") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else (icons, fonts, manifest): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => put(req, res, !/no-store/.test(res.headers.get("Cache-Control") ?? "")))
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});

async function networkFirst(req) {
  const network = fetch(req).then((res) => put(req, res, true));
  const cached = caches.match(req);
  const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => cached);
  try {
    return (await Promise.race([network, slow])) || (await network);
  } catch {
    return (await cached) || (req.mode === "navigate" && (await caches.match("/today"))) || Response.error();
  }
}

function isImmutable(res) {
  return /immutable/.test(res.headers.get("Cache-Control") ?? "");
}

function put(req, res, store) {
  if (store && res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

// ── Push reminders (sent by /api/cron/reminders) ──
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "lockin.", {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      tag: data.tag,
      data: { url: data.url || "/today" },
    }),
  );
});

// Tapping a reminder focuses an open lockin. window (or opens one) on the page it points to.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/today", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
