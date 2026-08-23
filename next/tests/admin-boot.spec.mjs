import { test, expect } from "@playwright/test";

test("admin beta renders its access gate without a page-level error", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/admin/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admin-loading-title")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 5_000 });
  expect(pageErrors).toEqual([]);
});
