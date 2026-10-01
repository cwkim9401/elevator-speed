/* Keep HTML and its calculation engine in the same versioned offline bundle. */
const CACHE_PREFIX = 'elevspeed-';
const CACHE = `${CACHE_PREFIX}v37`;
const APP_SHELL = './index.html';
const ASSETS = [APP_SHELL, './measurement.js', './ride-core.js', './ride.js', './sound-worklet.js', './esv-header.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload'}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if(url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const navigation = event.request.mode === 'navigate';
  const isAppPage = url.pathname === scope.pathname || url.pathname === new URL(APP_SHELL,scope).pathname;
  if(navigation && !isAppPage) return;
  const key = navigation ? APP_SHELL : ASSETS.find(path => new URL(path,scope).pathname === url.pathname);
  if(!key) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key);
    if(cached) return cached;
    // A failed network response must never overwrite a working cached application.
    return fetch(event.request);
  }));
});
