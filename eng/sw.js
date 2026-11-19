
const VERSION = "munjang-note-1c14ed2e4e537a5a";
const FILES = ["assets/index-DZfJpsPA.js","assets/index-a-zlpiYA.css","assets/pdf-DJgdJZPm.js","fonts/NotoSansKR-study.ttf","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable.png","index.html","manifest.webmanifest"];
const urls = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
const entry = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([...urls])));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('munjang-note-') && key !== VERSION)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate' && (url.href === self.registration.scope || url.href === entry)) {
    event.respondWith(fetch(request).catch(() => caches.open(VERSION).then(cache => cache.match(entry))));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.open(VERSION).then(cache => cache.match(request).then(hit => hit || fetch(request))));
  }
});
