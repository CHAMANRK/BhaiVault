/* ============================================================
   firebase-messaging-sw.js
   WorkTrack PWA — Service Worker
   Handles: FCM Push Notifications + Offline Cache
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ── Firebase Init ──
firebase.initializeApp({
  apiKey:            "AIzaSyDXPi8I8U-kZzHTjyKz6mMVvYXS5iyJiA8",
  authDomain:        "attendance-3f53f.firebaseapp.com",
  projectId:         "attendance-3f53f",
  storageBucket:     "attendance-3f53f.firebasestorage.app",
  messagingSenderId: "216445422563",
  appId:             "1:216445422563:web:b7b7aadf09a1b92d16aed6"
});

const messaging = firebase.messaging();

// ── Cache Config ──
const CACHE_NAME    = 'worktrack-v1';
const OFFLINE_URL   = '/Raza_Art/index.html';
const CACHE_ASSETS  = [
  '/Raza_Art/',
  '/Raza_Art/index.html',
  '/Raza_Art/owner.html',
  '/Raza_Art/staff.html',
  '/Raza_Art/style.css',
  '/Raza_Art/app.js',
  '/Raza_Art/notifications.js',
  '/Raza_Art/manifest.json',
  '/Raza_Art/icon-192.png',
  '/Raza_Art/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Nunito:wght@400;500;600;700&display=swap'
];

// ── Notification Icons by Type ──
const NOTIF_CONFIG = {
  checkin_reminder : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#00d4ff' },
  late_warning     : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#ff8c00' },
  work_pressure    : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#ff4466' },
  holiday          : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#a855f7' },
  leave_update     : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#00ff88' },
  broadcast        : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#ffd700' },
  default          : { icon: '/Raza_Art/icon-192.png', badge: '/Raza_Art/icon-192.png', color: '#00d4ff' }
};

// ════════════════════════════════════════════
//  INSTALL — Cache all assets
// ════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW] Installing WorkTrack Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app assets');
      // Cache one by one — don't fail all if one is missing
      return Promise.allSettled(
        CACHE_ASSETS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Could not cache:', url, err.message);
        }))
      );
    }).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// ════════════════════════════════════════════
//  ACTIVATE — Clean old caches
// ════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating WorkTrack Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activation complete');
      return self.clients.claim(); // Take control of all pages
    })
  );
});

// ════════════════════════════════════════════
//  FETCH — Network first, fallback to cache
// ════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  // Skip non-GET and cross-origin requests (Firebase, APIs)
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const isOwnOrigin = url.startsWith(self.location.origin);
  const isFonts = url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com');
  if (!isOwnOrigin && !isFonts) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache a fresh copy
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed → serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, serve offline page
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ════════════════════════════════════════════
//  FCM — Background Message Handler
//  (when app is closed or in background)
// ════════════════════════════════════════════
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  const data    = payload.data || {};
  const notif   = payload.notification || {};
  const type    = data.type || 'default';
  const cfg     = NOTIF_CONFIG[type] || NOTIF_CONFIG.default;

  const title   = notif.title || data.title || 'WorkTrack';
  const body    = notif.body  || data.body  || 'You have a new notification';
  const clickUrl = data.url   || '/staff.html';

  const options = {
    body,
    icon      : cfg.icon,
    badge     : cfg.badge,
    tag       : `worktrack-${type}-${Date.now()}`,
    renotify  : true,
    requireInteraction: type === 'work_pressure' || type === 'broadcast',
    vibrate   : getVibrationPattern(type),
    data      : { url: clickUrl, type },
    actions   : getActions(type),
    silent    : false,
  };

  return self.registration.showNotification(title, options);
});

// ════════════════════════════════════════════
//  PUSH event — fallback if FCM compat misses
// ════════════════════════════════════════════
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch { payload = { notification: { title: 'WorkTrack', body: event.data.text() } }; }

  const data    = payload.data || {};
  const notif   = payload.notification || {};
  const type    = data.type || 'default';
  const cfg     = NOTIF_CONFIG[type] || NOTIF_CONFIG.default;

  const title   = notif.title || data.title || 'WorkTrack';
  const body    = notif.body  || data.body  || 'New update';

  const options = {
    body,
    icon    : cfg.icon,
    badge   : cfg.badge,
    tag     : `worktrack-${type}`,
    renotify: true,
    vibrate : getVibrationPattern(type),
    data    : { url: data.url || '/staff.html', type },
    actions : getActions(type),
    requireInteraction: type === 'work_pressure' || type === 'broadcast',
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ════════════════════════════════════════════
//  NOTIFICATION CLICK
// ════════════════════════════════════════════
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action  = event.action;
  const data    = event.notification.data || {};
  let targetUrl = data.url || '/staff.html';

  // Handle action buttons
  if (action === 'checkin')   targetUrl = '/Raza_Art/staff.html?action=checkin';
  if (action === 'view')      targetUrl = data.url || '/staff.html';
  if (action === 'dismiss')   return; // Just close

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', action, data });
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ════════════════════════════════════════════
//  NOTIFICATION CLOSE (dismissed by user)
// ════════════════════════════════════════════
self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  console.log('[SW] Notification dismissed, type:', data.type);
  // Can log dismissals to analytics if needed
});

// ════════════════════════════════════════════
//  MESSAGE from main thread
//  e.g. app sends: { type: 'SKIP_WAITING' }
// ════════════════════════════════════════════
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_UPDATE':
      // Force re-cache specific URL
      caches.open(CACHE_NAME).then(cache => {
        cache.add(event.data.url);
      });
      break;

    case 'LOCAL_NOTIFICATION':
      // Main thread asks SW to show a local notification
      // Used for check-in reminders scheduled via the app
      showLocalNotification(event.data.payload);
      break;
  }
});

// ════════════════════════════════════════════
//  SYNC — Background sync when network returns
// ════════════════════════════════════════════
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'attendance-sync') {
    event.waitUntil(syncPendingAttendance());
  }
});

async function syncPendingAttendance() {
  // Notify all open clients to flush pending attendance
  const clientList = await clients.matchAll({ type: 'window' });
  for (const client of clientList) {
    client.postMessage({ type: 'SYNC_ATTENDANCE' });
  }
}

// ════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════

function getVibrationPattern(type) {
  switch (type) {
    case 'work_pressure':  return [300, 100, 300, 100, 300]; // Aggressive
    case 'late_warning':   return [200, 100, 200];            // Double buzz
    case 'checkin_reminder': return [150, 50, 150];           // Double light
    case 'broadcast':      return [400, 100, 400];            // Strong
    default:               return [200];                      // Single
  }
}

function getActions(type) {
  switch (type) {
    case 'checkin_reminder':
    case 'late_warning':
      return [
        { action: 'checkin', title: '✅ Check In Now' },
        { action: 'dismiss', title: '✕ Dismiss' }
      ];
    case 'leave_update':
      return [
        { action: 'view', title: '👁 View Status' },
        { action: 'dismiss', title: '✕ Dismiss' }
      ];
    case 'work_pressure':
    case 'broadcast':
      return [
        { action: 'view', title: '📢 Open App' },
        { action: 'dismiss', title: '✕ OK' }
      ];
    default:
      return [
        { action: 'view', title: '👁 Open' }
      ];
  }
}

function showLocalNotification(payload) {
  if (!payload) return;
  const type = payload.type || 'default';
  const cfg  = NOTIF_CONFIG[type] || NOTIF_CONFIG.default;
  return self.registration.showNotification(payload.title || 'WorkTrack', {
    body    : payload.body || '',
    icon    : cfg.icon,
    badge   : cfg.badge,
    tag     : `local-${type}-${Date.now()}`,
    renotify: true,
    vibrate : getVibrationPattern(type),
    data    : { url: payload.url || '/staff.html', type },
    actions : getActions(type),
  });
}

console.log('[SW] WorkTrack Service Worker loaded ✓');
