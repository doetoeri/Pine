import { test, expect } from "@playwright/test";

test("notification trigger renders the canonical inbox once without a nested white surface", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  await page.evaluate(() => {
    globalThis.__pinconNotificationMutations = 0;
    const observer = new MutationObserver((records) => {
      globalThis.__pinconNotificationMutations += records.filter(
        (record) => record.type === "childList"
          && record.target instanceof HTMLElement
          && record.target.id === "notificationContent",
      ).length;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    globalThis.__pinconNotificationObserver = observer;
  });

  await page.locator("#openNotifications").click();
  await expect(page.locator("#notificationDialog")).toBeVisible();
  await page.waitForTimeout(50);

  const mutations = await page.evaluate(() => globalThis.__pinconNotificationMutations);
  expect(mutations).toBe(1);

  await page.evaluate(() => {
    const target = document.querySelector("#notificationContent");
    if (!target) return;
    target.innerHTML = `
      <div class="notification-summary"><span>테스트</span></div>
      <md-list class="notification-list">
        <md-list-item data-read="false"><div slot="headline">테스트 알림</div></md-list-item>
      </md-list>`;
  });

  const list = page.locator("#notificationContent .notification-list");
  await expect(list).toBeVisible();
  const background = await list.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).toBe("rgba(0, 0, 0, 0)");

  const itemRadius = await page.locator("#notificationContent md-list-item").evaluate((node) => getComputedStyle(node).borderRadius);
  expect(Number.parseFloat(itemRadius)).toBeGreaterThanOrEqual(20);

  await page.evaluate(() => globalThis.__pinconNotificationObserver?.disconnect());
});
