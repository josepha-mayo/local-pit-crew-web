// The static build prepends an allowlist and release checksum.
const prefix = 'local-pit-crew-offline:';
const cacheName = prefix + offlineBuild.version;
const immutable = new Set(offlineBuild.immutable);
const publicFiles = new Set(offlineBuild.publicFiles);

async function verifyFile(path, response) {
  if (!response?.ok) throw Error('Offline file could not be fetched.');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== offlineBuild.digests[path]) throw Error('Offline file differs from the deployed release.');
}

async function prepareFiles() {
  const requestFor = path => new Request(path, {cache: 'reload', redirect: 'error'});
  try {
    const cache = await caches.open(cacheName);
    const assets = [...immutable, ...publicFiles].filter(path => path !== '/index.html');
    await cache.addAll(assets.map(requestFor));
    const page = await fetch(requestFor('/index.html'));
    await Promise.all([
      verifyFile('/index.html', page.clone()),
      ...assets.map(async path => verifyFile(path, await cache.match(path, {ignoreVary: true}))),
    ]);
    // A saved page means the verifier and every other file passed validation.
    await cache.put('/index.html', page);
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(prepareFiles());
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
