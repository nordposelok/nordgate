// CACHE_NAME, CACHE_PREFIX and ASSETS are injected by build-pwa.mjs.
// Do not skip waiting on install: updates are explicitly applied by the user.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(ASSETS.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CACHE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const index = await cache.match(new URL('index.html', self.registration.scope), { ignoreVary: true });
      event.ports[0]?.postMessage({ ready: Boolean(index) });
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Navigation and gate JSON come from the same completely installed release.
    const cached = request.mode === 'navigate'
      ? await cache.match(new URL('index.html', scope), { ignoreVary: true })
      // These are public, same-origin, release-specific files, never personalized
      // responses. Module requests carry Origin, while precache requests may not.
      // Vite and some CDNs return Vary: Origin; it must not break offline assets.
      : await cache.match(request, { ignoreVary: true });
    return cached ?? fetch(request);
  })());
});
