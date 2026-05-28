const CACHE_NAME = 'freefinder-website-v3';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable.svg',
  './og-preview.png',
  './assets/current-ios/deals-home.jpg',
  './assets/current-ios/for-you.jpg',
  './assets/current-ios/stats-plus.jpg',
  './assets/current-ios/pro-sheet.jpg',
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
  const requestUrl = new URL(event.request.url);
  const isDealsJson = requestUrl.pathname.endsWith('/deals.json') || requestUrl.pathname.endsWith('deals.json');
  const isDealOfDayJson = requestUrl.pathname.endsWith('/deal-of-the-day.json') || requestUrl.pathname.endsWith('deal-of-the-day.json');
  const isDealOfWeekJson = requestUrl.pathname.endsWith('/deal-of-the-week.json') || requestUrl.pathname.endsWith('deal-of-the-week.json');
  const isNetworkFirstDocument =
    event.request.mode === 'navigate' ||
    requestUrl.pathname.endsWith('/deal-finder/') ||
    requestUrl.pathname.endsWith('/index.html') ||
    requestUrl.pathname.endsWith('push-config.json');

  async function networkFirst() {
    try {
      const response = await fetch(event.request);
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then(cache => {
        cache.put(event.request, responseClone);
      });
      return response;
    } catch {
      return caches.match(event.request);
    }
  }

  if (isDealsJson || isDealOfDayJson || isDealOfWeekJson || isNetworkFirstDocument) {
    event.respondWith(networkFirst());
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
