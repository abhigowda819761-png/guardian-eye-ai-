// GuardianEye AI Mobile App Service Worker
const _CACHE_NAME = 'guardianeye-v1';

self.addEventListener('install', (_event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let network handle dynamic requests, fallback gracefully
  if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
