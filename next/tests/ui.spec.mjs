import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 600, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1024 },
  { width: 839, height: 900 },
  { width: 840, height: 900 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function ariaCurrent(locator) {
  return locator.evaluate((control) => {
    const focusable = control.shadowRoot?.querySelector("button, a") || control;
    return focusable.getAttribute("aria-current");
  });
}

for (const viewport of VIEWPORTS) {
  test(`responsive soft shell ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    });

    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#today-title")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".rail")).toBeHidden();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);

    const dockGeometry = await page.evaluate(() => {
      const dock = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      if (!dock) return null;
      return {
        left: dock.left,
        right: dock.right,
        top: dock.top,
        bottom: dock.bottom,
        width: dock.width,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(dockGeometry).not.toBeNull();
    expect(dockGeometry.left).toBeGreaterThanOrEqual(8);
    expect(dockGeometry.right).toBeLessThanOrEqual(dockGeometry.viewportWidth - 8);
    expect(dockGeometry.bottom).toBeLessThanOrEqual(dockGeometry.viewportHeight - 8);
    expect(dockGeometry.width).toBeLessThanOrEqual(488.5);

    const timetableButton = page.locator('.bottom-nav [data-route="timetable"]');
    await timetableButton.click();
    await expect(page.locator("#timetable-title")).toBeVisible();
    await expect(page.locator("#today-title")).toHaveCount(0);
    await expect.poll(() => ariaCurrent(timetableButton)).toBe("page");

    await page.locator("#openSearch").click();
    await expect(page.locator("#searchDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchDialog")).toBeHidden();

    const moreButton = page.locator('.bottom-nav [data-route="more"]');
    await moreButton.click();
    await expect(page.locator("#more-title")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await page.evaluate(() => {
      const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      const visible = [...document.querySelectorAll("#mainContent .surface, #mainContent .pincon-effects-settings")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
        });
      const last = visible.at(-1)?.getBoundingClientRect();
      if (!nav || !last) return 0;
      return nav.top - last.bottom;
    });
    expect(clearance).toBeGreaterThanOrEqual(8);

    await context.close();
  });
}

test("light and dark glass modes persist and keep the dock visible", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    if (!sessionStorage.getItem("pincon-theme-test-initialized")) {
      localStorage.removeItem("pincon-soft-effects-v1");
      sessionStorage.setItem("pincon-theme-test-initialized", "1");
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "light");

  await page.locator("#pinconThemeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "dark");
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#10130f");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "dark");

  await page.locator("#pinconEffectsToggle").click();
  await expect(page.locator("#pinconEffectsPanel")).toBeVisible();
  await page.locator('[data-pincon-theme-choice="light"]').first().click();
  await expect(page.locator("html")).toHaveAttribute("data-pincon-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4f6f2");
});