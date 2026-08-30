import { test, expect } from "@playwright/test";

test("boot uses a calm centered brand loader and fully yields to the app", async ({ page }) => {
  const response = await page.request.get("http://127.0.0.1:4173/next/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('id="pinconBootField"');
  expect(html).toContain('src="./reveal-loader.js?v=20260830-loader5"');
  expect(html).not.toContain("<md-linear-progress");
  expect(html).toContain('aria-label="PinCon 불러오는 중"');

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".pincon-loader__content")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".pincon-loader__leaf")).toHaveCount(1);
  await expect(page.locator(".pincon-loader__title")).toHaveText("PinCon");
  await expect(page.locator(".pincon-loader__message")).toHaveText("오늘의 학교 정보를 준비하고 있어요");
  await expect(page.locator(".pincon-reveal-tile")).toHaveCount(0);

  const visual = await page.evaluate(() => {
    const content = document.querySelector(".pincon-loader__content");
    const leaf = document.querySelector(".pincon-loader__leaf");
    const rect = content?.getBoundingClientRect();
    const leafRect = leaf?.getBoundingClientRect();
    return {
      centeredX: rect ? Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) : 999,
      centeredY: rect ? Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2) : 999,
      allInside: rect ? rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight : false,
      leafWidth: leafRect?.width || 0,
      leafAnimation: leaf ? getComputedStyle(leaf).animationName : "",
      bootBackground: getComputedStyle(document.querySelector("#pinconBoot")).backgroundImage,
    };
  });

  expect(visual.centeredX).toBeLessThan(2);
  expect(visual.centeredY).toBeLessThan(2);
  expect(visual.allInside).toBe(true);
  expect(visual.leafWidth).toBeGreaterThan(82);
  expect(visual.leafWidth).toBeLessThan(94);
  expect(visual.leafAnimation).toContain("pincon-loader-gradient");
  expect(visual.bootBackground).not.toBe("none");
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });

  await expect.poll(
    () => page.evaluate(() => document.querySelector("#pinconBoot") === null),
    { timeout: 7_000 },
  ).toBe(true);
  await expect.poll(
    () => page.evaluate(() => document.body.classList.contains("pincon-boot-done")),
    { timeout: 1_000 },
  ).toBe(true);
  expect(await page.locator(".pincon-loader__content").count()).toBe(0);
});
