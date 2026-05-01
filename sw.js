// BhaiVault Service Worker
// Version control — change this to force update
const CACHE_NAME = 'bhaivault-v1';

// Files to cache for offline use
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ===== INSTALL =====
// Cache all essential files when SW installs
self.addEventListener('install', event => {
  console.log('[BhaiVault SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[BhaiVault SW] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // Force activate immediately without waiting
      return self.skipWaiting();
    })
  );
});

// ===== ACTIVATE =====
// Clean up old caches when new SW activates
self.addEventListener('activate', event => {
  console.log('[BhaiVault SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[BhaiVault SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// ===== FETCH =====
// Network first for Firebase (always fresh data)
// Cache first for static assets (fast load)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase requests — always go to network (live data chahiye)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Firebase offline — return empty response gracefully
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Static assets — Cache First strategy
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Return from cache, but also update cache in background
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse; // Return cache immediately
      }

      // Not in cache — fetch from network and cache it
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      }).catch(() => {
        // Completely offline and not cached
        // Return the main index.html as fallback
        return caches.match('/index.html');
      });
    })
  );
});

// ===== BACKGROUND SYNC =====
// Jab internet aaye tab pending operations sync karo
self.addEventListener('sync', event => {
  if (event.tag === 'bhaivault-sync') {
    console.log('[BhaiVault SW] Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Future: sync any queued operations when back online
  console.log('[BhaiVault SW] Syncing data...');
}

// ===== PUSH NOTIFICATIONS =====
// Future use: nominee recovery alerts ke liye
self.addEventListener('push', event => {
  let data = { title: 'BhaiVault', body: 'Koi update hai!' };
  if (event.data) {
    try { data = event.data.json(); } catch(e) {}
  }

  const options = {
    body: data.body || 'BhaiVault notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data,
    actions: [
      { action: 'open', title: '🔐 App Kholo' },
      { action: 'dismiss', title: 'Baad mein' }
    ],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'BhaiVault 🔐', options)
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Agar app already open hai to focus karo
      for (const client of clientList) {
        if (client.url.includes('bhaivault') && 'focus' in client) {
          return client.focus();
        }
      }
      // Nahi to naya window kholo
      if (clients.openWindow) {
        return clients.openWindow('/index.html');
      }
    })
  );
});

// ===== MESSAGE HANDLER =====
// Main app se messages receive karo
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_UPDATE') {
    // Force update cache
    caches.open(CACHE_NAME).then(cache => {
      cache.addAll(ASSETS_TO_CACHE);
    });
  }
});

console.log('[BhaiVault SW] Service Worker loaded ✅');
