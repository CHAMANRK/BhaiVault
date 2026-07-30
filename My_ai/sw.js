// ═══════════════════════════════════════════════════════════════════════
// sw.js — Chaman AI v2 service worker.
//
// REPLACES an old leftover sw.js from a previous unrelated PWA shell that
// lived in this repo folder before the v2 rebuild — that one was
// cache-first with no version string, so it kept serving a stale cached
// page (missing css/style.css etc.) even after new deployments. Root
// cause + fix: https://web.dev/articles/service-worker-lifecycle
//
// STRATEGY: network-first for everything this app owns. Always try the
// network first (so a fresh deploy is picked up immediately); only fall
// back to cache when offline/network fails. This trades a little offline
// "freshness" for never getting stuck on stale app code again — the
// failure mode that just bit us is worse than losing pure cache-first
// speed.
//
// CACHE_VERSION: bump this string (v1 → v2 → v3...) any time you want to
// force every visiting client to fully discard old cached files. You
// normally DON'T need to bump it for routine deploys — network-first
// already picks up new files on every online visit; VERSION exists for
// the rare "something is stuck, nuke it" case.
// ═══════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'chaman-ai-v3-cache-1'; // bumped: v3 file layout (consolidated app.css/app.js) — discards any stale v2 cached js/css files

// Core shell — cached on install so the app has *something* to show
// offline even on a first-ever offline visit. Everything else gets
// cached opportunistically as it's fetched (see fetch handler below).
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((err) => console.warn('[sw] core cache failed:', err))
  );
  self.skipWaiting(); // don't wait for old tabs to close — take over ASAP
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION) // wipe every cache from any older version (including the old leftover sw's cache, whatever it was named)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim()) // control already-open tabs immediately, don't wait for a reload
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept POST (e.g. /api/chat) — API calls always go straight to network

  event.respondWith(
    fetch(request)
      .then((res) => {
        // Opportunistically cache successful same-origin responses for
        // offline fallback later. Don't cache API routes (/api/*) — those
        // must always be live.
        const url = new URL(request.url);
        if (res.ok && url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
  );
});
