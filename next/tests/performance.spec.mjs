import { test, expect } from "@playwright/test";

const ROUTES = [
  ["timetable", "#timetable-title"],
  ["schedule", "#schedule-title"],
  ["classroom", "#classroom-title"],
  ["more", "#more-title"],
  ["today", "#today-title"],
];

test("route selection and visible content settle within 300ms", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  for (const [route, heading] of ROUTES) {
    const control = page.locator(`.rail__nav [data-route="${route}"]`);
    const started = await page.evaluate(() => performance.now());
    await control.click();
    await expect(page.locator(heading)).toBeVisible({ timeout: 300 });
    const elapsed = await page.evaluate((start) => performance.now() - start, started);
    expect(elapsed, `${route} route took ${elapsed.toFixed(1)}ms`).toBeLessThan(300);

    const current = await control.evaluate((host) => {
      const focusable = host.shadowRoot?.querySelector("button, a") || host;
      return focusable.getAttribute("aria-current");
    });
    expect(current).toBe("page");
  }
});
