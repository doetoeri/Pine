import { test, expect } from "@playwright/test";

test("boot uses frameless overlapping reveal shapes and fully yields to the app", async ({ page }) => {
  const response = await page.request.get("http://127.0.0.1:4173/next/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('id="pinconBootField"');
  expect(html).toContain('src="./reveal-loader.js?v=20260830-loader2"');
  expect(html).not.toContain("<md-linear-progress");
  expect(html).toContain('aria-label="PinCon 불러오는 중"');

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });

  await expect.poll(
    () => page.locator(".pincon-reveal-tile").count(),
    { timeout: 5_000 },
  ).toBeGreaterThan(20);

  await expect.poll(async () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".pincon-reveal-tile")];
    const visible = tiles.filter((node) => node.classList.contains("is-visible"));
    return tiles.length ? visible.length / tiles.length : 0;
  }), { timeout: 5_000 }).toBeGreaterThan(0.85);

  const visual = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".pincon-reveal-tile.is-visible")];
    const rects = tiles.map((node) => node.getBoundingClientRect());
    const first = tiles[0];
    const firstImage = first?.querySelector("img");
    const tileStyle = first ? getComputedStyle(first) : null;
    const imageStyle = firstImage ? getComputedStyle(firstImage) : null;
    let covered = 0;
    let samples = 0;
    for (let y = 24; y < innerHeight; y += 72) {
      for (let x = 24; x < innerWidth; x += 72) {
        samples += 1;
        if (rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) covered += 1;
      }
    }
    return {
      tileWidth: rects[0]?.width || 0,
      tileBackground: tileStyle?.backgroundColor || "",
      tileBorderTop: tileStyle?.borderTopWidth || "",
      tileShadow: tileStyle?.boxShadow || "",
      imageBackground: imageStyle?.backgroundColor || "",
      imageBorderTop: imageStyle?.borderTopWidth || "",
      coverage: samples ? covered / samples : 0,
    };
  });

  expect(visual.tileWidth).toBeGreaterThan(380);
  expect(visual.tileBackground).toBe("rgba(0, 0, 0, 0)");
  expect(visual.imageBackground).toBe("rgba(0, 0, 0, 0)");
  expect(visual.tileBorderTop).toBe("0px");
  expect(visual.imageBorderTop).toBe("0px");
  expect(visual.tileShadow).toBe("none");
  expect(visual.coverage).toBeGreaterThan(0.98);

  const sourceCount = await page.locator('.pincon-reveal-tile img[src="./assets/loader-drop.svg"]').count();
  expect(sourceCount).toBeGreaterThan(20);
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
