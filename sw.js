const PINCON_SW_VERSION = "20260822-unified1";
const PINCON_SHELL_CACHE = `pincon-shell-${PINCON_SW_VERSION}`;
const PINCON_OLD_CACHE_PREFIXES = ["workbox-precache", "pincon-shell-"];

const PINCON_APP_SHELL = [
  "./index.html",
  "./registerSW.js",
  "./manifest.webmanifest",
  "./theme-green.css",
  "./material-official-layout.css",
  "./pincon-design-systems.css",
  "./pincon-adoption-core.css",
  "./pincon-adoption-flow-v2.css",
  "./pincon-quick-add-ocr-entry.css",
  "./pincon-live-prep.css",
  "./pincon-class-ops.css",
  "./pincon-print-center.css",
  "./pincon-expressive-all.css",
  "./pincon-controls.css",
  "./pincon-unified-shell.css",
  "./material-official-loader.js",
  "./material-web.bundle.js",
  "./pincon-material-audit.js",
  "./pincon-material-button-fallback.js",
  "./pincon-material-expressive-25.js",
  "./pincon-adoption-core.js",
  "./pincon-adoption-flow-v2.js",
  "./pincon-ocr-capture.js",
  "./pincon-quick-add-ocr-entry.js",
  "./pincon-live-prep.js",
  "./pincon-class-ops-core.js",
  "./pincon-class-ops-data.js",
  "./pincon-class-ops.js",
  "./pincon-print-center.js",
  "./pincon-guest-auth.js",
  "./pincon-google-auth-bridge.js",
  "./pincon-auth-diagnostics.js",
  "./touch-stability.js",
  "./timetable-source-hotfix.js",
  "./pincon-material-collab.js",
  "./pincon-material-workspace.js",
  "./pincon-analytics.js",
  "./firebase-config.js",
  "./assets/index-Sg4pPAB0.js",
  "./assets/index-C7Rqpf69.css",
  "./assets/firebase-IW9tbrMW.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/app-icon.svg"
];

try {
  importScripts("./firebase-messaging-sw.js?v=20260821-pwa-buttons3");
} catch (error) {
  console.warn("[PinCon SW] Firebase messaging worker could not be loaded", error);
}

async function cacheFresh(cache, url) {
  try {
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (response && response.ok) await cache.put(url, response.clone());
  } catch {}
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PINCON_SHELL_CACHE);
    await Promise.allSettled(PINCON_APP_SHELL.map((url) => cacheFresh(cache, url)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      const staleWorkbox = name.startsWith("workbox-precache");
      const stalePinconShell = name.startsWith("pincon-shell-") && name !== PINCON_SHELL_CACHE;
      return staleWorkbox || stalePinconShell ? caches.delete(name) : Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackKey = null) {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (fallbackKey) await cache.put(fallbackKey, response.clone());
    }
    return response;
  } catch (error) {
    const direct = await cache.match(request, { ignoreSearch: false });
    if (direct) return direct;
    if (fallbackKey) {
      const fallback = await cache.match(fallbackKey, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const isStatic = /\.(?:js|css|html|webmanifest|json|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(networkFirst(request));
});
