import { test, expect } from "@playwright/test";

test("problem cards open an interactive quiz and filters combine", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:4173/next/#classroom", { waitUntil: "domcontentloaded" });
  const panel = page.locator("#problemBankPanel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator(".problem-card")).toHaveCount(3);
  await expect(panel).toContainText("예시 문제");

  const first = panel.locator(".problem-card").first();
  await first.click();
  await expect(page.locator("#detailLayer")).toBeVisible();
  await expect(page.locator("#detailSurface")).toHaveAttribute("data-mode", "side");
  await expect(page.locator("#detailTitle")).toContainText("서로 다른 3개의 연필");
  await expect(page.locator(".quiz-choices label")).toHaveCount(4);

  await page.locator('[data-problem-choice="1"]').click();
  await page.locator("[data-problem-submit]").click();
  await expect(page.locator(".quiz-result")).toContainText("정답입니다");
  await expect(page.locator(".quiz-result")).toContainText("해설");

  await page.locator("[data-problem-retry]").click();
  await expect(page.locator(".quiz-result")).toHaveCount(0);
  const submit = page.locator("[data-problem-submit]");
  await expect(submit).toHaveAttribute("disabled", "");
  await expect.poll(() => submit.evaluate((host) => (
    host.disabled === true || host.shadowRoot?.querySelector("button")?.disabled === true
  ))).toBe(true);

  await page.goBack();
  await expect(page.locator("#detailLayer")).toBeHidden();

  const searchInput = panel.locator("#problemBankSearch").locator("input");
  await searchInput.fill("산화");
  await panel.locator("#problemBankSubject").evaluate((host) => {
    host.value = "통합과학";
    host.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });
  await expect(panel.locator(".problem-card")).toHaveCount(1);
  await expect(panel).toContainText("산화 환원");

  await panel.locator("#problemBankDifficulty").evaluate((host) => {
    host.value = "easy";
    host.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });
  await expect(panel.locator(".problem-card")).toHaveCount(0);
  await expect(panel).toContainText("조건에 맞는 문제가 없습니다");

  expect(errors).toEqual([]);
});
