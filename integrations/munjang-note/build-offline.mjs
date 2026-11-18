import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== 'sw.js' && !entry.name.endsWith('.txt'))
  .map((entry) => entry.parentPath.replace(/^dist\/?/, '') + '/' + entry.name)
  .map((path) => path.replace(/^\//, ''))
  .sort();
const signature = createHash('sha256');
for (const file of files) signature.update(await readFile('dist/' + file));
const version = 'munjang-note-' + signature.digest('hex').slice(0, 16);

await writeFile('dist/sw.js', `
const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files)};
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
`);
