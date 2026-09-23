const CACHE_NAME = 'partysync-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Network first fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
