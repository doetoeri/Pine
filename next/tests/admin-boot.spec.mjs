import { test, expect } from "@playwright/test";

test("non-admin direct access is returned to the student app without exposing admin UI", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/admin/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/next\/#more$/, { timeout: 8_000 });
  await expect(page.locator("#adminMain")).toHaveCount(0);
  await expect(page.locator("[data-managed-editor]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
