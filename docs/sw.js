const CACHE_NAME = 'freefinder-v1';
const ASSETS = [
  '/deal-finder/',
  '/deal-finder/index.html',
  '/deal-finder/deals.json',
  '/deal-finder/manifest.json'
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - Network first, fallback to cache
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('deals.json')) {
    // Always try network first for deals
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request))
    );
  }
});
git pull --rebase origin main || true
git push || git push --force-with-lease
