const PINCON_SW_VERSION = "20260902-account-api2";
const PINCON_SHELL_CACHE = `pincon-shell-${PINCON_SW_VERSION}-offline3`;
const PINCON_OLD_CACHE_PREFIXES = ["workbox-precache", "pincon-shell-"];

const PINCON_NEXT_SHELL = [
  "./next/index.html",
  "./next/app.css",
  "./next/ui-polish.css",
  "./next/rail-containment.css",
  "./next/mobile-clearance.css",
  "./next/dialog-polish.css",
  "./next/interaction-system.css",
  "./next/detail-viewport-stability.css",
  "./next/evaluation-plan-preview.css",
  "./next/student-account.css",
  "./next/account-center.css",
  "./next/student-ops.css",
  "./next/first-login-onboarding.css",
  "./next/today-changes.css",
  "./next/reveal-loader.js",
  "./next/first-login-onboarding.js",
  "./next/app-bootstrap.js",
  "./next/simple-account-gate.js",
  "./next/readonly-notice.js",
  "./next/route-focus-stability.js",
  "./next/personal-notification-filter.js",
  "./next/app.js",
  "./next/app-interactions.js",
  "./next/detail-history-stability.js",
  "./next/evaluation-plan-preview.js",
  "./next/today-changes.js",
  "./next/write-mode.js",
  "./next/admin-visibility.js",
  "./next/account-center.js",
  "./next/student-ops.js",
  "./next/dialog-focus-stability.js",
  "./next/ui-regression-fixes.js",
  "./next/core/data-gateway.js",
  "./next/core/degraded-readonly.js",
  "./next/core/evaluation-plan-media.js",
  "./next/core/notification-store.js",
  "./next/core/recovery-pack.js",
  "./next/core/brand-settings.js",
  "./next/core/trust-model.js",
  "./next/core/today-changes.js",
  "./next/core/today-open-write.js",
  "./next/core/student-auth.js",
  "./next/assets/pincon-icon.svg"
];

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
  "./pincon-ui-stability.css",
  "./pincon-classic-return.css",
  "./pincon-interaction-polish.css",
  "./material-official-loader.js",
  "./material-web.bundle.js",
  "./pincon-material-audit.js",
  "./pincon-material-button-fallback.js",
  "./pincon-adoption-core.js",
  "./pincon-adoption-flow-v2.js",
  "./pincon-ocr-capture.js",
  "./pincon-quick-add-ocr-entry.js",
  "./pincon-live-prep.js",
  "./pincon-class-ops-core.js",
  "./pincon-class-ops-data.js",
  "./pincon-class-ops.js",
  "./pincon-ui-stability.js",
  "./pincon-classic-return.js",
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
  "./icons/app-icon.svg",
  ...PINCON_NEXT_SHELL
];

try {
  importScripts("./firebase-messaging-sw.js?v=20260825-android-notify2");
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

async function networkFirst(request, fallbackKey = null, { forceReload = false } = {}) {
  const cache = await caches.open(PINCON_SHELL_CACHE);
  try {
    // GitHub Pages and the browser HTTP cache can briefly keep an older JS module
    // under the same URL after a deploy. Code/config assets must be revalidated so
    // an old API endpoint cannot survive after the service worker itself updates.
    const networkRequest = forceReload ? new Request(request, { cache: "reload" }) : request;
    const response = await fetch(networkRequest);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (fallbackKey) await cache.put(fallbackKey, response.clone());
    }
    return response;
  } catch (error) {
    const direct = await cache.match(request, { ignoreSearch: false });
    if (direct) return direct;
    // Install-time precache keys intentionally omit cache-busting query strings,
    // while production HTML loads modules as app.js?v=... . Match the same path
    // ignoring only the query so those precached modules actually work offline.
    const versionless = await cache.match(request, { ignoreSearch: true });
    if (versionless) return versionless;
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
    const nextNavigation = url.origin === self.location.origin
      && (url.pathname === "/next" || url.pathname.startsWith("/next/"));
    if (nextNavigation) {
      event.respondWith(networkFirst(request, "./next/index.html", { forceReload: true }));
    } else {
      event.respondWith(networkFirst(request, "./index.html", { forceReload: true }));
    }
    return;
  }

  if (url.origin !== self.location.origin) return;

  const isStatic = /\.(?:js|css|html|webmanifest|json|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname);
  if (!isStatic) return;

  const mustRevalidate = /\.(?:js|css|html|webmanifest|json)$/i.test(url.pathname);
  event.respondWith(networkFirst(request, null, { forceReload: mustRevalidate }));
});
