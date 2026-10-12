// Zmień numer wersji przy każdej aktualizacji plików, żeby telefon pobrał nową wersję.
const VERSION = 'budzet-v8';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './kasa.mp3',
  './manifest.webmanifest',
  './fonts.css',
  './dm-sans-latin-300-normal.woff2',
  './dm-sans-latin-ext-300-normal.woff2',
  './dm-sans-latin-400-normal.woff2',
  './dm-sans-latin-ext-400-normal.woff2',
  './dm-sans-latin-500-normal.woff2',
  './dm-sans-latin-ext-500-normal.woff2',
  './abril-fatface-latin-400-normal.woff2',
  './abril-fatface-latin-ext-400-normal.woff2',
  './dm-serif-display-latin-400-normal.woff2',
  './dm-serif-display-latin-ext-400-normal.woff2',
  './20.jpg',
  './50.jpg',
  './100.jpg',
  './200.jpg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Najpierw sieć (żeby aktualizacje z GitHuba docierały), a bez internetu – kopia z pamięci.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
