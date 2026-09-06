const PINCON_SW_VERSION = "20260905-resilience2";
const PINCON_SHELL_CACHE = `pincon-shell-${PINCON_SW_VERSION}`;
importScripts("./next/precache-manifest.js");
try { importScripts("./firebase-messaging-sw.js?v=20260825-android-notify2"); } catch {}

self.addEventListener("install", (event) => {
  // Atomic install: never activate a partially downloaded shell.
  event.waitUntil(caches.open(PINCON_SHELL_CACHE).then((cache) => cache.addAll(PINCON_APP_SHELL)));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if ((name.startsWith("pincon-shell-") || name.startsWith("workbox-precache")) && name !== PINCON_SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
async function networkFirst(request, fallback = "") {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new Request(request, { cache: "no-cache", signal: controller.signal }));
    if (!response.ok) throw new Error("network response unavailable");
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request) || (fallback && await cache.match(fallback));
    if (hit) return hit;
    throw error;
  } finally { clearTimeout(timer); }
}
async function cacheFirst(request) {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never cache account API, authenticated data, Firestore or cross-origin traffic.
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("authorization")) return;
  if (request.mode === "navigate") {
    const next = url.pathname === "/next/" || url.pathname === "/next/index.html";
    if (next) event.respondWith(networkFirst(request, "/next/index.html"));
    else if (url.pathname === "/" || url.pathname === "/index.html") event.respondWith(networkFirst(request, "/index.html"));
    return;
  }
  if (/config\.js$|\.webmanifest$|\.json$/.test(url.pathname)) {
    event.respondWith(networkFirst(request)); return;
  }
  const staticAsset = /\.(js|css|svg|png|jpg|webp|ico|woff2?)$/.test(url.pathname);
  if (!staticAsset) return;
  // Shell dependencies are versioned by the service worker's atomic cache. Hashed
  // assets and explicit version URLs remain cache-first; mutable assets revalidate.
  const shellAsset = PINCON_APP_SHELL.some((path) => new URL(path, self.location.origin).href === url.href);
  if (shellAsset || url.searchParams.has("v") || /[-.][a-f0-9]{8,}\./i.test(url.pathname) || /\.(svg|png|jpg|webp|ico|woff2?)$/.test(url.pathname)) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
