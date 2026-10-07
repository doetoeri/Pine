import { test, expect } from "@playwright/test";
test("a slow external icon stylesheet cannot hold the usable shell", async ({ page }) => {
  let releaseStylesheet;
  const pendingStylesheet = new Promise((resolve) => { releaseStylesheet = resolve; });
  await page.addInitScript(() => localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 })));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    await pendingStylesheet;
    await route.fulfill({ contentType: "text/css", body: "" });
  });
  try {
    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded", timeout: 3000 });
    await expect(page.locator("#today-title")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#pinconBoot")).toHaveCount(0);
    await page.locator('.nav-control[data-route="timetable"]:visible').click();
    await expect(page.locator("#timetable-title")).toBeVisible();
  } finally {
    releaseStylesheet();
  }
});
test("lightweight boot releases immediately to a usable app", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 })));
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#pinconBoot")).toHaveCount(0);
  await expect(page.locator(".pincon-reveal-tile")).toHaveCount(0);
  await expect(page.locator("body")).toHaveClass(/pincon-boot-done/);
});
