const CACHE_NAME = 'freefinder-website-v8';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './consent.css',
  './consent.js',
  './offline.html',
  './blog/blog.css',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable.svg',
  './push-config.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('freefinder-website-') && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  const versionedAsset = /\.(?:css|js|png|jpg|jpeg|avif|webp|svg)$/.test(requestUrl.pathname) &&
    [...requestUrl.searchParams.keys()].every(key => key === 'v');
  const cacheKey = versionedAsset ? requestUrl.origin + requestUrl.pathname : event.request;
  // Leave writes, third-party tracking and payment-return data out of the cache.
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin ||
      (requestUrl.search && !versionedAsset) || /(?:^|\/)(?:admin|checkout|live-review)/.test(requestUrl.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(cacheKey, response.clone());
        } catch { /* A full cache must not turn a successful request into an error. */ }
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const offline = await cache.match(new URL('./offline.html', self.registration.scope).href);
        if (offline) return offline;
      }
      return new Response('Derzeit offline. Bitte erneut versuchen.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FreeFinder', body: event.data ? event.data.text() : 'Neuer Deal verfügbar' };
  }

  const title = payload.title || '🎁 FreeFinder';
  const options = {
    body: payload.body || 'Neue Deals warten auf dich',
    icon: payload.icon || './icon-192.svg',
    badge: payload.badge || './icon-192.svg',
    tag: payload.tag || 'freefinder-deals',
    renotify: true,
    data: {
      url: payload.url || './'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});
