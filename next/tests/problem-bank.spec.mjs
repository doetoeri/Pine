import { test, expect } from "@playwright/test";

test("classroom renders published problems with filters and answer reveal", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
  });

  await page.goto("http://127.0.0.1:4173/next/#classroom", { waitUntil: "domcontentloaded" });
  const panel = page.locator("#problemBankPanel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator(".problem-card")).toHaveCount(3);

  const first = panel.locator(".problem-card").first();
  await expect(first.locator(".problem-card__answer")).not.toHaveAttribute("open", "");
  await first.locator("summary").click();
  await expect(first.locator(".problem-card__answer")).toHaveAttribute("open", "");

  // Material Web text fields are custom elements. Playwright CSS locators pierce
  // their open shadow root, so type into the real native input rather than the host.
  const searchInput = panel.locator("#problemBankSearch").locator("input");
  await searchInput.fill("산화");
  await expect(panel.locator(".problem-card")).toHaveCount(1);
  await expect(panel).toContainText("산화 환원");

  expect(errors).toEqual([]);
});
