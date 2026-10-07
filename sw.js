const PINCON_SW_VERSION = "20261007-light1";
const PINCON_SHELL_CACHE = `pincon-shell-${PINCON_SW_VERSION}`;
const PINCON_APP_SHELL = [
  "./index.html", "./next/index.html", "./next/app.css", "./next/app-bootstrap.js",
  "./next/app.js", "./next/app-interactions.js", "./next/reveal-loader.js", "./next/theme.js",
  "./next/simple-account-gate.js", "./next/loading-resilience.js",
  "./next/core/data-gateway.js", "./next/core/region-renderer.js",
  "./next/core/degraded-readonly.js", "./next/core/student-auth.js",
  "./next/core/brand-settings.js", "./next/core/trust-model.js", "./next/core/today-open-write.js",
  "./next/core/notification-store.js", "./next/core/recovery-pack.js",
  "./next/student-account.css", "./next/assets/pincon-icon.svg",
  "./material-official-loader.js", "./material-web.bundle.js",
  "./pincon-class-ops-core.js", "./pincon-class-ops-data.js", "./pincon-guest-auth.js",
  "./firebase-config.js", "./manifest.webmanifest"
];
try { importScripts("./firebase-messaging-sw.js?v=20260914-experiment1"); }
catch (error) { console.warn("[PinCon SW] messaging unavailable", error); }

async function fetchAndCache(request, cache) {
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PINCON_SHELL_CACHE);
    // Limit parallel downloads so installation does not compete with the live app.
    for (let i = 0; i < PINCON_APP_SHELL.length; i += 4) {
      await Promise.allSettled(PINCON_APP_SHELL.slice(i, i + 4).map((url) => fetchAndCache(new Request(new URL(url, self.location.href)), cache)));
    }
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("workbox-precache") || (name.startsWith("pincon-shell-") && name !== PINCON_SHELL_CACHE)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, event) {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  const url = new URL(request.url);
  const indexUrl = new URL(url.href);
  if (indexUrl.pathname.endsWith("/")) indexUrl.pathname += "index.html";
  else if (indexUrl.pathname.endsWith("/next")) indexUrl.pathname += "/index.html";
  const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true }) || await cache.match(indexUrl.href, { ignoreSearch: true });
  const network = fetchAndCache(new Request(request, { cache: "no-cache" }), cache);
  event.waitUntil(network.catch(() => {}));
  if (!cached) return network;
  let timer;
  try {
    return await Promise.race([network.catch(() => cached), new Promise((resolve) => { timer = setTimeout(() => resolve(cached), 1800); })]);
  } finally { clearTimeout(timer); }
}
async function cachedAsset(request, event) {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Versioned URLs cannot change; unversioned imports revalidate in the background.
    if (!new URL(request.url).searchParams.has("v")) event.waitUntil(fetchAndCache(request, cache).catch(() => {}));
    return cached;
  }
  try { return await fetchAndCache(request, cache); }
  catch (error) {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    throw error;
  }
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" || /firebase-config\.js$|\.(?:json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request, event)); return;
  }
  if (/\.(?:js|css|html|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cachedAsset(request, event));
  }
});
