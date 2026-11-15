import { test, expect } from "@playwright/test";

test("the public root opens school life and preserves the assessment URL", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-startup-enabled-v1", "off");
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: { classAssignments: [
      { id: "root-assessment", classKey: "1-8", type: "assessment", title: "수학 발표", subject: "수학", dueDate: "2026-11-17", published: true },
    ] } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.clock.setFixedTime(new Date("2026-11-14T00:00:00Z"));

  await page.goto("http://127.0.0.1:4173/?entry=root", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("PinCon · 학교생활");
  await expect(page.getByRole("heading", { name: "오늘의 학교생활" })).toBeVisible();
  await page.locator(".pc-cover[data-current=true]").press("Enter");
  await expect(page.getByRole("link", { name: /수학 발표/ })).toHaveAttribute("href", "./new/?assignment=root-assessment");
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "학교생활" }).getByRole("link", { name: "수행평가" }).click();
  await page.waitForURL(url => url.pathname === "/new/", { timeout: 5_000, waitUntil: "domcontentloaded" });
  await expect(page.locator('.pc-cover[data-current="true"]')).toHaveAttribute("data-assessment-id", "root-assessment");
  await expect(page.getByRole("button", { name: "달력 보기", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("PinCon · 수행평가");
});
