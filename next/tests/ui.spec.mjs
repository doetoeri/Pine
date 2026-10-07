import { test, expect } from "@playwright/test";
for (const viewport of [{ width: 280, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`responsive workspace ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 })));
    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#today-title")).toBeVisible();
    const nav = viewport.width >= 1200 ? ".rail__nav" : ".bottom-nav";
    await expect(page.locator(nav)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator(`${nav} [data-route="timetable"]`).click();
    await expect(page.locator("#timetable-title")).toBeVisible();
    await expect(page.locator(`${nav} [data-route="timetable"]`)).toHaveAttribute("aria-current", "page");
    await page.locator("#openSearch").click();
    await expect(page.locator("#searchDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchDialog")).toBeHidden();
    await page.locator(`${nav} [data-route="more"]`).click();
    await expect(page.locator("#more-title")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (viewport.width < 1200) {
      expect(await page.evaluate(() => {
        const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
        const last = [...document.querySelectorAll("#mainContent .surface")].at(-1)?.getBoundingClientRect();
        return last ? nav.top - last.bottom : 16;
      })).toBeGreaterThanOrEqual(8);
    }
  });
}
test("theme switches and persists without an effect panel", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 })));
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#pinconThemeToggle")).toBeVisible();
  await page.locator("#pinconThemeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "dark");
  await expect(page.locator("#pinconEffectsPanel")).toHaveCount(0);
});
