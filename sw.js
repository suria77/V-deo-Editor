// Lumière · funcionamiento sin conexión.
// Los archivos propios: primero la red (así siempre tienes la última versión) y, si no hay red o Cloudflare falla, la copia guardada.
// Tipografías y modelo de subtítulos (otros dominios): se guardan al usarlos la primera vez.
const CACHE = 'lumiere-v13';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css?v=23', 'js/main.js?v=23', 'icon-64.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const EXT = /(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|huggingface\.co|hf\.co|cdn-lfs)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || req.headers.has('range')) return;
  const same = url.origin === location.origin;
  if (!same && !EXT.test(url.hostname)) return;
  if (same) {
    e.respondWith(fetch(req).then((r) => {
      if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: false }).then((m) => m || caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
  } else {
    e.respondWith(caches.match(req).then((m) => {
      const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; }).catch(() => m);
      return m || net;
    }));
  }
});
