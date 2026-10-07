const CACHE = 'helpfultool-1cde7b249ab3';
const FILES = ['index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // L'app è un solo file: ogni apertura di pagina riceve index.html dalla copia locale (scaricato una volta).
  const req = e.request.mode === 'navigate' ? 'index.html' : e.request;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
