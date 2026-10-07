import { test, expect } from "@playwright/test";
test("lightweight boot releases immediately to a usable app", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 })));
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#pinconBoot")).toHaveCount(0);
  await expect(page.locator(".pincon-reveal-tile")).toHaveCount(0);
  await expect(page.locator("body")).toHaveClass(/pincon-boot-done/);
});
