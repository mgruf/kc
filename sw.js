// KC: sidan hämtas alltid färsk när nätet finns (så att alla moduler är samma version),
// och sparas så att KC öppnas även utan nät. Data hämtas alltid av appen själv.
const V = 'kc-v11';
const SHELL = ['./', 'index.html', 'quotes.js', 'manifest.webmanifest', 'icons/icon.svg',
  'css/base.css', 'css/views.css', 'css/kalender.css', 'css/produktion.css', 'css/samling.css', 'css/dashboard.css', 'css/uppgifter.css', 'css/manus.css', 'css/mote.css', 'css/vecka.css', 'css/mall.css', 'css/callsheet.css', 'css/plan.css', 'css/plan-app.css', 'plan.html', 'js/plan-engine.js', 'js/plan/app.js', 'js/plan/tidy.js', 'js/dpr-pdf.js', 'js/plan/jspdf.umd.min.js',
  'js/core.js', 'js/ui.js', 'js/main.js', 'js/search.js', 'js/quickparse.js', 'js/recur.js',
  'js/views/idag.js', 'js/views/kalender.js', 'js/views/uppgifter.js', 'js/views/anteckningar.js', 'js/views/personer.js',
  'js/views/projekt.js', 'js/views/produktion.js', 'js/views/samling.js', 'js/views/horisont.js', 'js/views/manus.js', 'js/views/team.js', 'js/views/mote.js', 'js/kopplat.js', 'js/mejl.js', 'js/plan.js', 'js/views/vecka.js', 'js/views/mall.js', 'js/views/callsheet.js', 'js/views/rek.js', 'js/views/plan.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // Apps Script, väder och typsnitt går direkt
  e.respondWith((async () => {
    const c = await caches.open(V);
    try {
      const r = await Promise.race([fetch(e.request, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('långsamt')), 4000))]);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request)) || (await c.match('index.html')) || Response.error();
    }
  })());
});
