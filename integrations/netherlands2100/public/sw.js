// Narrow scope isolates climate from PinCon root caches. No imagery precaching.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// No fetch handler: provider HTTP caching remains authoritative.
