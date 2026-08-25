import { test, expect } from "@playwright/test";

test("the public root opens the new PinCon app directly", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/next\/#today$/, { timeout: 5_000 });
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveTitle("PinCon Beta");
});
