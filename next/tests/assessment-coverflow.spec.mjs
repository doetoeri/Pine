import { test, expect } from "@playwright/test";

test.use({ reducedMotion: "reduce" });
for (const width of [360, 768, 1440]) {
  test(`assessment covers select, open details and retain selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(() => {
      localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade: 1, classNumber: 8 }));
      localStorage.setItem("pincon-class-ops-cache-v1", JSON.stringify({ classKey: "1-8", savedAtMs: Date.now(), data: {
        classAssignments: Array.from({ length: 16 }, (_, i) => ({ id: `cover-${i}`, classKey: "1-8", type: "assessment", subject: "공영", title: `영어 수행평가 ${i}`, dueDate: "2099-11-13", published: true, verificationStatus: "verified", description: "실제 상세 내용" })),
        evaluationPlans: [], events: [], resources: [], lostItems: [],
      } }));
    });
    await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
    await page.goto("http://127.0.0.1:4173/new/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".rail, .app-frame, .topbar")).toHaveCount(0);
    const scene = page.locator(".pc-scene");
    await expect(scene).toBeVisible();
    await expect(page.locator(".pc-cover")).toHaveCount(16);
    await scene.press("ArrowRight");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-1");
    await expect(page.locator(".pc-caption-title")).toHaveText("영어 수행평가 1");
    await page.locator('.pc-cover[aria-pressed="true"]').click();
    await expect(page.locator("#detail-title")).toHaveText("영어 수행평가 1");
    await expect(page.locator("#details")).toContainText("실제 상세 내용");
    await page.locator('#details [data-close]').first().click();
    await expect(page.locator("#details")).toBeHidden();
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-1");
    await scene.press("End");
    await expect(page.locator('.pc-cover[aria-pressed="true"]')).toHaveAttribute("data-assessment-id", "cover-15");
    const result = await page.evaluate(() => ({ captionInFlow: (() => { const flow = document.querySelector(".pc-flow").getBoundingClientRect(), caption = document.querySelector(".pc-caption").getBoundingClientRect(); return caption.top >= flow.top && caption.bottom <= flow.bottom + 1; })(), overflow: document.documentElement.scrollWidth > innerWidth, hidden: [...document.querySelectorAll(".pc-cover")].filter(card => card.style.visibility === "hidden").length }));
    expect(result.captionInFlow).toBe(true);
    expect(result.overflow).toBe(false);
    expect(result.hidden).toBeGreaterThan(0);
  });
}
