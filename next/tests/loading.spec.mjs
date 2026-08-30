import { test, expect } from "@playwright/test";

test("boot uses calm masked gradient leaves and fully yields to the app", async ({ page }) => {
  const response = await page.request.get("http://127.0.0.1:4173/next/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('id="pinconBootField"');
  expect(html).toMatch(/src="\.\/reveal-loader\.js\?v=20260830-loader\d+"/);
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
  ).toBeGreaterThan(8);

  await expect.poll(async () => page.evaluate(() => {
    const field = document.querySelector("#pinconBootField");
    return field ? Number.parseFloat(getComputedStyle(field).opacity || "0") : 0;
  }), { timeout: 5_000 }).toBeGreaterThan(0.85);

  const visual = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".pincon-reveal-tile")];
    const rects = tiles.map((node) => node.getBoundingClientRect());
    const first = tiles[0];
    const tileStyle = first ? getComputedStyle(first) : null;
    const fieldStyle = getComputedStyle(document.querySelector("#pinconBootField"));
    return {
      tileWidth: rects[0]?.width || 0,
      allInside: rects.every((rect) => rect.left >= -2 && rect.top >= -2 && rect.right <= innerWidth + 2 && rect.bottom <= innerHeight + 2),
      bootBackground: getComputedStyle(document.querySelector("#pinconBoot")).backgroundImage,
      fieldOpacity: Number.parseFloat(fieldStyle.opacity || "0"),
      tileBackgroundImage: tileStyle?.backgroundImage || "",
      tileBorderTop: tileStyle?.borderTopWidth || "",
      tileShadow: tileStyle?.boxShadow || "",
      tileMask: tileStyle?.maskImage || tileStyle?.webkitMaskImage || "",
      animationName: tileStyle?.animationName || "",
      imageCount: first?.querySelectorAll("img").length || 0,
    };
  });

  expect(visual.tileWidth).toBeGreaterThan(60);
  expect(visual.tileWidth).toBeLessThan(110);
  expect(visual.allInside).toBe(true);
  expect(visual.bootBackground).not.toBe("none");
  expect(visual.fieldOpacity).toBeGreaterThan(0.85);
  expect(visual.tileBackgroundImage).toContain("linear-gradient");
  expect(visual.tileMask).toContain("loader-drop.svg");
  expect(visual.tileBorderTop).toBe("0px");
  expect(visual.tileShadow).toBe("none");
  expect(visual.animationName).toContain("pincon-leaf-gradient");
  expect(visual.imageCount).toBe(0);

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
