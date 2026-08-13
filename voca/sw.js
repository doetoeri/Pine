"use strict";

const CACHE_NAME = "meaning-link-worksheet-v3";
const FONT_ASSETS = [
  ...Array.from({ length: 120 }, (_, index) => `./fonts/files/noto-sans-kr-${index}-wght-normal.woff2`),
  "./fonts/files/noto-sans-kr-cyrillic-wght-normal.woff2",
  "./fonts/files/noto-sans-kr-latin-ext-wght-normal.woff2",
  "./fonts/files/noto-sans-kr-latin-wght-normal.woff2",
  "./fonts/files/noto-sans-kr-vietnamese-wght-normal.woff2"
];
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./fonts/noto-sans-kr.css",
  "./app.js",
  "./manifest.webmanifest",
  "./sample-words.tsv",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/xlsx.full.min.js",
  ...FONT_ASSETS
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === "opaque") return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") return caches.match("./index.html");
          return new Response("오프라인에서 이 파일을 찾지 못했습니다.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        });
    })
  );
});
