// BhaiVault Service Worker — Vercel Optimized
// Version badlo toh purana cache delete hoga automatically
const VERSION = 'bhaivault-v3';

// Sirf ye files cache hongi — baaki sab network se
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Ye domains kabhi cache nahi honge — seedha network
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',  // Firebase Auth
  'securetoken.googleapis.com',       // Firebase Auth tokens
  'googleapis.com',
  'gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'vercel.live',      // Vercel preview comments
  'vercel-insights',  // Vercel analytics
];

// ═══════════════════════════════════════
// INSTALL — static files cache karo
// ═══════════════════════════════════════
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', VERSION);
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => {
        console.log('[SW] Caching static assets');
        // individual fail hone pe poora install na toote
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Cache miss for:', url, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Install done — skipping wait');
        return self.skipWaiting(); // Turant activate ho
      })
  );
});

// ═══════════════════════════════════════
// ACTIVATE — purane caches saaf karo
// ═══════════════════════════════════════
self.addEventListener('activate', event => {
  console.log('[SW] Activating:', VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== VERSION)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Now controlling all tabs');
        return self.clients.claim(); // Turant control lo
      })
  );
});

// ═══════════════════════════════════════
// FETCH — main interception logic
// ═══════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests — kabhi intercept mat karo
  if (request.method !== 'GET') return;

  // 2. Chrome extension requests — ignore
  if (url.protocol === 'chrome-extension:') return;

  // 3. Firebase / external APIs — NEVER cache, seedha network
  const isExternalApi = NEVER_CACHE.some(domain =>
    url.hostname.includes(domain)
  );
  if (isExternalApi) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'offline', message: 'Network unavailable' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // 4. Same-origin requests (apni files) — Cache First, then Network
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // 5. Baaki sab (CDN fonts, etc.) — Network First
  event.respondWith(networkFirstStrategy(request));
});

// ═══════════════════════════════════════
// STRATEGY: Cache First (static assets)
// ═══════════════════════════════════════
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Background mein update karo (stale-while-revalidate)
    updateCacheInBackground(request);
    return cached;
  }
  // Cache mein nahi — network se lo aur cache karo
  return fetchAndCache(request);
}

// ═══════════════════════════════════════
// STRATEGY: Network First (dynamic)
// ═══════════════════════════════════════
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// ═══════════════════════════════════════
// HELPER: Fetch karo aur cache mein daalo
// ═══════════════════════════════════════
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    // Sirf valid responses cache karo
    if (
      response &&
      response.status === 200 &&
      response.type !== 'opaque'
    ) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Bilkul offline — index.html fallback do (SPA ke liye)
    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;
    return new Response('App offline hai. Internet check karo.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ═══════════════════════════════════════
// HELPER: Background cache update
// ═══════════════════════════════════════
function updateCacheInBackground(request) {
  fetch(request)
    .then(response => {
      if (response && response.status === 200 && response.type !== 'opaque') {
        caches.open(VERSION).then(cache => cache.put(request, response));
      }
    })
    .catch(() => {}); // Background fail — koi baat nahi
}

// ═══════════════════════════════════════
// MESSAGE — main app se commands
// ═══════════════════════════════════════
self.addEventListener('message', event => {
  if (!event.data) return;

  // Force update command
  if (event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Force updating...');
    self.skipWaiting();
  }

  // Cache clear command
  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      console.log('[SW] All caches cleared');
      // App ko batao
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }))
      );
    });
  }
});

// ═══════════════════════════════════════
// PUSH NOTIFICATIONS (future use)
// ═══════════════════════════════════════
self.addEventListener('push', event => {
  let data = { title: 'BhaiVault 🔐', body: 'Koi update hai!' };
  if (event.data) {
    try { data = event.data.json(); } catch(e) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      vibrate: [200, 100, 200],
      requireInteraction: false,
      actions: [
        { action: 'open', title: '🔐 App Kholo' },
        { action: 'dismiss', title: 'Theek hai' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow('/');
      })
  );
});

console.log('[SW] BhaiVault Service Worker loaded ✅ Version:', VERSION);
