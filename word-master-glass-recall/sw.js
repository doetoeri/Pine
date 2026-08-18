/* WORD MASTER Glass Recall offline shell */
var CACHE_NAME = "wmgr-shell-v8-persistent-test-canvas";
var SHELL = [
  "./",
  "./index.html",
  "./hotfix.js?v=20260817-ocr4",
  "./handwriting-study.js?v=20260817-ink2",
  "./handwriting-test-reuse-v2.js?v=20260818-persist1",
  "./ocr-canvas-bridge.js?v=20260818-reuse1",
  "./assets/index-DN91RMlF.js",
  "./assets/index-CPEeSJ0i.css",
  "./legacy.html",
  "./legacy/legacy.css",
  "./legacy/app.js",
  "./legacy/wordData.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
    }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE_NAME ? null : caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.indexOf("/api/ocr") !== -1) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok && url.origin === self.location.origin) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match(new URL("./index.html", self.registration.scope).href);
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
