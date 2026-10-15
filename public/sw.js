/* Service worker (template). The build (vite.config.ts) replaces the two placeholders below:
   the cache version changes whenever any file of the app changes, so an old cache is never served forever. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = 'stargate-' + VERSION;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' }))));   // bypass the HTTP cache
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('stargate-') && k !== CACHE) await caches.delete(k);   // drop old versions
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // never touch other origins
  if (req.mode === 'navigate') {
    // network first so a new deployment is picked up immediately; the cached shell is the offline fallback
    event.respondWith(fetch(req).catch(async () => (await caches.open(CACHE)).match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  event.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
