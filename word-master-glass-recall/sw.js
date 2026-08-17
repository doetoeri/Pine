/* Offline shell. Vocabulary stays in the generated same-origin bundles. */
var CACHE_NAME = "wmgr-shell-v3-lightpen";
var SHELL = [
  "./",
  "./index.html",
  "./hotfix.js?v=20260817-light3",
  "./legacy.html",
  "./legacy/legacy.css",
  "./legacy/app.js",
  "./legacy/wordData.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(SHELL);
  }).catch(function () {}));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      return key === CACHE_NAME ? null : caches.delete(key);
    }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.indexOf("/api/ocr") !== -1) return;

  /* Network first: while online, always prefer the newest Pages deployment. */
  event.respondWith(fetch(request).then(function (response) {
    if (response && response.ok && new URL(request.url).origin === self.location.origin) {
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
  }));
});
