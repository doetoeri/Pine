import { test, expect } from "@playwright/test";

test("PinCon Next boots without a page-level JavaScript error", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#today-title")).toBeVisible({ timeout: 5_000 });
  await expect.poll(
    () => page.evaluate(() => document.body.classList.contains("pincon-boot-done")),
    { timeout: 5_000 },
  ).toBe(true);

  expect(pageErrors).toEqual([]);
});
