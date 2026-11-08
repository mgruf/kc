// Sparar själva sidan i telefonen så att KC öppnas direkt. Data hämtas alltid färskt av app.js.
const V = 'kc-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'quotes.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;            // Apps Script och väder går alltid direkt
  e.respondWith(
    caches.open(V).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;                               // visa sparat direkt, uppdatera i bakgrunden
    })
  );
});
