// sw.js — cache do app shell para uso offline
const CACHE = 'finapp-v3';
const SHELL = [
  './', './index.html', './css/styles.css', './manifest.json',
  './js/app.js', './js/store.js', './js/github.js', './js/util.js',
  './js/parsers.js', './js/charts.js',
  './js/views/dashboard.js', './js/views/transactions.js', './js/views/invoice.js',
  './js/views/investments.js', './js/views/reports.js', './js/views/settings.js',
  './data/data.sample.json', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === 'https://api.github.com') return; // sync sempre online
  if (e.request.method !== 'GET') return;
  // stale-while-revalidate para o shell e CDNs
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res.clone();
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
