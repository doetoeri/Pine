import { test, expect } from "@playwright/test";

test("the public root opens the new PinCon app directly", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pincon-startup-enabled-v1", "off");
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
    localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: { classAssignments: [
      { id: "root-assessment", classKey: "1-8", type: "assessment", title: "수학 발표", subject: "수학", dueDate: "2026-11-13", published: true },
    ] } }));
  });
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());

  await page.goto("http://127.0.0.1:4173/?entry=root", { waitUntil: "domcontentloaded" });
  await page.waitForURL(url => url.pathname === "/new/" && url.searchParams.get("entry") === "root", { timeout: 5_000, waitUntil: "domcontentloaded" });
  await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "root-assessment");
  await expect(page.getByRole("button", { name: "달력 보기", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("PinCon · 수행평가");
});
