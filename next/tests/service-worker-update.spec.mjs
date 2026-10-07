import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

test("a new worker caches the deployed release despite a fresh browser HTTP cache", async ({ page }) => {
  const worker = await readFile(new URL("../../sw.js", import.meta.url), "utf8");
  let release = "old-code";
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Cache-Control", "max-age=86400");
    if (path === "/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(worker);
    } else if (path === "/firebase-messaging-sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end("");
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Cache update fixture</title>");
    } else {
      response.setHeader("Content-Type", "text/javascript");
      response.end(release);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(origin);
    expect(await page.evaluate(async () => (await fetch("/next/app.js")).text())).toBe("old-code");
    release = "deployed-code";
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const cachedCode = () => page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((name) => name.startsWith("pincon-shell-"));
      return (await (await caches.open(cacheName)).match("/next/app.js"))?.text();
    });
    await expect.poll(cachedCode).toBe("deployed-code");

    release = "updated-import";
    expect(await page.evaluate(async () => (await fetch("/next/app.js")).text())).toBe("deployed-code");
    await expect.poll(cachedCode).toBe("updated-import");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
