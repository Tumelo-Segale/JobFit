/* JobFit Service Worker — v1.0.0
   Strategy:
   - App shell (HTML, CSS, JS, assets): cache-first, update in background
   - Cloudflare counter worker: network-only (never cache live counts)
*/

const CACHE = "jobfit-v1";

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./pdf.min.js",
  "./pdf.worker.min.js",
  "./mammoth.browser.min.js",
  "./icon.png",
  "./manifest.json",
];

/* ── Install: pre-cache app shell ─────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: purge old caches ───────────────────────── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for app shell, network-only for API ── */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache the counter worker or Cloudflare analytics beacon
  if (
    url.hostname.endsWith("workers.dev") ||
    url.hostname.endsWith("cloudflareinsights.com")
  ) {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response("{}", {
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // Cache-first for everything else (app shell)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached, refresh in background
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (
              response &&
              response.status === 200 &&
              response.type === "basic"
            ) {
              const clone = response.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {});
        return cached;
      }
      // Not in cache — fetch from network and cache it
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
