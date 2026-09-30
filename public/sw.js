// AI Timeline Service Worker — enables PWA install + offline support
// Bump CACHE_NAME on every release that ships new chunks. The activate
// handler below sweeps any cache that doesn't match this exact name,
// so old assets get evicted on the user's next page load.
const CACHE_NAME = "ai-timeline-v0.1.0";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(["./", "./index.html"]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first for HTML/JS/CSS, cache fallback for offline.
  // BUT: do NOT intercept anything we shouldn't cache —
  //   - non-GET (POST, PUT…)
  //   - cross-origin (live VETT SSE at e.g. http://localhost:5151/events,
  //     plus any other API endpoints the page might call)
  //   - SSE / streaming responses (cloning + cache.put on an infinite stream
  //     deadlocks the response body in some browsers)
  // For these, return early so the browser handles the request natively
  // without the SW touching it.

  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  // Defensive: if the page asks for an event-stream by Accept header, skip.
  const accept = event.request.headers.get("Accept") || "";
  if (accept.includes("text/event-stream")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache 200 OK same-origin responses with a finite body. The
        // Content-Type check skips anything streaming-shaped that slipped
        // through the Accept-header filter.
        const ct = response.headers.get("Content-Type") || "";
        if (
          response.ok &&
          response.status === 200 &&
          response.type === "basic" &&
          !ct.includes("text/event-stream")
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(event.request).then((cached) => cached || new Response("Offline", { status: 503 }));
      })
  );
});
