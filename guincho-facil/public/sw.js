// Service worker do GF: abre offline a casca do app e do site.
// Dados (Supabase) nunca são guardados em cache.
const CACHE = 'gf-v9';
const SHELL = ['/', '/app', '/privacidade', '/style.css', '/tokens.css', '/app.js', '/lib.js', '/cidades.js', '/config.js',
  '/manifest.webmanifest', '/assets/gf-mark.png', '/icons/icon-192.png', '/icons/icon-512.png', '/offline.html'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // páginas: rede primeiro, cache como reserva
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('/offline.html'))));
    return;
  }
  // arquivos estáticos: rede primeiro para receber atualizações, cache se estiver sem sinal
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })
    .catch(() => caches.match(req)));
});
