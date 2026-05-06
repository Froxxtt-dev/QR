/* Service Worker for QR Link - enables offline support and caching */

const CACHE_VERSION = 'qr-link-v2';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/qr-generator.js',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap',
  'https://fonts.gstatic.com/s/dmsans/v17/rP2Wp2ywxg089UriCZaSExdy3sGt9zz86GPwyKK58VXh.woff2',
  'https://fonts.gstatic.com/s/dmsans/v17/rP2Wp2ywxg089UriCZaSExdy3sGt9zz86GPwyKy58Q.woff2',
  'https://fonts.gstatic.com/s/dmsans/v17/rP2Hp2ywxg089UriCZ2IHSeH.woff2',
  'https://fonts.gstatic.com/s/dmsans/v17/rP2Hp2ywxg089UriCZOIHQ.woff2'
];

// Install event - cache assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      // Cache HTML, CSS, JS
      return cache.addAll(CACHE_URLS).catch(function() {
        // Gracefully handle cache errors
        console.log('Cache install failed - offline support limited');
      });
    }).catch(function(err) {
      console.log('Service Worker install error:', err);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_VERSION) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') {
    return;
  }

  if ((event.request.url.includes('cdn.') && !CACHE_URLS.includes(event.request.url)) || 
      event.request.url.includes('cloudflare.com') ||
      (event.request.url.includes('googleapis.com') && !CACHE_URLS.includes(event.request.url)) ||
      (event.request.url.includes('gstatic.com') && !CACHE_URLS.includes(event.request.url))) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) {
        return response;
      }

      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Clone the response before caching
        var responseToCache = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(function() {
        // Return cached version if network fails
        return caches.match(event.request);
      });
    })
  );
});

// Handle messages from clients
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
