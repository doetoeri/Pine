import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1024 },
  { width: 821, height: 1024 },
  { width: 1024, height: 768 },
];

for (const viewport of VIEWPORTS) {
  test(`responsive shell ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    });

    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#today-title")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);

    if (viewport.width < 600) {
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await expect(page.locator(".rail")).toBeHidden();
    } else {
      await expect(page.locator(".rail")).toBeVisible();
      await expect(page.locator(".bottom-nav")).toBeHidden();
    }

    const timetableButton = page.locator('[data-route="timetable"]').nth(viewport.width < 600 ? 1 : 0);
    await timetableButton.click();
    await expect(page.locator("#timetable-title")).toBeVisible();
    await expect(page.locator("#today-title")).toHaveCount(0);
    await expect(timetableButton).toHaveAttribute("aria-current", "page");

    await page.locator("#openSearch").click();
    await expect(page.locator("#searchDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchDialog")).toBeHidden();

    if (viewport.width < 600) {
      const moreButton = page.locator('[data-route="more"]').nth(1);
      await moreButton.click();
      await expect(page.locator("#more-title")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clearance = await page.evaluate(() => {
        const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
        const surfaces = [...document.querySelectorAll("#mainContent .surface")];
        const last = surfaces.at(-1)?.getBoundingClientRect();
        if (!nav || !last) return 0;
        return nav.top - last.bottom;
      });
      expect(clearance).toBeGreaterThanOrEqual(8);
    }

    await context.close();
  });
}
