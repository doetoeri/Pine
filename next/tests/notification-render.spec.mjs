import { test, expect } from "@playwright/test";

test("notification trigger renders the canonical inbox once", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  await page.evaluate(() => {
    const target = document.querySelector("#notificationContent");
    globalThis.__pinconNotificationMutations = 0;
    const observer = new MutationObserver((records) => {
      globalThis.__pinconNotificationMutations += records.filter(
        (record) => record.type === "childList" && record.target === target,
      ).length;
    });
    observer.observe(target, { childList: true });
    globalThis.__pinconNotificationObserver = observer;
  });

  await page.locator("#openNotifications").click();
  await expect(page.locator("#notificationDialog")).toBeVisible();
  await page.waitForTimeout(50);

  const mutations = await page.evaluate(() => globalThis.__pinconNotificationMutations);
  expect(mutations).toBe(1);

  await page.evaluate(() => globalThis.__pinconNotificationObserver?.disconnect());
});
