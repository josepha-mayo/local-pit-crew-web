// The static build prepends an allowlist and release checksum.
const prefix = 'local-pit-crew-offline:';
const cacheName = prefix + offlineBuild.version;
const immutable = new Set(offlineBuild.immutable);
const publicFiles = new Set(offlineBuild.publicFiles);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...immutable, ...publicFiles].map(path =>
      new Request(path, {cache: 'reload', redirect: 'error'})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function saved(path) {
  return caches.match(new URL(path, self.location.origin).href, {cacheName, ignoreVary: true});
}

async function preferNetwork(request, path) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await saved(path);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const {request} = event;
  const {origin, pathname, search} = new URL(request.url);
  if (request.method !== 'GET' || origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (pathname === '/' || pathname === '/index.html')) {
    event.respondWith(preferNetwork(request, '/index.html'));
  } else if (!search && immutable.has(pathname)) {
    event.respondWith(saved(pathname).then(response => response ?? fetch(request)));
  } else if (!search && publicFiles.has(pathname)) {
    event.respondWith(preferNetwork(request, pathname));
  }
});
