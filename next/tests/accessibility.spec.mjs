import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1024, height: 768 } });

async function actualAriaLabel(locator) {
  return locator.evaluate((host) => {
    const focusable = host.shadowRoot?.querySelector("button, a, input, textarea, select, [tabindex]") || host;
    return focusable.getAttribute("aria-label") || host.getAttribute("aria-label") || host.getAttribute("data-aria-label") || "";
  });
}

async function actualHasFocus(locator) {
  return locator.evaluate((host) => {
    if (document.activeElement === host) return true;
    const active = host.shadowRoot?.activeElement;
    return Boolean(active);
  });
}

async function fieldHasFocus(page, selector) {
  return page.evaluate((targetSelector) => {
    const host = document.querySelector(targetSelector);
    if (!host) return false;
    if (document.activeElement === host) return true;
    return Boolean(host.shadowRoot?.activeElement);
  }, selector);
}

async function tabToControl(page, locator, maxTabs = 24) {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await actualHasFocus(locator)) return;
  }
  throw new Error(`Tab 키로 목표 컨트롤에 도달하지 못했습니다: ${await locator.evaluate((node) => node.id || node.getAttribute("data-route") || node.tagName)}`);
}

async function openByKeyboard(page, locator) {
  await tabToControl(page, locator);
  await expect.poll(() => actualHasFocus(locator)).toBe(true);
  await page.keyboard.press("Enter");
}

function cssTimeToSeconds(value) {
  const first = String(value || "0s").split(",", 1)[0].trim();
  if (first.endsWith("ms")) return Number.parseFloat(first) / 1000;
  if (first.endsWith("s")) return Number.parseFloat(first);
  return Number.POSITIVE_INFINITY;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });
  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell")).toBeVisible();
});

test("document and landmarks expose stable Korean semantics", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("main#mainContent")).toHaveCount(1);
  await expect(page.locator('nav[aria-label="주요 메뉴"]')).toHaveCount(2);

  const search = page.locator("#openSearch");
  const notifications = page.locator("#openNotifications");
  await expect.poll(() => actualAriaLabel(search)).toBe("통합 검색");
  await expect.poll(() => actualAriaLabel(notifications)).toMatch(/^알림함/);

  await expect(page.locator("#searchDialog")).toHaveAttribute("data-aria-label", "통합 검색");
  await expect(page.locator("#notificationDialog")).toHaveAttribute("data-aria-label", "알림함");
  await expect(page.locator('#searchDialog [slot="headline"]')).toHaveText("통합 검색");
  await expect(page.locator('#notificationDialog [slot="headline"]')).toHaveText("알림함");
});

test("search dialog opens from real Tab keyboard navigation, moves task focus, and returns it on Escape", async ({ page }) => {
  const trigger = page.locator("#openSearch");
  await openByKeyboard(page, trigger);

  await expect(page.locator("#searchDialog")).toBeVisible();
  await expect.poll(() => fieldHasFocus(page, "#searchField")).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator("#searchDialog")).toBeHidden();
  await expect.poll(() => actualHasFocus(trigger)).toBe(true);
});

test("notification dialog opens from real Tab keyboard navigation and returns focus to its trigger", async ({ page }) => {
  const trigger = page.locator("#openNotifications");
  await openByKeyboard(page, trigger);

  await expect(page.locator("#notificationDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationDialog")).toBeHidden();
  await expect.poll(() => actualHasFocus(trigger)).toBe(true);
});

test("route changes from real Tab keyboard navigation move programmatic focus to main content", async ({ page }) => {
  const timetable = page.locator('.rail [data-route="timetable"]');
  await tabToControl(page, timetable);
  await expect.poll(() => actualHasFocus(timetable)).toBe(true);
  await page.keyboard.press("Enter");

  await expect(page.locator("#timetable-title")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("mainContent");
});

test("reduced motion preference collapses transition and animation duration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  const result = await page.evaluate(() => {
    const view = document.querySelector(".view-enter");
    const style = view ? getComputedStyle(view) : null;
    return {
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationDuration: style?.animationDuration || "0s",
      transitionDuration: style?.transitionDuration || "0s",
    };
  });

  expect(result.reduced).toBe(true);
  expect(cssTimeToSeconds(result.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(cssTimeToSeconds(result.transitionDuration)).toBeLessThanOrEqual(0.001);
});
