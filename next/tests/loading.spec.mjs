import { test, expect } from "@playwright/test";

test("boot uses the official Material Web progress indicator", async ({ page }) => {
  const response = await page.request.get("http://127.0.0.1:4173/next/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain("<md-linear-progress");
  expect(html).toContain("four-color");
  expect(html).toContain("indeterminate");
  expect(html).toContain('aria-label="PinCon 불러오는 중"');
  expect(html).not.toContain("app-interactions.css");
  expect(html).not.toContain("ui-polish.js");

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect.poll(
    () => page.evaluate(() => Boolean(customElements.get("md-linear-progress"))),
    { timeout: 5_000 },
  ).toBe(true);
  const materialStatus = await page.evaluate(() => globalThis.PINCON_MATERIAL_STATUS || null);
  expect(materialStatus).not.toBeNull();
  expect(materialStatus.missing || []).not.toContain("md-linear-progress");
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });
  await expect.poll(
    () => page.evaluate(() => document.body.classList.contains("pincon-boot-done")),
    { timeout: 5_000 },
  ).toBe(true);
});
