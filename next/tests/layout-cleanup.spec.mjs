import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 280, height: 700 },
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 600, height: 900 },
  { width: 768, height: 1024 },
  { width: 840, height: 900 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 800, height: 360 },
];

const ROUTES = ["today", "timetable", "schedule", "classroom", "more"];

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

test("all main routes remain inside the visual viewport", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);

    for (const route of ROUTES) {
      await page.evaluate((nextRoute) => {
        location.hash = `#${nextRoute}`;
      }, route);
      await settle(page);

      const state = await page.evaluate(() => {
        const viewportWidth = window.innerWidth;
        const rect = (node) => {
          if (!node) return null;
          const value = node.getBoundingClientRect();
          return { left: value.left, right: value.right, width: value.width };
        };
        const visible = (node) => {
          if (!node) return false;
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        };

        const critical = [
          document.querySelector(".topbar"),
          document.querySelector(".content-wrap"),
          document.querySelector(".bottom-nav"),
          ...document.querySelectorAll(".surface"),
        ].filter(visible).map((node) => ({
          selector: node.className || node.tagName,
          rect: rect(node),
        }));

        return {
          viewportWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          critical,
        };
      });

      expect(
        state.documentWidth,
        `${viewport.width}x${viewport.height} #${route} document overflow`,
      ).toBeLessThanOrEqual(state.viewportWidth + 1);
      expect(
        state.bodyWidth,
        `${viewport.width}x${viewport.height} #${route} body overflow`,
      ).toBeLessThanOrEqual(state.viewportWidth + 1);

      for (const item of state.critical) {
        expect(
          item.rect.left,
          `${viewport.width}x${viewport.height} #${route} ${item.selector} left edge`,
        ).toBeGreaterThanOrEqual(-1.5);
        expect(
          item.rect.right,
          `${viewport.width}x${viewport.height} #${route} ${item.selector} right edge`,
        ).toBeLessThanOrEqual(state.viewportWidth + 1.5);
      }
    }
  }
});
