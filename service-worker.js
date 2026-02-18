// frontend-user/service-worker.js

const CACHE_NAME = 'medexam-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/pages/welcome.html',
  '/pages/login.html',
  '/pages/signup.html',
  '/pages/subjects.html',
  '/pages/subject-specific.html',
  '/pages/subscription.html',
  '/pages/payment.html',
  '/pages/free-trial.html',
  '/pages/exam-settings.html',
  '/pages/exam-room.html',
  '/pages/results.html',
  '/pages/performance.html',
  '/pages/profile.html',
  '/pages/locked.html',
  '/pages/forgot-password.html',
  '/pages/offline.html', 
  '/pages/shared-exam.html', 
  '/pages/privacy.html',
  '/pages/terms.html',         // ← added
  '/css/common.css',
  '/css/index.css',
  '/css/welcome.css',
  '/css/login.css',
  '/css/signup.css',
  '/css/subjects.css',
  '/css/subject-specific.css',
  '/css/subscription.css',
  '/css/payment.css',
  '/css/free-trial.css',
  '/css/exam-settings.css',
  '/css/exam-room.css',
  '/css/results.css',
  '/css/performance.css',
  '/css/profile.css',
  '/css/locked.css',
  '/css/forgot-password.css',
  '/scripts/utils.js',
  '/scripts/ui.js',
  '/scripts/router.js',
  '/scripts/app.js',
  '/scripts/auth.js',
  '/scripts/db.js',
  '/scripts/validation.js',
  '/scripts/security.js',
  '/scripts/subscription.js',
  '/scripts/payment.js',
  '/scripts/questions.js',
  '/scripts/exam-engine.js',
  '/scripts/timer.js',
  '/scripts/sync.js',
  '/scripts/analytics.js',
  '/scripts/offline.js',
  '/manifest.json',
  '/assets/images/logo.png',
];

self.addEventListener('install', event => {
  console.log('[Service Worker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache each asset individually, ignoring failures
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async url => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status} for ${url}`);
            }
            await cache.put(url, response);
            console.log(`[Service Worker] Cached: ${url}`);
          } catch (err) {
            console.warn(`[Service Worker] Failed to cache ${url}:`, err.message);
          }
        })
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[Service Worker] Cached ${results.length - failed} assets, ${failed} failed (ignored).`);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Skip cross-origin
  if (!event.request.url.startsWith(self.location.origin)) return;

  // API requests: network first, fallback to cache (optional)
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache first, fallback to network
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        // Optionally cache new requests
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }))
      .catch(() => {
        // If navigation request fails completely, show offline page
        if (event.request.mode === 'navigation') {
          return caches.match('/pages/offline.html');
        }
      })
  );
});

// Background sync (unchanged)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-exam-results') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(client => client.postMessage({ type: 'SYNC_EXAMS' }))
      )
    );
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});