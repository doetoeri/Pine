const CACHE='sidedesk-shell-v5';
const CORE=['/sidedesk/','/sidedesk/style.css','/sidedesk/app.js','/sidedesk/manifest.webmanifest','/sidedesk/icon.svg','/firebase-config.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(xs=>Promise.all(xs.filter(x=>x!==CACHE&&x.startsWith('sidedesk-')).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  if(!u.pathname.startsWith('/sidedesk/')&&u.pathname!=='/firebase-config.js')return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/sidedesk/'))));
});