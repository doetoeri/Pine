import { test, expect } from "@playwright/test";

const ROUTES = ["오늘", "시간표", "일정", "학급", "더보기"];
const VIEWPORTS = [
  { width: 280, height: 700 },
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 600, height: 900 },
  { width: 768, height: 1024 },
  { width: 839, height: 900 },
  { width: 840, height: 900 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 800, height: 360 },
  { width: 932, height: 430 },
  { width: 1024, height: 500 },
  { width: 1366, height: 500 },
];

function inside(inner, outer, tolerance = 1.5) {
  return inner.left >= outer.left - tolerance
    && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

test("floating navigation never clips or omits route icons and labels", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible({ timeout: 5_000 });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const state = await page.evaluate(() => {
      const bottom = document.querySelector(".bottom-nav");
      const rail = document.querySelector(".rail");
      const bottomVisible = bottom && getComputedStyle(bottom).display !== "none" && bottom.getBoundingClientRect().width > 0;
      const container = bottomVisible ? bottom : rail;
      const nav = bottomVisible ? bottom : rail?.querySelector(".rail__nav");
      if (!container || !nav) return null;
      const containerRect = container.getBoundingClientRect();
      const controls = [...nav.querySelectorAll("[data-route]")].map((control) => {
        const hostRect = control.getBoundingClientRect();
        const icon = control.querySelector("md-icon");
        const iconRect = icon?.getBoundingClientRect();
        const labelNode = [...control.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        );
        const range = document.createRange();
        if (labelNode) range.selectNodeContents(labelNode);
        const labelRect = labelNode ? range.getBoundingClientRect() : null;
        const style = getComputedStyle(control);
        return {
          label: labelNode?.textContent.trim() || "",
          fontSize: Number.parseFloat(style.fontSize || "0"),
          display: style.display,
          visibility: style.visibility,
          opacity: Number.parseFloat(style.opacity || "1"),
          hostRect: { left: hostRect.left, right: hostRect.right, top: hostRect.top, bottom: hostRect.bottom },
          iconRect: iconRect ? { left: iconRect.left, right: iconRect.right, top: iconRect.top, bottom: iconRect.bottom, width: iconRect.width, height: iconRect.height } : null,
          labelRect: labelRect ? { left: labelRect.left, right: labelRect.right, top: labelRect.top, bottom: labelRect.bottom, width: labelRect.width, height: labelRect.height } : null,
        };
      });
      return {
        bottomVisible,
        containerRect: { left: containerRect.left, right: containerRect.right, top: containerRect.top, bottom: containerRect.bottom },
        controls,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

    expect(state, `${viewport.width}x${viewport.height} navigation exists`).not.toBeNull();
    expect(state.controls, `${viewport.width}x${viewport.height} route count`).toHaveLength(5);
    expect(state.controls.map((item) => item.label), `${viewport.width}x${viewport.height} labels`).toEqual(ROUTES);
    expect(state.horizontalOverflow, `${viewport.width}x${viewport.height} page overflow`).toBe(false);

    for (const item of state.controls) {
      expect(item.display, `${viewport.width}x${viewport.height} ${item.label} display`).not.toBe("none");
      expect(item.visibility, `${viewport.width}x${viewport.height} ${item.label} visibility`).toBe("visible");
      expect(item.opacity, `${viewport.width}x${viewport.height} ${item.label} opacity`).toBeGreaterThan(0);
      expect(item.fontSize, `${viewport.width}x${viewport.height} ${item.label} font`).toBeGreaterThanOrEqual(9);
      expect(item.iconRect?.width || 0, `${viewport.width}x${viewport.height} ${item.label} icon width`).toBeGreaterThan(0);
      expect(item.iconRect?.height || 0, `${viewport.width}x${viewport.height} ${item.label} icon height`).toBeGreaterThan(0);
      expect(item.labelRect?.width || 0, `${viewport.width}x${viewport.height} ${item.label} label width`).toBeGreaterThan(0);
      expect(item.labelRect?.height || 0, `${viewport.width}x${viewport.height} ${item.label} label height`).toBeGreaterThan(0);
      expect(inside(item.hostRect, state.containerRect), `${viewport.width}x${viewport.height} ${item.label} host clipped`).toBe(true);
      expect(inside(item.iconRect, item.hostRect), `${viewport.width}x${viewport.height} ${item.label} icon clipped`).toBe(true);
      expect(inside(item.labelRect, item.hostRect), `${viewport.width}x${viewport.height} ${item.label} label clipped`).toBe(true);
    }
  }
});
