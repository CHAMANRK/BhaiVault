const CACHE = 'seekhcode-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './data/cards.json',
  './data/html.json',
  './data/css.json',
  './data/js.json',
  './data/py.json',
  './data/mix.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Never cache the Pyodide CDN or external API calls — always go to network
  if (e.request.url.includes('cdn.jsdelivr.net') || e.request.url.includes('api.groq.com')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
