import { test, expect } from "@playwright/test";

test("notification trigger renders one canonical inbox without a nested white surface", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/#today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#today-title")).toBeVisible();

  await page.locator("#openNotifications").click();
  await expect(page.locator("#notificationDialog")).toBeVisible();

  const content = page.locator("#notificationContent");
  await expect.poll(async () => content.evaluate((node) => node.childElementCount), {
    message: "notificationContent should contain the canonical inbox",
  }).toBeGreaterThan(0);

  const canonicalState = await content.evaluate((node) => ({
    summaries: node.querySelectorAll(":scope > .notification-summary").length,
    lists: node.querySelectorAll(":scope > .notification-list").length,
    emptyStates: node.querySelectorAll(":scope > .empty").length,
    nestedSurfaces: node.querySelectorAll(".surface").length,
    childCount: node.childElementCount,
  }));

  expect(canonicalState.summaries).toBeLessThanOrEqual(1);
  expect(canonicalState.lists).toBeLessThanOrEqual(1);
  expect(canonicalState.emptyStates).toBeLessThanOrEqual(1);
  expect(canonicalState.nestedSurfaces).toBe(0);
  expect(canonicalState.childCount).toBeLessThanOrEqual(2);
  expect(canonicalState.lists + canonicalState.emptyStates).toBe(1);

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
});
