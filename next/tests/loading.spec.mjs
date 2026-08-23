import { test, expect } from "@playwright/test";

test("boot uses the supplied randomized reveal shapes and fully yields to the app", async ({ page }) => {
  const response = await page.request.get("http://127.0.0.1:4173/next/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('id="pinconBootField"');
  expect(html).toContain('src="./reveal-loader.js"');
  expect(html).not.toContain("<md-linear-progress");
  expect(html).toContain('aria-label="PinCon 불러오는 중"');

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

  await expect.poll(
    () => page.locator(".pincon-reveal-tile").count(),
    { timeout: 5_000 },
  ).toBeGreaterThan(8);

  const sourceCount = await page.locator('.pincon-reveal-tile img[src="./assets/loader-drop.svg"]').count();
  expect(sourceCount).toBeGreaterThan(8);
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });

  await expect.poll(
    () => page.evaluate(() => document.querySelector("#pinconBoot") === null),
    { timeout: 7_000 },
  ).toBe(true);
  await expect.poll(
    () => page.evaluate(() => document.body.classList.contains("pincon-boot-done")),
    { timeout: 1_000 },
  ).toBe(true);
  expect(await page.locator(".pincon-reveal-tile").count()).toBe(0);
});
