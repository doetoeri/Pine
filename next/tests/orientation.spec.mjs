import { test, expect } from "@playwright/test";

const LANDSCAPE_PHONES = [
  { width: 800, height: 360 },
  { width: 932, height: 430 },
];

for (const viewport of LANDSCAPE_PHONES) {
  test(`phone landscape keeps bottom floating dock ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    });

    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#today-title")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.locator(".topbar .brand")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const dock = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      const frame = document.querySelector(".app-frame")?.getBoundingClientRect();
      if (!dock || !frame) return null;
      return {
        dockLeft: dock.left,
        dockRight: dock.right,
        dockBottom: dock.bottom,
        frameLeft: frame.left,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.dockLeft).toBeGreaterThanOrEqual(8);
    expect(geometry.dockRight).toBeLessThanOrEqual(geometry.viewportWidth - 8);
    expect(geometry.dockBottom).toBeLessThanOrEqual(geometry.viewportHeight - 6);
    expect(Math.abs(geometry.frameLeft)).toBeLessThanOrEqual(1);

    await context.close();
  });
}
