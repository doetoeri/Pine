import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1024 },
  { width: 821, height: 1024 },
  { width: 1024, height: 768 },
];

async function ariaCurrent(locator) {
  return locator.evaluate((control) => {
    const focusable = control.shadowRoot?.querySelector("button, a") || control;
    return focusable.getAttribute("aria-current");
  });
}

for (const viewport of VIEWPORTS) {
  test(`responsive shell ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    });

    await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#today-title")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);

    if (viewport.width < 600) {
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await expect(page.locator(".rail")).toBeHidden();

      const dockGeometry = await page.evaluate(() => {
        const dock = document.querySelector(".bottom-nav")?.getBoundingClientRect();
        if (!dock) return null;
        return {
          left: dock.left,
          right: dock.right,
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
    } else {
      await expect(page.locator(".rail")).toBeVisible();
      await expect(page.locator(".bottom-nav")).toBeHidden();

      const railClearance = await page.evaluate(() => {
        const rail = document.querySelector(".rail")?.getBoundingClientRect();
        const frame = document.querySelector(".app-frame")?.getBoundingClientRect();
        if (!rail || !frame) return -1;
        return frame.left - rail.right;
      });
      expect(railClearance).toBeGreaterThanOrEqual(8);

      if (viewport.width < 840) {
        const iconGeometry = await page.evaluate(() => {
          const rail = document.querySelector(".rail")?.getBoundingClientRect();
          if (!rail) return [];
          return [...document.querySelectorAll(".rail__nav [data-route]")].map((control) => {
            const host = control.getBoundingClientRect();
            const icon = control.querySelector("md-icon")?.getBoundingClientRect();
            return {
              railLeft: rail.left,
              railRight: rail.right,
              hostLeft: host.left,
              hostRight: host.right,
              iconLeft: icon?.left ?? -1,
              iconRight: icon?.right ?? -1,
            };
          });
        });
        expect(iconGeometry).toHaveLength(5);
        for (const item of iconGeometry) {
          expect(item.hostLeft).toBeGreaterThanOrEqual(item.railLeft + 4);
          expect(item.hostRight).toBeLessThanOrEqual(item.railRight - 4);
          expect(item.iconLeft).toBeGreaterThanOrEqual(item.railLeft + 4);
          expect(item.iconRight).toBeLessThanOrEqual(item.railRight - 4);
        }
      }
    }

    const timetableButton = page.locator('[data-route="timetable"]').nth(viewport.width < 600 ? 1 : 0);
    await timetableButton.click();
    await expect(page.locator("#timetable-title")).toBeVisible();
    await expect(page.locator("#today-title")).toHaveCount(0);
    await expect.poll(() => ariaCurrent(timetableButton)).toBe("page");

    await page.locator("#openSearch").click();
    await expect(page.locator("#searchDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchDialog")).toBeHidden();

    if (viewport.width < 600) {
      const moreButton = page.locator('[data-route="more"]').nth(1);
      await moreButton.click();
      await expect(page.locator("#more-title")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clearance = await page.evaluate(() => {
        const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
        const surfaces = [...document.querySelectorAll("#mainContent .surface")];
        const last = surfaces.at(-1)?.getBoundingClientRect();
        if (!nav || !last) return 0;
        return nav.top - last.bottom;
      });
      expect(clearance).toBeGreaterThanOrEqual(8);
    }

    await context.close();
  });
}