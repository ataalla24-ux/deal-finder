const CACHE_NAME = 'freefinder-v4';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable.svg',
  './og-image.svg',
  './push-config.json'
];

function getCanonicalDataCacheKey(requestUrl) {
  const url = new URL(requestUrl);
  if (url.pathname.endsWith('/deals.json')) {
    return new URL('./deals.json', self.location.href).toString();
  }
  if (url.pathname.endsWith('/deal-of-the-day.json')) {
    return new URL('./deal-of-the-day.json', self.location.href).toString();
  }
  return null;
}

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
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Always fetch live JSON data, but cache it under a stable key so
  // timestamped requests still have an offline fallback on iPhone/PWA.
  const canonicalKey = getCanonicalDataCacheKey(event.request.url);
  if (canonicalKey) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(canonicalKey, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(canonicalKey);
          if (cached) return cached;
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
    return;
  }
  
  // Cache first for other assets
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FreeFinder Wien', body: event.data ? event.data.text() : 'Neuer Deal verfügbar' };
  }

  const title = payload.title || '🎁 FreeFinder Wien';
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
