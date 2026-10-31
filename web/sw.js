// 離線也能打開：每次先抓網路上的最新版，抓不到才用上次存下來的那份。
const CACHE = 'home-ledger-v6';
const FILES = ['./', 'index.html', 'app.html', 'core.js', 'style.css', 'icon-180.png', 'version.json', 'mushroom.png', 'me.png', 'wife.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 雲端試算表的請求不碰
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
