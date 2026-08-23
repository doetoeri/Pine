import { test, expect } from "@playwright/test";

const ROUTES = [
  ["timetable", "#timetable-title"],
  ["schedule", "#schedule-title"],
  ["classroom", "#classroom-title"],
  ["more", "#more-title"],
  ["today", "#today-title"],
];

async function ariaCurrent(locator) {
  return locator.evaluate((host) => {
    const focusable = host.shadowRoot?.querySelector("button, a") || host;
    return focusable.getAttribute("aria-current");
  });
}

async function armInPageRouteTimer(page, route, heading) {
  await page.evaluate(({ route, heading }) => {
    globalThis.__pinconRouteTimings ||= Object.create(null);
    delete globalThis.__pinconRouteTimings[route];

    const app = document.querySelector("#app");
    if (!app) throw new Error("PinCon app root is missing");

    const onClick = (event) => {
      const host = event.composedPath?.().find(
        (node) => node instanceof HTMLElement && node.getAttribute?.("data-route") === route,
      );
      if (!host) return;

      document.removeEventListener("click", onClick, true);
      const started = performance.now();

      const settle = () => {
        if (!document.querySelector(heading)) return false;
        globalThis.__pinconRouteTimings[route] = performance.now() - started;
        return true;
      };

      if (settle()) return;

      const observer = new MutationObserver(() => {
        if (!settle()) return;
        observer.disconnect();
      });
      observer.observe(app, { childList: true, subtree: true });
    };

    document.addEventListener("click", onClick, true);
  }, { route, heading });
}

test("route selection and visible content settle within 300ms", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  for (const [route, heading] of ROUTES) {
    const control = page.locator(`.rail__nav [data-route="${route}"]`);
    await armInPageRouteTimer(page, route, heading);
    await control.click();
    await expect(page.locator(heading)).toBeVisible({ timeout: 300 });
    await expect.poll(
      () => page.evaluate((routeId) => globalThis.__pinconRouteTimings?.[routeId] ?? null, route),
      { timeout: 300 },
    ).not.toBeNull();

    const elapsed = await page.evaluate((routeId) => globalThis.__pinconRouteTimings[routeId], route);
    expect(elapsed, `${route} route took ${elapsed.toFixed(1)}ms in-page`).toBeLessThan(300);
    await expect.poll(() => ariaCurrent(control)).toBe("page");
  }
});
