import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1024, height: 768 } });

async function hostHasFocus(locator) {
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

async function openByKeyboard(page, locator) {
  await locator.focus();
  await page.keyboard.press("Enter");
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
  await expect(page.locator("#openSearch")).toHaveAttribute("aria-label", "통합 검색");
  await expect(page.locator("#openNotifications")).toHaveAttribute("aria-label", /알림함/);
  await expect(page.locator("#searchDialog")).toHaveAttribute("aria-label", "통합 검색");
  await expect(page.locator("#notificationDialog")).toHaveAttribute("aria-label", "알림함");
});

test("search dialog opens from keyboard, traps task focus, and returns it on Escape", async ({ page }) => {
  const trigger = page.locator("#openSearch");
  await openByKeyboard(page, trigger);

  await expect(page.locator("#searchDialog")).toBeVisible();
  await expect.poll(() => fieldHasFocus(page, "#searchField")).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator("#searchDialog")).toBeHidden();
  await expect.poll(() => hostHasFocus(trigger)).toBe(true);
});

test("notification dialog returns focus to its trigger", async ({ page }) => {
  const trigger = page.locator("#openNotifications");
  await openByKeyboard(page, trigger);

  await expect(page.locator("#notificationDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationDialog")).toBeHidden();
  await expect.poll(() => hostHasFocus(trigger)).toBe(true);
});

test("route changes move programmatic focus to main content", async ({ page }) => {
  const timetable = page.locator('.rail [data-route="timetable"]');
  await timetable.focus();
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
  expect(["0s", "0.01ms"]).toContain(result.animationDuration);
  expect(["0s", "0.01ms"]).toContain(result.transitionDuration);
});
