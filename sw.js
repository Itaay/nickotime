// Offline: app files served from cache and refreshed in the background (bump V on release), map tiles cached as you view them.
const V = 'nickotime-v5';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'model.js', 'store.js', 'i18n.js', 'streets.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'];
const TILES = 'tiles';
const MAX_TILES = 3000;

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())));

let puts = 0;
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) {
        c.put(e.request, res.clone());
        if (++puts % 100 === 0) c.keys().then(ks => ks.slice(0, Math.max(0, ks.length - MAX_TILES)).forEach(k => c.delete(k)));
      }
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // stale-while-revalidate: instant offline start, and a fix reaches the phone on the next open
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
